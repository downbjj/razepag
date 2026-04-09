import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface CreatePixChargeParams {
  externalId: string;
  amount: number;
  description: string;
  customerName: string;
  customerEmail: string;
  customerDocument?: string;
}

export interface PixChargeResult {
  id: string;        // MP numeric payment ID
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
  status: string;                 // 'approved' | 'pending' | 'rejected' | 'cancelled' | 'in_process'
  status_detail: string;
  external_reference: string;     // our UUID (externalId)
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
  private client: AxiosInstance;
  private readonly accessToken: string;
  private readonly isMock: boolean;

  constructor(private configService: ConfigService) {
    this.accessToken = this.configService.get<string>('MERCADO_PAGO_ACCESS_TOKEN', '');
    this.isMock =
      !this.accessToken ||
      this.accessToken.startsWith('mock') ||
      this.accessToken === 'YOUR_MP_TOKEN';

    if (!this.isMock) {
      this.client = axios.create({
        baseURL: 'https://api.mercadopago.com',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      this.logger.log('Mercado Pago provider initialized [production]');
    } else {
      this.logger.warn('Mercado Pago token not configured — running in MOCK mode');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRIAR COBRANÇA PIX
  // Retorna o payment ID do MP + QR Code
  // ─────────────────────────────────────────────────────────────────────────
  async createPixCharge(params: CreatePixChargeParams): Promise<PixChargeResult> {
    if (this.isMock) return this.mockCreatePixCharge(params);

    try {
      const expirationDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const payload: any = {
        transaction_amount: params.amount,
        description:        params.description,
        payment_method_id:  'pix',
        date_of_expiration: expirationDate,
        external_reference: params.externalId,   // nosso UUID — usado para lookup no webhook
        payer: {
          email:      params.customerEmail,
          first_name: params.customerName.split(' ')[0],
          last_name:  params.customerName.split(' ').slice(1).join(' ') || params.customerName,
        },
      };

      if (params.customerDocument) {
        const doc = params.customerDocument.replace(/\D/g, '');
        payload.payer.identification = {
          type:   doc.length === 11 ? 'CPF' : 'CNPJ',
          number: doc,
        };
      }

      const response = await this.client.post('/v1/payments', payload, {
        headers: { 'X-Idempotency-Key': params.externalId },
      });

      const payment = response.data as MPPayment;
      const qrData  = payment.point_of_interaction?.transaction_data;

      return {
        id:        String(payment.id),
        status:    payment.status,
        qrCode:    qrData?.qr_code_base64
          ? `data:image/png;base64,${qrData.qr_code_base64}`
          : await this.generateQrCodeBase64(qrData?.qr_code || ''),
        copyPaste: qrData?.qr_code || '',
        expiresAt: expirationDate,
      };
    } catch (error) {
      const mpError =
        error.response?.data?.message ||
        error.response?.data?.cause?.[0]?.description ||
        error.message;
      this.logger.error('createPixCharge error:', mpError);
      throw new BadRequestException(`Erro ao criar cobrança PIX: ${mpError}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONSULTAR PAGAMENTO POR ID (usado no webhook e no polling)
  // SEMPRE consulta a API — NUNCA confia no body do webhook
  // ─────────────────────────────────────────────────────────────────────────
  async getPayment(mpPaymentId: string | number): Promise<MPPayment | null> {
    if (this.isMock) return null;

    try {
      const response = await this.client.get(`/v1/payments/${mpPaymentId}`);
      return response.data as MPPayment;
    } catch (error) {
      this.logger.error(`getPayment(${mpPaymentId}) error:`, error.message);
      return null;
    }
  }

  // Alias para compatibilidade
  async getPaymentById(mpPaymentId: string): Promise<MPPayment | null> {
    return this.getPayment(mpPaymentId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONSULTAR STATUS POR external_reference (polling)
  // ─────────────────────────────────────────────────────────────────────────
  async getPaymentStatus(externalId: string): Promise<string> {
    if (this.isMock) return 'pending';

    try {
      const response = await this.client.get('/v1/payments/search', {
        params: { external_reference: externalId, limit: 1 },
      });
      const payment = response.data?.results?.[0];
      return payment?.status || 'pending';
    } catch (error) {
      this.logger.error('getPaymentStatus error:', error.message);
      return 'pending';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ENVIAR TRANSFERÊNCIA PIX (saque para chave externa)
  // ─────────────────────────────────────────────────────────────────────────
  async sendPixTransfer(params: PixTransferParams): Promise<{ id: string; status: string }> {
    if (this.isMock) {
      return { id: `mock_transfer_${params.externalId}`, status: 'pending' };
    }
    // Mercado Pago não oferece envio de PIX via API pública para PJ sem aprovação especial.
    // Por ora, registra para processamento manual.
    this.logger.warn(`PIX transfer pending manual processing: ${params.externalId} → ${params.pixKey} R$${params.amount}`);
    return { id: `mp_transfer_${params.externalId}`, status: 'pending' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MOCK
  // ─────────────────────────────────────────────────────────────────────────
  private async mockCreatePixCharge(params: CreatePixChargeParams): Promise<PixChargeResult> {
    const mockId = `mp_mock_${Date.now()}`;
    const mockPayload = `00020126580014br.gov.bcb.pix0136${params.externalId.slice(0, 36)}5204000053039865802BR5913${params.customerName.substring(0, 13).padEnd(13)}6009SAO PAULO62070503***6304ABCD`;

    return {
      id:        mockId,
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
