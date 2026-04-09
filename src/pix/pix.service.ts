import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
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
    @InjectQueue('pix') private pixQueue: Queue,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // CRIAR COBRANÇA PIX (QR Code)
  // ─────────────────────────────────────────────────────────────────────────
  async createCharge(userId: string, dto: CreatePixChargeDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // externalId = nosso UUID que vai como external_reference no MP
    const externalId = uuidv4();
    const fee        = this.calculateFee(dto.amount);
    const netAmount  = parseFloat((dto.amount - fee).toFixed(2));

    // Cria transação PENDING antes de chamar o MP
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
      // Chama Mercado Pago para gerar o QR Code
      const charge = await this.mpProvider.createPixCharge({
        externalId,
        amount:        dto.amount,
        description:   dto.description || 'Pagamento PIX — RazePague',
        customerName:  user.name,
        customerEmail: user.email,
      });

      // Salva o payment ID do MP no metadata (para referência futura)
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data:  { metadata: { mpPaymentId: charge.id, mpStatus: charge.status } },
      });

      // Cria registro Pix 1:1
      await this.prisma.pix.create({
        data: {
          transactionId: transaction.id,
          qrCode:        charge.qrCode,
          copyPaste:     charge.copyPaste,
          expiresAt:     new Date(charge.expiresAt),
        },
      });

      // Log
      await this.prisma.log.create({
        data: {
          type:    'SYSTEM',
          message: `Cobrança PIX criada: R$${dto.amount} | user=${user.email} | ext=${externalId} | mp=${charge.id}`,
          data:    { transactionId: transaction.id, externalId, mpPaymentId: charge.id },
        },
      });

      // Polling de fallback (caso o webhook não chegue)
      await this.pixQueue.add(
        'poll-payment',
        { transactionId: transaction.id, externalId, userId, attempts: 0 },
        { delay: 15000, attempts: 24, backoff: { type: 'fixed', delay: 30000 } },
      );

      return this.prisma.transaction.findUnique({
        where:   { id: transaction.id },
        include: { pix: true },
      });
    } catch (error) {
      // Cancela a transação se o MP falhou
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

    await this.pixQueue.add(
      'send-transfer',
      { transactionId: transaction.id, externalId, userId, pixKey: dto.pixKey, amount: dto.amount },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

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
      this.webhooksService.triggerWebhook(senderId, 'transfer.completed', {
        type: 'TRANSFER', amount, fee, recipient: recipient.email,
      }),
      this.webhooksService.triggerWebhook(recipient.id, 'transfer.received', {
        type: 'TRANSFER', amount, sender: sender.email,
      }),
    ]);

    return { success: true, amount, fee, recipient: { name: recipient.name, email: recipient.email } };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WEBHOOK MERCADO PAGO — FLUXO CORRETO E SEGURO
  //
  // 1. Recebe notificação
  // 2. Extrai APENAS o payment ID (não confia em nada mais)
  // 3. Consulta a API do MP para obter o status real
  // 4. Valida status === 'approved'
  // 5. Busca transação pelo external_reference
  // 6. Verifica duplicidade (idempotência atômica)
  // 7. Calcula taxa e credita saldo dentro de $transaction
  // ─────────────────────────────────────────────────────────────────────────
  async handleMercadoPagoWebhook(payload: any): Promise<{ received: boolean }> {
    // Loga o webhook recebido
    this.logger.log(`MP webhook recebido: ${JSON.stringify(payload).slice(0, 300)}`);

    // Ignora notificações que não sejam de pagamento
    const type = payload?.type || payload?.topic;
    if (type && type !== 'payment') {
      return { received: true };
    }

    // Extrai o MP payment ID — ÚNICA informação que usamos do body
    const mpPaymentId = String(
      payload?.data?.id ||
      payload?.resource?.split('/').pop() ||
      '',
    ).trim();

    if (!mpPaymentId || mpPaymentId === 'undefined' || mpPaymentId === 'null') {
      this.logger.warn('Webhook sem payment ID válido — ignorado');
      return { received: true };
    }

    // Salva log do webhook
    await this.prisma.log.create({
      data: {
        type:    'WEBHOOK',
        message: `MP webhook: action=${payload?.action || 'n/a'} | payment=${mpPaymentId}`,
        data:    payload,
      },
    }).catch(() => {});

    // SEMPRE consulta a API do MP — nunca confia no status do body
    const payment = await this.mpProvider.getPayment(mpPaymentId);

    if (!payment) {
      this.logger.warn(`Payment ${mpPaymentId} não encontrado na API do MP`);
      return { received: true };
    }

    this.logger.log(`Payment ${mpPaymentId}: status=${payment.status} | ext_ref=${payment.external_reference}`);

    // Ignora se não está aprovado
    if (payment.status !== 'approved') {
      if (payment.status === 'rejected' || payment.status === 'cancelled') {
        // Cancela a transação local se existir
        if (payment.external_reference) {
          await this.prisma.transaction.updateMany({
            where: { externalId: payment.external_reference, status: 'PENDING' },
            data:  { status: 'CANCELLED' },
          });
        }
      }
      return { received: true };
    }

    // Valida external_reference (nosso UUID)
    const externalReference = payment.external_reference;
    if (!externalReference) {
      this.logger.warn(`Payment ${mpPaymentId} sem external_reference`);
      return { received: true };
    }

    // Busca nossa transação
    const transaction = await this.prisma.transaction.findUnique({
      where: { externalId: externalReference },
    });

    if (!transaction) {
      this.logger.warn(`Transação não encontrada para externalId=${externalReference}`);
      return { received: true };
    }

    // Confirma o depósito de forma atômica (previne duplicidade por race condition)
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
  //
  // Usa updateMany com WHERE status=PENDING para garantir que apenas
  // um processo execute mesmo sob concorrência (webhooks + polling)
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
      // Atualiza APENAS se ainda estiver PENDING (idempotência atômica)
      const updated = await tx.transaction.updateMany({
        where: { id: transactionId, status: 'PENDING' },
        data: {
          status:   'PAID',
          fee,
          netAmount,
          metadata,
        },
      });

      // Se nenhuma linha foi atualizada, já foi processada — aborta
      if (updated.count === 0) {
        this.logger.log(`Transação ${transactionId} já processada — idempotência ativa`);
        return;
      }

      // Credita saldo do usuário
      await tx.user.update({
        where: { id: userId },
        data: {
          balance:        { increment: netAmount },
          totalDeposited: { increment: netAmount },
        },
      });
    });

    // Aciona webhook do usuário (fora da $transaction para não travar)
    this.webhooksService.triggerWebhook(userId, 'payment.completed', {
      transactionId,
      netAmount,
      fee,
      mpPaymentId,
    }).catch(() => {});

    // Log de confirmação
    await this.prisma.log.create({
      data: {
        type:    'SYSTEM',
        message: `Depósito confirmado: transactionId=${transactionId} | userId=${userId} | R$${netAmount} creditado`,
        data:    { transactionId, userId, netAmount, fee, mpPaymentId },
      },
    }).catch(() => {});

    this.logger.log(`✅ Depósito confirmado: ${transactionId} — R$${netAmount} creditado para ${userId}`);
  }

  // Alias legado
  async confirmDeposit(transactionId: string, userId: string, netAmount: number): Promise<void> {
    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction) return;
    await this.confirmDepositAtomic(transactionId, userId, transaction.fee.toNumber(), netAmount);
  }

  async confirmPixIn(transactionId: string, userId: string, netAmount: number): Promise<void> {
    return this.confirmDeposit(transactionId, userId, netAmount);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WEBHOOK LEGADO (compatibilidade)
  // ─────────────────────────────────────────────────────────────────────────
  async handleWebhookFromProvider(payload: any) {
    const { event, payment } = payload;
    if (!payment?.externalReference) return;

    const transaction = await this.prisma.transaction.findUnique({
      where: { externalId: payment.externalReference },
    });
    if (!transaction || transaction.status === 'PAID') return;

    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      await this.confirmDepositAtomic(
        transaction.id,
        transaction.userId,
        transaction.fee.toNumber(),
        transaction.netAmount.toNumber(),
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
    const skip        = (page - 1) * limit;
    const where: any  = { userId };
    if (type)   where.type   = type;
    if (status) where.status = status;

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: { pix: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { transactions, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getTransaction(userId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where:   { id: transactionId, userId },
      include: { pix: true },
    });
    if (!transaction) throw new NotFoundException('Transação não encontrada');
    return transaction;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CÁLCULO DE TAXA: 3% + R$1,00
  // ─────────────────────────────────────────────────────────────────────────
  calculateFee(amount: number): number {
    const pct  = parseFloat(this.configService.get('PIX_FEE_PERCENTAGE', '3'));
    const flat = parseFloat(this.configService.get('PIX_FEE_FLAT',       '1.00'));
    return parseFloat((amount * (pct / 100) + flat).toFixed(2));
  }
}
