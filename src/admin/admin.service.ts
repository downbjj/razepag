import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AdminAdjustBalanceDto } from './dto/adjust-balance.dto';
import { ReviewDocumentDto, DocumentAction } from './dto/review-document.dto';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/create-category.dto';
import { CreatePopupDto, UpdatePopupDto } from './dto/create-popup.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { SendEmailDto } from './dto/send-email.dto';
import { UpdateUserFeeDto } from './dto/update-user-fee.dto';
import { ReviewCryptoWithdrawalDto, CryptoWithdrawalAction } from './dto/review-crypto-withdrawal.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
  ) {}

  // ─── DASHBOARD ───────────────────────────────────────────────

  async getDashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalUsers, activeUsers, frozenUsers,
      totalTransactions, pendingTransactions,
      systemTotals, recentTransactions, totalVolume, transactionsToday,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: 'USER' } }),
      this.prisma.user.count({ where: { role: 'USER', status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { role: 'USER', isBlocked: true } }),
      this.prisma.transaction.count(),
      this.prisma.transaction.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      this.walletService.getSystemTotals(),
      this.prisma.transaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { user: { select: { name: true, email: true } } },
      }),
      this.prisma.transaction.aggregate({
        where: { status: 'PAID' },
        _sum: { amount: true, fee: true },
      }),
      this.prisma.transaction.count({ where: { createdAt: { gte: today } } }),
    ]);

    return {
      totalUsers, activeUsers, frozenUsers,
      totalVolume:        totalVolume._sum.amount ?? 0,
      totalFees:          totalVolume._sum.fee ?? 0,
      totalTransactions, pendingTransactions, transactionsToday,
      balanceTotal:       systemTotals.balance,
      pendingTotal:       systemTotals.pendingBalance,
      recentTransactions,
    };
  }

  // ─── USERS ───────────────────────────────────────────────────

  async getUsers(page = 1, limit = 20, search?: string, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = { role: 'USER' };
    if (status === 'FROZEN') where.isBlocked = true;
    else if (status) where.status = status;
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, phone: true,
          role: true, status: true, isBlocked: true,
          balance: true, pendingBalance: true, totalDeposited: true, totalWithdrawn: true,
          pixKey: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const usersWithWallet = users.map(u => ({
      ...u,
      wallet: {
        balance: u.balance, pendingBalance: u.pendingBalance,
        totalDeposited: u.totalDeposited, totalWithdrawn: u.totalWithdrawn,
      },
    }));

    return { users: usersWithWallet, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, phone: true,
        role: true, status: true, isBlocked: true,
        balance: true, pendingBalance: true, totalDeposited: true, totalWithdrawn: true,
        pixKey: true, createdAt: true,
        transactions: { orderBy: { createdAt: 'desc' }, take: 50, include: { pix: true } },
        apiClients: { select: { id: true, name: true, clientId: true, isActive: true, createdAt: true } },
        documents: { orderBy: { createdAt: 'desc' } },
        feeConfig: true,
      },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return {
      ...user,
      wallet: {
        balance: user.balance, pendingBalance: user.pendingBalance,
        totalDeposited: user.totalDeposited, totalWithdrawn: user.totalWithdrawn,
      },
    };
  }

  async freezeUser(adminId: string, userId: string, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.role === 'ADMIN' || user.role === 'OWNER')
      throw new BadRequestException('Não é possível bloquear admins');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isBlocked: true, status: 'FROZEN' },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'FREEZE_USER', entity: 'User', entityId: userId,
        newValues: { isBlocked: true, reason }, oldValues: { isBlocked: false },
      },
    });

    this.logger.warn(`Usuário bloqueado: ${userId} por admin ${adminId}`);
    return updated;
  }

  async unfreezeUser(adminId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isBlocked: false, status: 'ACTIVE' },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'UNFREEZE_USER', entity: 'User', entityId: userId,
        newValues: { isBlocked: false }, oldValues: { isBlocked: true },
      },
    });

    return updated;
  }

  async adjustBalance(adminId: string, userId: string, dto: AdminAdjustBalanceDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const oldBalance = user.balance;
    await this.walletService.adminAdjust(userId, dto.amount, dto.description || 'Ajuste admin');

    await this.prisma.transaction.create({
      data: {
        userId, type: 'ADJUSTMENT', status: 'PAID',
        amount: Math.abs(dto.amount), fee: 0, netAmount: Math.abs(dto.amount),
        description: `Ajuste admin: ${dto.description}`,
        externalId: `adj_${Date.now()}_${userId}`,
        metadata: { adminId, reason: dto.description },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'ADJUST_BALANCE', entity: 'User', entityId: userId,
        oldValues: { balance: oldBalance },
        newValues: { adjustment: dto.amount, description: dto.description },
      },
    });

    this.logger.log(`Saldo ajustado para ${userId}: ${dto.amount > 0 ? '+' : ''}${dto.amount}`);
    return { success: true, adjustment: dto.amount };
  }

  async getApiBalances(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'USER' },
        select: {
          id: true, name: true, email: true,
          balance: true, pendingBalance: true, totalDeposited: true, totalWithdrawn: true,
          _count: { select: { apiClients: { where: { isActive: true } }, transactions: true } },
        },
        orderBy: { balance: 'desc' },
        skip, take: limit,
      }),
      this.prisma.user.count({ where: { role: 'USER' } }),
    ]);

    const systemTotals = await this.walletService.getSystemTotals();
    return { users, total, page, limit, totalPages: Math.ceil(total / limit), systemTotals };
  }

  // ─── TRANSACTIONS ─────────────────────────────────────────────

  async getAllTransactions(page = 1, limit = 20, type?: string, status?: string, userId?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (type)   where.type   = type;
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: { user: { select: { name: true, email: true } }, pix: true },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { transactions, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async approveWithdrawal(adminId: string, transactionId: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transação não encontrada');
    if (tx.type !== 'WITHDRAW') throw new BadRequestException('Não é uma transação de saque');
    if (tx.status !== 'PENDING') throw new BadRequestException('Transação não está pendente');

    await this.prisma.transaction.update({ where: { id: transactionId }, data: { status: 'PAID' } });
    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'APPROVE_WITHDRAWAL', entity: 'Transaction', entityId: transactionId,
      },
    });
    return { message: 'Saque aprovado' };
  }

  async rejectWithdrawal(adminId: string, transactionId: string, reason: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transação não encontrada');
    if (tx.type !== 'WITHDRAW') throw new BadRequestException('Não é um saque');
    if (tx.status !== 'PENDING') throw new BadRequestException('Transação não está pendente');

    const refundAmount = tx.amount.toNumber() + tx.fee.toNumber();

    await this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: transactionId },
        data: { status: 'CANCELLED', metadata: { rejectedReason: reason } as any },
      }),
      this.prisma.user.update({
        where: { id: tx.userId },
        data: { balance: { increment: refundAmount }, totalWithdrawn: { decrement: refundAmount } },
      }),
    ]);

    return { message: 'Saque rejeitado e saldo devolvido' };
  }

  // ─── KYC / DOCUMENTS ─────────────────────────────────────────

  async getDocuments(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;

    const [docs, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.document.count({ where }),
    ]);

    return { documents: docs, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async reviewDocument(adminId: string, docId: string, dto: ReviewDocumentDto) {
    const doc = await this.prisma.document.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException('Documento não encontrado');

    const newStatus = dto.action === DocumentAction.APPROVE ? 'APPROVED' : 'REJECTED';

    const updated = await this.prisma.document.update({
      where: { id: docId },
      data: { status: newStatus, reviewedBy: adminId, reviewNote: dto.note },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: `${dto.action}_DOCUMENT`, entity: 'Document', entityId: docId,
        oldValues: { status: doc.status }, newValues: { status: newStatus, note: dto.note },
      },
    });

    return updated;
  }

  // ─── PRODUCTS & CATEGORIES ───────────────────────────────────

  async getProducts(page = 1, limit = 20, categoryId?: string, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (categoryId) where.categoryId = categoryId;
    if (status)     where.status     = status;

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { category: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { products, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async createProduct(adminId: string, dto: CreateProductDto) {
    const product = await this.prisma.product.create({
      data: {
        name: dto.name,
        description: dto.description,
        price: dto.price,
        categoryId: dto.categoryId,
        imageUrl: dto.imageUrl,
        sku: dto.sku,
        stock: dto.stock,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'CREATE_PRODUCT', entity: 'Product', entityId: product.id,
        newValues: { name: dto.name, price: dto.price },
      },
    });

    return product;
  }

  async updateProduct(adminId: string, productId: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Produto não encontrado');

    const updated = await this.prisma.product.update({ where: { id: productId }, data: dto as any });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'UPDATE_PRODUCT', entity: 'Product', entityId: productId,
        oldValues: { name: product.name, price: product.price } as any,
        newValues: { ...dto } as any,
      },
    });

    return updated;
  }

  async deleteProduct(adminId: string, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Produto não encontrado');

    await this.prisma.product.delete({ where: { id: productId } });
    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'DELETE_PRODUCT', entity: 'Product', entityId: productId,
        oldValues: { name: product.name },
      },
    });

    return { message: 'Produto removido' };
  }

  async getCategories() {
    return this.prisma.category.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(adminId: string, dto: CreateCategoryDto) {
    const category = await this.prisma.category.create({
      data: { name: dto.name, description: dto.description, slug: dto.slug },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'CREATE_CATEGORY', entity: 'Category', entityId: category.id,
        newValues: { name: dto.name },
      },
    });

    return category;
  }

  async updateCategory(adminId: string, categoryId: string, dto: UpdateCategoryDto) {
    const cat = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!cat) throw new NotFoundException('Categoria não encontrada');

    const updated = await this.prisma.category.update({ where: { id: categoryId }, data: dto });
    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'UPDATE_CATEGORY', entity: 'Category', entityId: categoryId,
        newValues: { ...dto } as any,
      },
    });

    return updated;
  }

  async getPurchases(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;

    const [purchases, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        include: {
          user:    { select: { name: true, email: true } },
          product: { select: { name: true, price: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.purchase.count({ where }),
    ]);

    return { purchases, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ─── POPUPS ──────────────────────────────────────────────────

  async getPopups(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [popups, total] = await Promise.all([
      this.prisma.popup.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], skip, take: limit }),
      this.prisma.popup.count(),
    ]);
    return { popups, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async createPopup(adminId: string, dto: CreatePopupDto) {
    const popup = await this.prisma.popup.create({
      data: {
        title: dto.title,
        content: dto.content,
        imageUrl: dto.imageUrl,
        link: dto.link,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt:   dto.endAt   ? new Date(dto.endAt)   : undefined,
        priority: dto.priority ?? 0,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'CREATE_POPUP', entity: 'Popup', entityId: popup.id,
        newValues: { title: dto.title },
      },
    });

    return popup;
  }

  async updatePopup(adminId: string, popupId: string, dto: UpdatePopupDto) {
    const popup = await this.prisma.popup.findUnique({ where: { id: popupId } });
    if (!popup) throw new NotFoundException('Popup não encontrado');

    const updated = await this.prisma.popup.update({
      where: { id: popupId },
      data: {
        ...dto,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt:   dto.endAt   ? new Date(dto.endAt)   : undefined,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'UPDATE_POPUP', entity: 'Popup', entityId: popupId,
        newValues: { ...dto } as any,
      },
    });

    return updated;
  }

  async deletePopup(adminId: string, popupId: string) {
    const popup = await this.prisma.popup.findUnique({ where: { id: popupId } });
    if (!popup) throw new NotFoundException('Popup não encontrado');

    await this.prisma.popup.delete({ where: { id: popupId } });
    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'DELETE_POPUP', entity: 'Popup', entityId: popupId,
        oldValues: { title: popup.title },
      },
    });

    return { message: 'Popup removido' };
  }

  // ─── NOTIFICATIONS ────────────────────────────────────────────

  async getNotifications(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [notifications, total] = await Promise.all([
      this.prisma.notificationLog.findMany({
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.notificationLog.count(),
    ]);
    return { notifications, total, page };
  }

  async sendNotification(adminId: string, dto: SendNotificationDto) {
    if (dto.broadcast) {
      // Broadcast para todos os usuários ativos
      const users = await this.prisma.user.findMany({
        where: { role: 'USER', status: 'ACTIVE' },
        select: { id: true },
      });

      await this.prisma.notificationLog.createMany({
        data: users.map(u => ({
          userId:      u.id,
          title:       dto.title,
          message:     dto.message,
          type:        dto.type || 'INFO',
          sentBy:      adminId,
          isBroadcast: true,
        })),
      });

      await this.prisma.auditLog.create({
        data: {
          userId: adminId, action: 'BROADCAST_NOTIFICATION', entity: 'Notification',
          newValues: { title: dto.title, recipients: users.length },
        },
      });

      return { message: `Notificação enviada para ${users.length} usuários` };
    }

    if (dto.userIds?.length) {
      await this.prisma.notificationLog.createMany({
        data: dto.userIds.map(uid => ({
          userId:  uid,
          title:   dto.title,
          message: dto.message,
          type:    dto.type || 'INFO',
          sentBy:  adminId,
        })),
      });

      return { message: `Notificação enviada para ${dto.userIds.length} usuários` };
    }

    throw new BadRequestException('Informe broadcast=true ou userIds[]');
  }

  // ─── EMAIL ────────────────────────────────────────────────────

  async getEmailLogs(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      this.prisma.emailLog.findMany({ orderBy: { createdAt: 'desc' }, skip, take: limit }),
      this.prisma.emailLog.count(),
    ]);
    return { logs, total, page };
  }

  async sendEmail(adminId: string, dto: SendEmailDto) {
    const recipients: string[] = [];

    if (dto.broadcast) {
      const users = await this.prisma.user.findMany({
        where: { role: 'USER', status: 'ACTIVE' },
        select: { email: true },
      });
      recipients.push(...users.map(u => u.email));
    } else if (dto.toUserIds?.length) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: dto.toUserIds } },
        select: { email: true },
      });
      recipients.push(...users.map(u => u.email));
    } else if (dto.to) {
      recipients.push(dto.to);
    }

    if (!recipients.length) throw new BadRequestException('Nenhum destinatário encontrado');

    // Registra log de cada envio (substituir por nodemailer/SES em produção)
    await this.prisma.emailLog.createMany({
      data: recipients.map(to => ({
        to,
        subject: dto.subject,
        body:    dto.body,
        status:  'SENT',
        sentBy:  adminId,
      })),
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'SEND_EMAIL', entity: 'EmailLog',
        newValues: { subject: dto.subject, recipients: recipients.length },
      },
    });

    this.logger.log(`E-mail registrado para ${recipients.length} destinatários por admin ${adminId}`);
    return { message: `E-mail registrado para ${recipients.length} destinatários`, recipients };
  }

  // ─── USER FEE CONFIG ──────────────────────────────────────────

  async getUserFees(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [fees, total] = await Promise.all([
      this.prisma.userFeeConfig.findMany({
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.userFeeConfig.count(),
    ]);
    return { fees, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async updateUserFee(adminId: string, userId: string, dto: UpdateUserFeeDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const config = await this.prisma.userFeeConfig.upsert({
      where:  { userId },
      update: { feePercent: dto.feePercent, feeFixed: dto.feeFixed, notes: dto.notes },
      create: { userId, feePercent: dto.feePercent, feeFixed: dto.feeFixed, notes: dto.notes },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'UPDATE_USER_FEE', entity: 'UserFeeConfig', entityId: userId,
        newValues: { feePercent: dto.feePercent, feeFixed: dto.feeFixed },
      },
    });

    return config;
  }

  async deleteUserFee(adminId: string, userId: string) {
    await this.prisma.userFeeConfig.deleteMany({ where: { userId } });
    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'DELETE_USER_FEE', entity: 'UserFeeConfig', entityId: userId,
        newValues: { note: 'Resetado para taxa padrão' },
      },
    });
    return { message: 'Taxa customizada removida, usando taxa padrão' };
  }

  // ─── CRYPTO WITHDRAWALS ───────────────────────────────────────

  async getCryptoWithdrawals(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;

    const [withdrawals, total] = await Promise.all([
      this.prisma.cryptoWithdrawal.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.cryptoWithdrawal.count({ where }),
    ]);

    return { withdrawals, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async reviewCryptoWithdrawal(adminId: string, id: string, dto: ReviewCryptoWithdrawalDto) {
    const withdrawal = await this.prisma.cryptoWithdrawal.findUnique({ where: { id } });
    if (!withdrawal) throw new NotFoundException('Saque cripto não encontrado');
    if (withdrawal.status !== 'PENDING')
      throw new BadRequestException('Este saque já foi processado');

    const newStatus = dto.action === CryptoWithdrawalAction.APPROVE ? 'COMPLETED' : 'REJECTED';

    const updated = await this.prisma.cryptoWithdrawal.update({
      where: { id },
      data: {
        status:     newStatus,
        txHash:     dto.txHash,
        adminNote:  dto.adminNote,
        reviewedBy: adminId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: `${dto.action}_CRYPTO_WITHDRAWAL`, entity: 'CryptoWithdrawal', entityId: id,
        oldValues: { status: 'PENDING' }, newValues: { status: newStatus, txHash: dto.txHash },
      },
    });

    return updated;
  }

  // ─── SYSTEM CONFIG ────────────────────────────────────────────

  async getSystemConfigs() {
    return this.prisma.systemConfig.findMany({ orderBy: { key: 'asc' } });
  }

  async updateSystemConfig(adminId: string, key: string, value: string) {
    const config = await this.prisma.systemConfig.upsert({
      where:  { key },
      update: { value },
      create: { key, value },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'UPDATE_CONFIG', entity: 'SystemConfig', entityId: key,
        newValues: { value },
      },
    });

    return config;
  }

  async deleteSystemConfig(adminId: string, key: string) {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (!cfg) throw new NotFoundException('Config não encontrada');

    await this.prisma.systemConfig.delete({ where: { key } });
    await this.prisma.auditLog.create({
      data: {
        userId: adminId, action: 'DELETE_CONFIG', entity: 'SystemConfig', entityId: key,
        oldValues: { value: cfg.value },
      },
    });

    return { message: 'Config removida' };
  }

  // ─── LOGS ─────────────────────────────────────────────────────

  async getAuditLogs(page = 1, limit = 50, action?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (action) where.action = action;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total, page, limit };
  }

  async getSystemLogs(page = 1, limit = 50, type?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (type) where.type = type;

    const [logs, total] = await Promise.all([
      this.prisma.log.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      this.prisma.log.count({ where }),
    ]);

    return { logs, total, page, limit };
  }

  async getWebhookLogs(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      this.prisma.webhookLog.findMany({
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.webhookLog.count(),
    ]);
    return { logs, total, page };
  }
}
