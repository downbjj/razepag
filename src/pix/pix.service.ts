import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { MercadoPagoProvider } from './providers/mercadopago.provider';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CreatePixChargeDto } from './dto/create-pix-charge.dto';
import { SendPixDto } from './dto/send-pix.dto';

@Injectable()
export class PixService {
  private readonly logger = new Logger(PixService.name);

  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private mpProvider: MercadoPagoProvider,
    private webhooksService: WebhooksService,
    private configService: ConfigService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // CRIAR COBRANÇA PIX (QR Code)
  // ─────────────────────────────────────────────────────────────────────────
  async createCharge(userId: string, dto: CreatePixChargeDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const externalId = uuidv4();
    const fee        = this.calculateFee(dto.amount);
    const netAmount  = parseFloat((dto.amount - fee).toFixed(2));

    const transaction = await this.prisma.transaction.create({
      data: {
        userId,
        type:        'DEPOSIT',
        status:      'PENDING',
        amount:      dto.amount,
        fee,
        netAmount,
        description: dto.description || 'Cobrança PIX',
        externalId,
      },
    });

    try {
      const charge = await this.mpProvider.createPixCharge({
        externalId,
        amount:        dto.amount,
        description:   dto.description || 'Pagamento PIX — RazePague',
        customerName:  user.name,
        customerEmail: user.email,
      });

      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data:  { metadata: { mpPaymentId: charge.id, mpStatus: charge.status } },
      });

      await this.prisma.pix.create({
        data: {
          transactionId: transaction.id,
          qrCode:        charge.qrCode,
          copyPaste:     charge.copyPaste,
          expiresAt:     new Date(charge.expiresAt),
        },
      });

      await this.prisma.log.create({
        data: {
          type:    'SYSTEM',
          message: `Cobrança PIX criada: R$${dto.amount} | user=${user.email} | ext=${externalId}`,
          data:    { transactionId: transaction.id, externalId, mpPaymentId: charge.id },
        },
      });

      // Polling de fallback via setTimeout (sem Redis)
      this.schedulePollPayment(transaction.id, externalId, userId, 24, 0, 15000);

      return this.prisma.transaction.findUnique({
        where:   { id: transaction.id },
        include: { pix: true },
      });
    } catch (error) {
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data:  { status: 'FAILED' },
      });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ENVIAR PIX (saída para chave externa)
  // ─────────────────────────────────────────────────────────────────────────
  async sendPix(userId: string, dto: SendPixDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const fee        = this.calculateFee(dto.amount);
    const totalDebit = parseFloat((dto.amount + fee).toFixed(2));

    const wallet = await this.walletService.getWallet(userId);
    if (Number(wallet.balance) < totalDebit) {
      throw new BadRequestException(`Saldo insuficiente. Necessário: R$${totalDebit.toFixed(2)}`);
    }

    const externalId = uuidv4();

    const [transaction] = await this.prisma.$transaction([
      this.prisma.transaction.create({
        data: {
          userId,
          type:        'WITHDRAW',
          status:      'PROCESSING',
          amount:      dto.amount,
          fee,
          netAmount:   dto.amount,
          description: dto.description || `PIX para ${dto.pixKey}`,
          externalId,
          pixKey:      dto.pixKey,
        },
      }),
    ]);

    await this.walletService.debit(userId, totalDebit);

    // Executa a transferência de forma assíncrona com retry
    this.executeTransfer(transaction.id, externalId, userId, dto.pixKey, dto.amount, 0, 3);

    return transaction;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TRANSFERÊNCIA INTERNA (entre usuários da plataforma)
  // ─────────────────────────────────────────────────────────────────────────
  async transferToUser(senderId: string, recipientPixKey: string, amount: number, description?: string) {
    if (amount <= 0) throw new BadRequestException('Valor deve ser positivo');

    const [sender, recipient] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: senderId } }),
      this.prisma.user.findUnique({ where: { pixKey: recipientPixKey } }),
    ]);

    if (!sender)    throw new NotFoundException('Remetente não encontrado');
    if (!recipient) throw new NotFoundException('Chave PIX do destinatário não encontrada');
    if (sender.id === recipient.id) throw new BadRequestException('Não é possível transferir para si mesmo');

    const fee        = this.calculateFee(amount);
    const totalDebit = parseFloat((amount + fee).toFixed(2));

    if (Number(sender.balance) < totalDebit) {
      throw new BadRequestException('Saldo insuficiente');
    }

    const transferId = uuidv4();

    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          userId:        senderId,
          type:          'TRANSFER',
          status:        'PAID',
          amount,
          fee,
          netAmount:     amount,
          description:   description || `Transferência para ${recipient.name}`,
          externalId:    `transfer_out_${transferId}`,
          relatedUserId: recipient.id,
        },
      });

      await tx.transaction.create({
        data: {
          userId:        recipient.id,
          type:          'TRANSFER',
          status:        'PAID',
          amount,
          fee:           0,
          netAmount:     amount,
          description:   description || `Transferência de ${sender.name}`,
          externalId:    `transfer_in_${transferId}`,
          relatedUserId: senderId,
        },
      });

      await tx.user.update({
        where: { id: senderId },
        data:  { balance: { decrement: totalDebit }, totalWithdrawn: { increment: totalDebit } },
      });

      await tx.user.update({
        where: { id: recipient.id },
        data:  { balance: { increment: amount }, totalDeposited: { increment: amount } },
      });
    });

    await Promise.allSettled([
      this.webhooksService.triggerWebhook(senderId,     'transfer.completed', { type: 'TRANSFER', amount, fee, recipient: recipient.email }),
      this.webhooksService.triggerWebhook(recipient.id, 'transfer.received',  { type: 'TRANSFER', amount, sender: sender.email }),
    ]);

    return { success: true, amount, fee, recipient: { name: recipient.name, email: recipient.email } };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WEBHOOK MERCADO PAGO
  // ─────────────────────────────────────────────────────────────────────────
  async handleMercadoPagoWebhook(payload: any): Promise<{ received: boolean }> {
    this.logger.log(`MP webhook recebido: ${JSON.stringify(payload).slice(0, 300)}`);

    const type = payload?.type || payload?.topic;
    if (type && type !== 'payment') return { received: true };

    const mpPaymentId = String(
      payload?.data?.id ||
      payload?.resource?.split('/').pop() ||
      '',
    ).trim();

    if (!mpPaymentId || mpPaymentId === 'undefined' || mpPaymentId === 'null') {
      this.logger.warn('Webhook sem payment ID válido — ignorado');
      return { received: true };
    }

    await this.prisma.log.create({
      data: {
        type:    'WEBHOOK',
        message: `MP webhook: action=${payload?.action || 'n/a'} | payment=${mpPaymentId}`,
        data:    payload,
      },
    }).catch(() => {});

    const payment = await this.mpProvider.getPayment(mpPaymentId);
    if (!payment) return { received: true };

    this.logger.log(`Payment ${mpPaymentId}: status=${payment.status}`);

    if (payment.status !== 'approved') {
      if ((payment.status === 'rejected' || payment.status === 'cancelled') && payment.external_reference) {
        await this.prisma.transaction.updateMany({
          where: { externalId: payment.external_reference, status: 'PENDING' },
          data:  { status: 'CANCELLED' },
        });
      }
      return { received: true };
    }

    if (!payment.external_reference) return { received: true };

    const transaction = await this.prisma.transaction.findUnique({
      where: { externalId: payment.external_reference },
    });

    if (!transaction) return { received: true };

    await this.confirmDepositAtomic(
      transaction.id,
      transaction.userId,
      transaction.fee.toNumber(),
      transaction.netAmount.toNumber(),
      mpPaymentId,
    );

    return { received: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONFIRMAR DEPÓSITO — ATÔMICO E IDEMPOTENTE
  // ─────────────────────────────────────────────────────────────────────────
  async confirmDepositAtomic(
    transactionId: string,
    userId: string,
    fee: number,
    netAmount: number,
    mpPaymentId?: string,
  ): Promise<void> {
    const metadata: any = mpPaymentId ? { mpPaymentId, confirmedAt: new Date().toISOString() } : {};

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.updateMany({
        where: { id: transactionId, status: 'PENDING' },
        data:  { status: 'PAID', fee, netAmount, metadata },
      });

      if (updated.count === 0) {
        this.logger.log(`Transação ${transactionId} já processada — idempotência ativa`);
        return;
      }

      await tx.user.update({
        where: { id: userId },
        data:  { balance: { increment: netAmount }, totalDeposited: { increment: netAmount } },
      });
    });

    this.webhooksService.triggerWebhook(userId, 'payment.completed', {
      transactionId, netAmount, fee, mpPaymentId,
    }).catch(() => {});

    await this.prisma.log.create({
      data: {
        type:    'SYSTEM',
        message: `Depósito confirmado: ${transactionId} | R$${netAmount} creditado`,
        data:    { transactionId, userId, netAmount, fee, mpPaymentId },
      },
    }).catch(() => {});

    this.logger.log(`✅ Depósito confirmado: ${transactionId} — R$${netAmount} para ${userId}`);
  }

  async confirmDeposit(transactionId: string, userId: string, netAmount: number): Promise<void> {
    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction) return;
    await this.confirmDepositAtomic(transactionId, userId, transaction.fee.toNumber(), netAmount);
  }

  async confirmPixIn(transactionId: string, userId: string, netAmount: number): Promise<void> {
    return this.confirmDeposit(transactionId, userId, netAmount);
  }

  async handleWebhookFromProvider(payload: any) {
    const { event, payment } = payload;
    if (!payment?.externalReference) return;

    const transaction = await this.prisma.transaction.findUnique({
      where: { externalId: payment.externalReference },
    });
    if (!transaction || transaction.status === 'PAID') return;

    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      await this.confirmDepositAtomic(
        transaction.id, transaction.userId,
        transaction.fee.toNumber(), transaction.netAmount.toNumber(),
      );
    } else if (event === 'PAYMENT_OVERDUE' || event === 'PAYMENT_DELETED') {
      await this.prisma.transaction.updateMany({
        where: { id: transaction.id, status: 'PENDING' },
        data:  { status: 'CANCELLED' },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONSULTAR TRANSAÇÕES
  // ─────────────────────────────────────────────────────────────────────────
  async getTransactions(userId: string, page = 1, limit = 20, type?: string, status?: string) {
    const skip       = (page - 1) * limit;
    const where: any = { userId };
    if (type)   where.type   = type;
    if (status) where.status = status;

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({ where, include: { pix: true }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      this.prisma.transaction.count({ where }),
    ]);

    return { transactions, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getTransaction(userId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, userId }, include: { pix: true },
    });
    if (!transaction) throw new NotFoundException('Transação não encontrada');
    return transaction;
  }

  calculateFee(amount: number): number {
    const pct  = parseFloat(this.configService.get('PIX_FEE_PERCENTAGE', '3'));
    const flat = parseFloat(this.configService.get('PIX_FEE_FLAT',       '1.00'));
    return parseFloat((amount * (pct / 100) + flat).toFixed(2));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POLLING SEM REDIS — usa setTimeout com retry exponencial
  // ─────────────────────────────────────────────────────────────────────────
  private schedulePollPayment(
    transactionId: string, externalId: string, userId: string,
    maxAttempts: number, attempt: number, delay: number,
  ) {
    setTimeout(async () => {
      try {
        const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
        if (!transaction || transaction.status !== 'PENDING') return;

        const status = await this.mpProvider.getPaymentStatus(externalId);

        if (status === 'approved') {
          await this.confirmDepositAtomic(
            transactionId, userId,
            transaction.fee.toNumber(), transaction.netAmount.toNumber(),
          );
          this.logger.log(`Poll: pagamento confirmado via polling: ${transactionId}`);
        } else if (status === 'rejected' || status === 'cancelled') {
          await this.prisma.transaction.updateMany({
            where: { id: transactionId, status: 'PENDING' },
            data:  { status: 'CANCELLED' },
          });
        } else if (attempt < maxAttempts - 1) {
          this.schedulePollPayment(transactionId, externalId, userId, maxAttempts, attempt + 1, 30000);
        }
      } catch (err) {
        this.logger.error(`Poll error for ${transactionId}: ${err.message}`);
        if (attempt < maxAttempts - 1) {
          this.schedulePollPayment(transactionId, externalId, userId, maxAttempts, attempt + 1, 30000);
        }
      }
    }, delay);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TRANSFERÊNCIA PIX SEM REDIS — executa direto com retry exponencial
  // ─────────────────────────────────────────────────────────────────────────
  private async executeTransfer(
    transactionId: string, externalId: string, userId: string,
    pixKey: string, amount: number, attempt: number, maxAttempts: number,
  ) {
    try {
      const result = await this.mpProvider.sendPixTransfer({ pixKey, amount, externalId });
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data:  { status: result.status === 'approved' ? 'PAID' : 'PROCESSING', metadata: { mpTransferId: result.id } },
      });
      this.logger.log(`PIX enviado: ${transactionId} → ${pixKey}`);
    } catch (error) {
      this.logger.error(`Erro na transferência PIX ${transactionId}: ${error.message}`);

      if (attempt < maxAttempts - 1) {
        const delay = Math.pow(2, attempt) * 5000;
        setTimeout(() => this.executeTransfer(transactionId, externalId, userId, pixKey, amount, attempt + 1, maxAttempts), delay);
      } else {
        // Estorno após esgotar tentativas
        await this.prisma.$transaction(async (tx) => {
          const t = await tx.transaction.findUnique({ where: { id: transactionId } });
          if (!t) return;
          await tx.transaction.update({ where: { id: transactionId }, data: { status: 'FAILED' } });
          const refund = parseFloat((t.amount.toNumber() + t.fee.toNumber()).toFixed(2));
          await tx.user.update({
            where: { id: userId },
            data:  { balance: { increment: refund }, totalWithdrawn: { decrement: refund } },
          });
        });
        await this.prisma.log.create({
          data: { type: 'ERROR', message: `Falha ao enviar PIX ${transactionId}: ${error.message}`, data: { transactionId, userId, pixKey, amount } },
        }).catch(() => {});
      }
    }
  }
}
