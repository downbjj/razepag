import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { MercadoPagoGatewayService } from './services/mercadopago.service';
import { CreateGatewayPixDto } from './dto/create-gateway-pix.dto';
import { CreateGatewayPaymentDto } from './dto/create-gateway-payment.dto';

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly crypto:  CryptoService,
    private readonly mpService: MercadoPagoGatewayService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE PIX CHARGE — authenticated by client credentials
  // ─────────────────────────────────────────────────────────────────────────
  async createPixCharge(userId: string, dto: CreateGatewayPixDto) {
    const accessToken = await this.resolveAccessToken(userId);

    const result = await this.mpService.createPixPayment(accessToken, {
      amount:            dto.amount,
      description:       dto.description,
      payerEmail:        dto.payerEmail,
      payerName:         dto.payerName,
      payerCpf:          dto.payerCpf,
      externalReference: dto.externalReference,
    });

    this.logger.log(`PIX charge created: mpId=${result.id} status=${result.status} userId=${userId}`);
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE GENERIC PAYMENT
  // ─────────────────────────────────────────────────────────────────────────
  async createPayment(userId: string, dto: CreateGatewayPaymentDto) {
    const accessToken = await this.resolveAccessToken(userId);

    const result = await this.mpService.createPayment(accessToken, {
      amount:            dto.amount,
      description:       dto.description,
      paymentMethodId:   dto.paymentMethodId,
      payerEmail:        dto.payerEmail,
      payerName:         dto.payerName,
      payerCpf:          dto.payerCpf,
      token:             dto.token,
      installments:      dto.installments,
      issuerId:          dto.issuerId,
      externalReference: dto.externalReference,
    });

    this.logger.log(`Payment created: mpId=${result.id} method=${result.paymentMethodId} userId=${userId}`);
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET PAYMENT STATUS
  // ─────────────────────────────────────────────────────────────────────────
  async getPayment(userId: string, paymentId: string) {
    const accessToken = await this.resolveAccessToken(userId);
    return this.mpService.getPayment(accessToken, paymentId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SAVE / UPDATE Mercado Pago access token for a user
  // ─────────────────────────────────────────────────────────────────────────
  async saveMercadoPagoToken(userId: string, plainToken: string) {
    const encrypted = this.crypto.encrypt(plainToken);
    await this.prisma.user.update({
      where: { id: userId },
      data:  { mercadoPagoAccessToken: encrypted },
    });
    return { message: 'Token Mercado Pago salvo com sucesso' };
  }

  // ─── private ──────────────────────────────────────────────────────────────

  private async resolveAccessToken(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { mercadoPagoAccessToken: true },
    });

    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (!user.mercadoPagoAccessToken) {
      throw new BadRequestException(
        'Token Mercado Pago não configurado. Configure em PATCH /users/me/mercadopago.',
      );
    }

    return this.crypto.decrypt(user.mercadoPagoAccessToken);
  }
}
