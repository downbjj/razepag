import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoPagoProvider } from './providers/mercadopago.provider';
import { PixService } from './pix.service';

@Processor('pix')
export class PixProcessor {
  private readonly logger = new Logger(PixProcessor.name);

  constructor(
    private prisma: PrismaService,
    private mpProvider: MercadoPagoProvider,
    private pixService: PixService,
  ) {}

  /**
   * Polling de fallback: verifica o status do pagamento na API do MP.
   * Só executa se o webhook não chegou (idempotência garante segurança).
   */
  @Process('poll-payment')
  async pollPayment(
    job: Job<{ transactionId: string; externalId: string; userId: string }>,
  ) {
    const { transactionId, externalId, userId } = job.data;

    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    // Já foi processada (pelo webhook) — nada a fazer
    if (!transaction || transaction.status !== 'PENDING') {
      this.logger.log(`Poll: transação ${transactionId} já não está PENDING — pulando`);
      return;
    }

    try {
      // Consulta status pelo external_reference (nosso UUID)
      const status = await this.mpProvider.getPaymentStatus(externalId);

      if (status === 'approved') {
        // Usa o mesmo método atômico do webhook — idempotente
        await this.pixService.confirmDepositAtomic(
          transactionId,
          userId,
          transaction.fee.toNumber(),
          transaction.netAmount.toNumber(),
        );
        this.logger.log(`Poll: pagamento confirmado via polling: ${transactionId}`);
      } else if (status === 'rejected' || status === 'cancelled') {
        await this.prisma.transaction.updateMany({
          where: { id: transactionId, status: 'PENDING' },
          data:  { status: 'CANCELLED' },
        });
        this.logger.log(`Poll: pagamento cancelado: ${transactionId}`);
      } else {
        this.logger.debug(`Poll: ${transactionId} ainda ${status} (tentativa ${job.attemptsMade + 1})`);
        throw new Error(`Payment still ${status}`); // força retry pelo Bull
      }
    } catch (error) {
      if (error.message?.startsWith('Payment still')) throw error;
      this.logger.error(`Poll: erro em ${transactionId}:`, error.message);
      throw error;
    }
  }

  /**
   * Envia PIX para chave externa via MP.
   * Em caso de falha, estorna o saldo do usuário.
   */
  @Process('send-transfer')
  async sendTransfer(
    job: Job<{
      transactionId: string;
      externalId: string;
      userId: string;
      pixKey: string;
      amount: number;
    }>,
  ) {
    const { transactionId, externalId, userId, pixKey, amount } = job.data;

    try {
      const result = await this.mpProvider.sendPixTransfer({ pixKey, amount, externalId });

      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: {
          status:   result.status === 'approved' ? 'PAID' : 'PROCESSING',
          metadata: { mpTransferId: result.id },
        },
      });

      this.logger.log(`PIX enviado: ${transactionId} → ${pixKey}`);
    } catch (error) {
      this.logger.error(`Erro na transferência PIX ${transactionId}:`, error.message);

      // Estorno atômico em caso de falha
      await this.prisma.$transaction(async (tx) => {
        const transaction = await tx.transaction.findUnique({ where: { id: transactionId } });
        if (!transaction) return;

        await tx.transaction.update({
          where: { id: transactionId },
          data:  { status: 'FAILED' },
        });

        const refund = parseFloat(
          (transaction.amount.toNumber() + transaction.fee.toNumber()).toFixed(2),
        );

        await tx.user.update({
          where: { id: userId },
          data: {
            balance:        { increment: refund },
            totalWithdrawn: { decrement: refund },
          },
        });
      });

      await this.prisma.log.create({
        data: {
          type:    'ERROR',
          message: `Falha ao enviar PIX ${transactionId}: ${error.message}`,
          data:    { transactionId, userId, pixKey, amount },
        },
      }).catch(() => {});

      throw error;
    }
  }
}
