import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * WalletService — gerencia o saldo diretamente na tabela User.
 * Campos: balance, pendingBalance, totalDeposited, totalWithdrawn
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private prisma: PrismaService) {}

  /** Retorna os dados de saldo do usuário (campos do User) */
  async getWallet(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id:             true,
        balance:        true,
        pendingBalance: true,
        totalDeposited: true,
        totalWithdrawn: true,
      },
    });
    if (!user) throw new BadRequestException('Usuário não encontrado');
    return user;
  }

  /** Credita saldo no usuário */
  async credit(userId: string, amount: number, type: 'balance' | 'pending' = 'balance') {
    const dec = new Decimal(amount);
    if (dec.lte(0)) throw new BadRequestException('Valor deve ser positivo');

    if (type === 'pending') {
      return this.prisma.user.update({
        where: { id: userId },
        data: {
          pendingBalance: { increment: dec },
          totalDeposited: { increment: dec },
        },
      });
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        balance:        { increment: dec },
        totalDeposited: { increment: dec },
      },
    });
  }

  /** Debita saldo do usuário (verifica se há saldo suficiente) */
  async debit(userId: string, amount: number) {
    const dec = new Decimal(amount);
    if (dec.lte(0)) throw new BadRequestException('Valor deve ser positivo');

    const user = await this.getWallet(userId);
    if (new Decimal(user.balance.toString()).lt(dec)) {
      throw new BadRequestException('Saldo insuficiente');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        balance:        { decrement: dec },
        totalWithdrawn: { increment: dec },
      },
    });
  }

  /** Move valor de pendente para disponível */
  async movePendingToBalance(userId: string, amount: number) {
    const dec = new Decimal(amount);
    const user = await this.getWallet(userId);

    if (new Decimal(user.pendingBalance.toString()).lt(dec)) {
      throw new BadRequestException('Saldo pendente insuficiente');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        pendingBalance: { decrement: dec },
        balance:        { increment: dec },
      },
    });
  }

  /** Ajuste manual de saldo (admin) */
  async adminAdjust(userId: string, amount: number, description: string) {
    const dec = new Decimal(Math.abs(amount));
    const isCredit = amount > 0;

    if (isCredit) {
      return this.prisma.user.update({
        where: { id: userId },
        data: { balance: { increment: dec } },
      });
    }

    const user = await this.getWallet(userId);
    if (new Decimal(user.balance.toString()).lt(dec)) {
      throw new BadRequestException('Saldo ficaria negativo');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { balance: { decrement: dec } },
    });
  }

  /** Totais globais do sistema (para dashboard admin) */
  async getSystemTotals() {
    const result = await this.prisma.user.aggregate({
      _sum: {
        balance:        true,
        pendingBalance: true,
        totalDeposited: true,
        totalWithdrawn: true,
      },
    });
    return result._sum;
  }
}
