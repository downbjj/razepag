import {
  Injectable,
  BadGatewayException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';

const MP_API = 'https://api.mercadopago.com';

export interface MpPixResult {
  id: number;
  status: string;
  statusDetail: string;
  externalReference: string;
  amount: number;
  pix: {
    qrCode: string;
    copyPaste: string;
    expiresAt: string;
  } | null;
}

export interface MpPaymentResult {
  id: number;
  status: string;
  statusDetail: string;
  externalReference: string;
  amount: number;
  paymentMethodId: string;
  pix: {
    qrCode: string;
    copyPaste: string;
    expiresAt: string;
  } | null;
}

@Injectable()
export class MercadoPagoGatewayService {
  private readonly logger = new Logger(MercadoPagoGatewayService.name);

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE PIX PAYMENT
  // ─────────────────────────────────────────────────────────────────────────
  async createPixPayment(
    accessToken: string,
    data: {
      amount: number;
      description: string;
      payerEmail: string;
      payerName: string;
      payerCpf?: string;
      externalReference?: string;
    },
  ): Promise<MpPixResult> {
    const [firstName, ...rest] = data.payerName.split(' ');
    const lastName = rest.join(' ') || firstName;

    const body: Record<string, any> = {
      transaction_amount: data.amount,
      description:        data.description,
      payment_method_id:  'pix',
      external_reference: data.externalReference ?? uuidv4(),
      payer: {
        email:     data.payerEmail,
        first_name: firstName,
        last_name:  lastName,
      },
    };

    if (data.payerCpf) {
      body.payer.identification = { type: 'CPF', number: data.payerCpf };
    }

    const response = await this.call<any>(accessToken, 'POST', '/v1/payments', body);

    return this.normalisePix(response);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE GENERIC PAYMENT
  // ─────────────────────────────────────────────────────────────────────────
  async createPayment(
    accessToken: string,
    data: {
      amount: number;
      description: string;
      paymentMethodId: string;
      payerEmail: string;
      payerName: string;
      payerCpf?: string;
      token?: string;
      installments?: number;
      issuerId?: string;
      externalReference?: string;
    },
  ): Promise<MpPaymentResult> {
    const [firstName, ...rest] = data.payerName.split(' ');
    const lastName = rest.join(' ') || firstName;

    const body: Record<string, any> = {
      transaction_amount: data.amount,
      description:        data.description,
      payment_method_id:  data.paymentMethodId,
      external_reference: data.externalReference ?? uuidv4(),
      payer: {
        email:     data.payerEmail,
        first_name: firstName,
        last_name:  lastName,
      },
    };

    if (data.payerCpf) {
      body.payer.identification = { type: 'CPF', number: data.payerCpf };
    }
    if (data.token)        body.token = data.token;
    if (data.installments) body.installments = data.installments;
    if (data.issuerId)     body.issuer_id = data.issuerId;

    const response = await this.call<any>(accessToken, 'POST', '/v1/payments', body);

    return this.normalisePayment(response);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET PAYMENT BY ID
  // ─────────────────────────────────────────────────────────────────────────
  async getPayment(accessToken: string, paymentId: string): Promise<MpPaymentResult> {
    const response = await this.call<any>(accessToken, 'GET', `/v1/payments/${paymentId}`);
    return this.normalisePayment(response);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INTERNAL: HTTP call to Mercado Pago
  // ─────────────────────────────────────────────────────────────────────────
  private async call<T>(
    accessToken: string,
    method: 'GET' | 'POST',
    path: string,
    body?: any,
  ): Promise<T> {
    try {
      const response = await axios.request<T>({
        method,
        url: `${MP_API}${path}`,
        data: body,
        headers: {
          Authorization:   `Bearer ${accessToken}`,
          'Content-Type':  'application/json',
          'X-Idempotency-Key': uuidv4(),
        },
        timeout: 20000,
      });
      return response.data;
    } catch (err) {
      this.handleMpError(err as AxiosError);
    }
  }

  private handleMpError(err: AxiosError): never {
    const status  = err.response?.status;
    const mpData  = err.response?.data as any;
    const message = mpData?.message ?? mpData?.cause?.[0]?.description ?? err.message;

    this.logger.error(`MercadoPago error ${status}: ${message}`, mpData);

    if (status === 400 || status === 422) {
      throw new UnprocessableEntityException(`Mercado Pago: ${message}`);
    }
    if (status === 401 || status === 403) {
      throw new BadGatewayException('Token Mercado Pago inválido ou expirado');
    }
    throw new BadGatewayException(`Erro ao comunicar com Mercado Pago: ${message}`);
  }

  // ─── Response normalisers ─────────────────────────────────────────────────

  private normalisePix(raw: any): MpPixResult {
    const txInfo = raw.point_of_interaction?.transaction_data;
    return {
      id:              raw.id,
      status:          raw.status,
      statusDetail:    raw.status_detail,
      externalReference: raw.external_reference,
      amount:          raw.transaction_amount,
      pix: txInfo
        ? {
            qrCode:    txInfo.qr_code_base64 ?? txInfo.qr_code ?? '',
            copyPaste: txInfo.qr_code ?? '',
            expiresAt: raw.date_of_expiration ?? '',
          }
        : null,
    };
  }

  private normalisePayment(raw: any): MpPaymentResult {
    const txInfo = raw.point_of_interaction?.transaction_data;
    return {
      id:              raw.id,
      status:          raw.status,
      statusDetail:    raw.status_detail,
      externalReference: raw.external_reference,
      amount:          raw.transaction_amount,
      paymentMethodId: raw.payment_method_id,
      pix: txInfo
        ? {
            qrCode:    txInfo.qr_code_base64 ?? txInfo.qr_code ?? '',
            copyPaste: txInfo.qr_code ?? '',
            expiresAt: raw.date_of_expiration ?? '',
          }
        : null,
    };
  }
}
