import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { WithdrawDto } from './dto/withdraw.dto';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private configService: ConfigService,
  ) {}

  async requestWithdrawal(userId: string, dto: WithdrawDto) {
    const minAmount = parseFloat(this.configService.get('MIN_WITHDRAWAL_AMOUNT', '10'));
    if (dto.amount < minAmount) {
      throw new BadRequestException(`Valor mínimo para saque: R$${minAmount}`);
    }

    const wallet     = await this.walletService.getWallet(userId);
    const feePercent = parseFloat(this.configService.get('WITHDRAWAL_FEE_PERCENTAGE', '2.0'));
    const fee        = parseFloat((dto.amount * (feePercent / 100)).toFixed(2));
    const totalDebit = parseFloat((dto.amount + fee).toFixed(2));

    if (Number(wallet.balance) < totalDebit) {
      throw new BadRequestException(`Saldo insuficiente. Necessário: R$${totalDebit.toFixed(2)}`);
    }

    // Verifica saque pendente
    const pendingWithdrawal = await this.prisma.transaction.findFirst({
      where: { userId, type: 'WITHDRAW', status: { in: ['PENDING', 'PROCESSING'] } },
    });
    if (pendingWithdrawal) {
      throw new BadRequestException('Você já possui um saque pendente');
    }

    const externalId = uuidv4();

    const [transaction] = await this.prisma.$transaction([
      this.prisma.transaction.create({
        data: {
          userId,
          type:        'WITHDRAW',
          status:      'PENDING',
          amount:      dto.amount,
          fee,
          netAmount:   parseFloat((dto.amount - fee).toFixed(2)),
          description: `Saque para ${dto.pixKey}`,
          externalId,
          pixKey:      dto.pixKey,
          metadata: {
            pixKeyType: dto.pixKeyType,
            bankName:   dto.bankName,
          },
        },
      }),
    ]);

    // Debita imediatamente (reserva o saldo)
    await this.walletService.debit(userId, totalDebit);

    this.logger.log(`Saque solicitado: ${transaction.id} — R$${dto.amount} para ${userId}`);
    return transaction;
  }

  async cancelWithdrawal(userId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, userId, type: 'WITHDRAW', status: 'PENDING' },
    });

    if (!transaction) throw new NotFoundException('Saque pendente não encontrado');

    const refundAmount = transaction.amount.toNumber() + transaction.fee.toNumber();

    await this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: transactionId },
        data:  { status: 'CANCELLED' },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          balance:        { increment: refundAmount },
          totalWithdrawn: { decrement: refundAmount },
        },
      }),
    ]);

    return { message: 'Saque cancelado e valor devolvido' };
  }
}
