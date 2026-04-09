import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id:             true,
        email:          true,
        name:           true,
        phone:          true,
        role:           true,
        status:         true,
        isBlocked:      true,
        pixKey:         true,
        balance:        true,
        pendingBalance: true,
        totalDeposited: true,
        totalWithdrawn: true,
        createdAt:      true,
      },
    });

    if (!user) throw new NotFoundException('Usuário não encontrado');

    return {
      ...user,
      wallet: {
        balance:        user.balance,
        pendingBalance: user.pendingBalance,
        totalDeposited: user.totalDeposited,
        totalWithdrawn: user.totalWithdrawn,
      },
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data:  { name: dto.name, phone: dto.phone },
      select: { id: true, email: true, name: true, phone: true, pixKey: true, updatedAt: true },
    });
  }

  async getDashboard(userId: string) {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    const [user, recentTransactions, chartData, weeklyData, monthlyDeposit, monthlyWithdraw, pendingCount, depositSum, withdrawSum] = await Promise.all([
      this.getProfile(userId),
      this.prisma.transaction.findMany({
        where:   { userId },
        orderBy: { createdAt: 'desc' },
        take:    10,
        include: { pix: true },
      }),
      this.getMonthlyChart(userId),
      this.getWeeklyChart(userId),
      // This month's deposits
      this.prisma.transaction.aggregate({
        where: { userId, type: 'DEPOSIT', status: 'PAID', createdAt: { gte: monthStart, lte: monthEnd } },
        _sum:   { netAmount: true },
        _count: { id: true },
      }),
      // This month's withdrawals
      this.prisma.transaction.aggregate({
        where: { userId, type: { in: ['WITHDRAW', 'TRANSFER'] }, status: 'PAID', createdAt: { gte: monthStart, lte: monthEnd } },
        _sum:  { amount: true },
      }),
      // Pending count
      this.prisma.transaction.count({ where: { userId, status: 'PENDING' } }),
      // All-time deposit
      this.prisma.transaction.aggregate({
        where: { userId, type: 'DEPOSIT', status: 'PAID' },
        _sum:  { netAmount: true },
        _count: { id: true },
      }),
      // All-time withdrawal
      this.prisma.transaction.aggregate({
        where: { userId, type: { in: ['WITHDRAW', 'TRANSFER'] }, status: 'PAID' },
        _sum:  { amount: true },
        _count: { id: true },
      }),
    ])

    const monthlyReceived = Number(monthlyDeposit._sum.netAmount || 0)
    const monthlyCount    = monthlyDeposit._count.id
    const ticketMedio     = monthlyCount > 0 ? monthlyReceived / monthlyCount : 0
    const monthlySent     = Number(monthlyWithdraw._sum.amount || 0)

    return {
      user,
      recentTransactions,
      chartData,
      weeklyData,
      summary: {
        totalReceived:    Number(depositSum._sum.netAmount  || 0),
        totalSent:        Number(withdrawSum._sum.amount    || 0),
        transactionCount: (depositSum._count.id || 0) + (withdrawSum._count.id || 0),
        pendingCount,
        monthlyReceived,
        monthlySent,
        monthlyCount,
        ticketMedio,
      },
    };
  }

  // ─── Mercado Pago token ────────────────────────────────────────────────────

  async updateMercadoPagoToken(userId: string, plainToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const encrypted = this.crypto.encrypt(plainToken);
    await this.prisma.user.update({
      where: { id: userId },
      data:  { mercadoPagoAccessToken: encrypted },
    });

    return { message: 'Token Mercado Pago salvo com sucesso' };
  }

  async hasMercadoPagoToken(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { mercadoPagoAccessToken: true },
    });
    return !!user?.mercadoPagoAccessToken;
  }

  // Monthly aggregation for the last 6 months
  private async getMonthlyChart(userId: string) {
    const months: { month: string; received: number; sent: number }[] = []
    const now = new Date()

    for (let i = 5; i >= 0; i--) {
      const date  = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const start = new Date(date.getFullYear(), date.getMonth(), 1)
      const end   = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59)

      const label = date.toLocaleDateString('pt-BR', { month: 'short' })

      const [received, sent] = await Promise.all([
        this.prisma.transaction.aggregate({
          where: { userId, type: 'DEPOSIT', status: 'PAID', createdAt: { gte: start, lte: end } },
          _sum: { netAmount: true },
        }),
        this.prisma.transaction.aggregate({
          where: { userId, type: { in: ['WITHDRAW', 'TRANSFER'] }, status: 'PAID', createdAt: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
      ])

      months.push({
        month:    label,
        received: Number(received._sum.netAmount || 0),
        sent:     Number(sent._sum.amount || 0),
      })
    }

    return months
  }

  // Daily aggregation for the last 7 days
  private async getWeeklyChart(userId: string) {
    const days: { day: string; deposits: number; withdrawals: number }[] = []
    const now = new Date()
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

    for (let i = 6; i >= 0; i--) {
      const date  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0)
      const end   = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59)
      const label = dayNames[date.getDay()]

      const [received, sent] = await Promise.all([
        this.prisma.transaction.aggregate({
          where: { userId, type: 'DEPOSIT', status: 'PAID', createdAt: { gte: start, lte: end } },
          _sum: { netAmount: true },
        }),
        this.prisma.transaction.aggregate({
          where: { userId, type: { in: ['WITHDRAW', 'TRANSFER'] }, status: 'PAID', createdAt: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
      ])

      days.push({
        day:         label,
        deposits:    Number(received._sum.netAmount || 0),
        withdrawals: Number(sent._sum.amount || 0),
      })
    }

    return days
  }

  async getNotifications(userId: string) {
    return this.prisma.notificationLog.findMany({
      where: { OR: [{ userId }, { isBroadcast: true }] },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true, title: true, message: true, type: true,
        readAt: true, isBroadcast: true, createdAt: true,
      },
    });
  }

  async markNotificationRead(userId: string, notificationId: string) {
    // Only update if the notification belongs to this user or is a broadcast
    const notif = await this.prisma.notificationLog.findFirst({
      where: { id: notificationId, OR: [{ userId }, { isBroadcast: true }] },
    });
    if (!notif) return { message: 'Not found' };

    return this.prisma.notificationLog.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
      select: { id: true, readAt: true },
    });
  }
}
