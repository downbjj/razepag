import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoPagoConfig, Payment, PaymentSearch } from 'mercadopago';

export interface CreatePixChargeParams {
  externalId: string;
  amount: number;
  description: string;
  customerName: string;
  customerEmail: string;
  customerDocument?: string;
}

export interface PixChargeResult {
  id: string;
  status: string;
  qrCode: string;
  copyPaste: string;
  expiresAt: string;
}

export interface PixTransferParams {
  pixKey: string;
  amount: number;
  description?: string;
  externalId: string;
}

export interface MPPayment {
  id: number;
  status: string;
  status_detail: string;
  external_reference: string;
  transaction_amount: number;
  date_approved: string | null;
  date_created: string;
  payer: { email: string };
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
    };
  };
}

@Injectable()
export class MercadoPagoProvider {
  private readonly logger = new Logger(MercadoPagoProvider.name);
  private payment: Payment;
  private paymentSearch: PaymentSearch;
  private readonly isMock: boolean;

  constructor(private configService: ConfigService) {
    const accessToken = this.configService.get<string>('MERCADO_PAGO_ACCESS_TOKEN', '');

    this.isMock =
      !accessToken ||
      accessToken.startsWith('mock') ||
      accessToken === 'seu_access_token_mp' ||
      accessToken === 'YOUR_MP_TOKEN';

    if (!this.isMock) {
      const client = new MercadoPagoConfig({
        accessToken,
        options: { timeout: 30000 },
      });
      this.payment = new Payment(client);
      this.paymentSearch = new PaymentSearch(client);
      this.logger.log('Mercado Pago SDK initialized [production]');
    } else {
      this.logger.warn('Mercado Pago token not configured — running in MOCK mode');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRIAR COBRANÇA PIX
  // ─────────────────────────────────────────────────────────────────────────
  async createPixCharge(params: CreatePixChargeParams): Promise<PixChargeResult> {
    if (this.isMock) return this.mockCreatePixCharge(params);

    try {
      const expirationDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const body: any = {
        transaction_amount: params.amount,
        description:        params.description,
        payment_method_id:  'pix',
        date_of_expiration: expirationDate,
        external_reference: params.externalId,
        payer: {
          email:      params.customerEmail,
          first_name: params.customerName.split(' ')[0],
          last_name:  params.customerName.split(' ').slice(1).join(' ') || params.customerName,
        },
      };

      if (params.customerDocument) {
        const doc = params.customerDocument.replace(/\D/g, '');
        body.payer.identification = {
          type:   doc.length === 11 ? 'CPF' : 'CNPJ',
          number: doc,
        };
      }

      const result = await this.payment.create({
        body,
        requestOptions: { idempotencyKey: params.externalId },
      });

      const qrData = result.point_of_interaction?.transaction_data;

      return {
        id:        String(result.id),
        status:    result.status || 'pending',
        qrCode:    qrData?.qr_code_base64
          ? `data:image/png;base64,${qrData.qr_code_base64}`
          : await this.generateQrCodeBase64(qrData?.qr_code || ''),
        copyPaste: qrData?.qr_code || '',
        expiresAt: expirationDate,
      };
    } catch (error) {
      const msg =
        error?.cause?.[0]?.description ||
        error?.message ||
        'Erro desconhecido';
      this.logger.error('createPixCharge error:', msg);
      throw new BadRequestException(`Erro ao criar cobrança PIX: ${msg}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONSULTAR PAGAMENTO POR ID
  // ─────────────────────────────────────────────────────────────────────────
  async getPayment(mpPaymentId: string | number): Promise<MPPayment | null> {
    if (this.isMock) return null;

    try {
      const result = await this.payment.get({ id: String(mpPaymentId) });
      return result as unknown as MPPayment;
    } catch (error) {
      this.logger.error(`getPayment(${mpPaymentId}) error:`, error?.message);
      return null;
    }
  }

  async getPaymentById(mpPaymentId: string): Promise<MPPayment | null> {
    return this.getPayment(mpPaymentId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONSULTAR STATUS POR external_reference (polling de fallback)
  // ─────────────────────────────────────────────────────────────────────────
  async getPaymentStatus(externalId: string): Promise<string> {
    if (this.isMock) return 'pending';

    try {
      const results = await this.paymentSearch.search({
        options: { external_reference: externalId, limit: 1 },
      });
      const payment = results?.results?.[0];
      return (payment as any)?.status || 'pending';
    } catch (error) {
      this.logger.error('getPaymentStatus error:', error?.message);
      return 'pending';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ENVIAR PIX (saque — requer aprovação especial do MP para PJ)
  // ─────────────────────────────────────────────────────────────────────────
  async sendPixTransfer(params: PixTransferParams): Promise<{ id: string; status: string }> {
    if (this.isMock) {
      return { id: `mock_transfer_${params.externalId}`, status: 'pending' };
    }
    this.logger.warn(
      `PIX transfer pending manual processing: ${params.externalId} → ${params.pixKey} R$${params.amount}`,
    );
    return { id: `mp_transfer_${params.externalId}`, status: 'pending' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MOCK
  // ─────────────────────────────────────────────────────────────────────────
  private async mockCreatePixCharge(params: CreatePixChargeParams): Promise<PixChargeResult> {
    const mockPayload = `00020126580014br.gov.bcb.pix0136${params.externalId.slice(0, 36)}5204000053039865802BR5913${params.customerName.substring(0, 13).padEnd(13)}6009SAO PAULO62070503***6304ABCD`;
    return {
      id:        `mp_mock_${Date.now()}`,
      status:    'pending',
      qrCode:    await this.generateQrCodeBase64(mockPayload),
      copyPaste: mockPayload,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  private async generateQrCodeBase64(text: string): Promise<string> {
    try {
      const QRCode = require('qrcode');
      return await QRCode.toDataURL(text || 'empty');
    } catch {
      return '';
    }
  }
}
