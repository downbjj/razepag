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
  dueDate?: string;
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

@Injectable()
export class AsaasProvider {
  private readonly logger = new Logger(AsaasProvider.name);
  private client: AxiosInstance;
  private readonly isMock: boolean;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('ASAAS_API_KEY', '');
    const env = this.configService.get<string>('ASAAS_ENV', 'sandbox');

    this.isMock = !apiKey || apiKey === 'YOUR_ASAAS_API_KEY' || apiKey.startsWith('mock');

    if (!this.isMock) {
      const baseURL = env === 'production'
        ? 'https://api.asaas.com/v3'
        : 'https://sandbox.asaas.com/api/v3';

      this.client = axios.create({
        baseURL,
        headers: {
          'access_token': apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      this.logger.log(`Asaas provider initialized [${env}]`);
    } else {
      this.logger.warn('Asaas API key not configured - running in MOCK mode');
    }
  }

  async createPixCharge(params: CreatePixChargeParams): Promise<PixChargeResult> {
    if (this.isMock) return this.mockCreatePixCharge(params);

    try {
      // Create or find customer
      const customer = await this.findOrCreateCustomer(
        params.customerName,
        params.customerEmail,
        params.customerDocument,
      );

      // Create payment
      const dueDate = params.dueDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const payment = await this.client.post('/payments', {
        customer: customer.id,
        billingType: 'PIX',
        value: params.amount,
        dueDate,
        description: params.description,
        externalReference: params.externalId,
      });

      // Get QR code
      const qrCode = await this.client.get(`/payments/${payment.data.id}/pixQrCode`);

      return {
        id: payment.data.id,
        status: payment.data.status,
        qrCode: qrCode.data.encodedImage || '',
        copyPaste: qrCode.data.payload || '',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    } catch (error) {
      this.logger.error('Asaas createPixCharge error:', error.response?.data || error.message);
      throw new BadRequestException(`PIX charge creation failed: ${error.response?.data?.errors?.[0]?.description || error.message}`);
    }
  }

  async getPaymentStatus(externalId: string): Promise<string> {
    if (this.isMock) return 'PENDING';

    try {
      const response = await this.client.get('/payments', {
        params: { externalReference: externalId, limit: 1 },
      });
      const payment = response.data.data?.[0];
      return payment?.status || 'PENDING';
    } catch (error) {
      this.logger.error('Asaas getPaymentStatus error:', error.message);
      return 'PENDING';
    }
  }

  async sendPixTransfer(params: PixTransferParams): Promise<{ id: string; status: string }> {
    if (this.isMock) return this.mockSendTransfer(params);

    try {
      const response = await this.client.post('/transfers', {
        value: params.amount,
        pixAddressKey: params.pixKey,
        description: params.description || 'Transfer',
        externalReference: params.externalId,
      });

      return {
        id: response.data.id,
        status: response.data.status,
      };
    } catch (error) {
      this.logger.error('Asaas sendPixTransfer error:', error.response?.data || error.message);
      throw new BadRequestException(`PIX transfer failed: ${error.response?.data?.errors?.[0]?.description || error.message}`);
    }
  }

  private async findOrCreateCustomer(name: string, email: string, document?: string) {
    try {
      const existing = await this.client.get('/customers', { params: { email, limit: 1 } });
      if (existing.data.data?.length > 0) return existing.data.data[0];
    } catch {}

    const customerData: any = { name, email };
    if (document) customerData.cpfCnpj = document.replace(/\D/g, '');

    const created = await this.client.post('/customers', customerData);
    return created.data;
  }

  // Mock implementations for development/testing
  private async mockCreatePixCharge(params: CreatePixChargeParams): Promise<PixChargeResult> {
    const mockId = `mock_${params.externalId}`;
    const mockPayload = `00020126580014br.gov.bcb.pix0136${params.externalId}5204000053039865802BR5925${params.customerName.substring(0, 25)}6009SAO PAULO62070503***6304ABCD`;

    return {
      id: mockId,
      status: 'PENDING',
      qrCode: await this.generateMockQrCodeBase64(mockPayload),
      copyPaste: mockPayload,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  private async mockSendTransfer(params: PixTransferParams): Promise<{ id: string; status: string }> {
    return {
      id: `mock_transfer_${params.externalId}`,
      status: 'PENDING',
    };
  }

  private async generateMockQrCodeBase64(text: string): Promise<string> {
    try {
      const QRCode = require('qrcode');
      return await QRCode.toDataURL(text);
    } catch {
      return '';
    }
  }
}
