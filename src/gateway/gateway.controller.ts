import {
  Controller, Post, Get, Body, Param, UseGuards, UseInterceptors,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiHeader, ApiParam, ApiSecurity,
} from '@nestjs/swagger';
import { GatewayService } from './gateway.service';
import { ClientAuthGuard } from './guards/client-auth.guard';
import { GatewayLoggerInterceptor } from './interceptors/gateway-logger.interceptor';
import { ApiClient } from './decorators/api-client.decorator';
import { CreateGatewayPixDto } from './dto/create-gateway-pix.dto';
import { CreateGatewayPaymentDto } from './dto/create-gateway-payment.dto';

@ApiTags('Gateway')
@ApiSecurity('client_id')
@ApiSecurity('client_secret')
@ApiHeader({ name: 'client_id', description: 'Client ID gerado pelo sistema', required: true })
@ApiHeader({ name: 'client_secret', description: 'Client Secret gerado na criação (hash bcrypt validado)', required: true })
@UseGuards(ClientAuthGuard)
@UseInterceptors(GatewayLoggerInterceptor)
@Controller('gateway')
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // POST /gateway/pix/create
  // ─────────────────────────────────────────────────────────────────────────
  @Post('pix/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Criar cobrança PIX via gateway',
    description:
      'Gera um QR Code e código Copia e Cola PIX usando o token Mercado Pago do usuário dono das credenciais.',
  })
  async createPix(
    @ApiClient('userId') userId: string,
    @Body() dto: CreateGatewayPixDto,
  ) {
    return this.gatewayService.createPixCharge(userId, dto);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /gateway/payment/create
  // ─────────────────────────────────────────────────────────────────────────
  @Post('payment/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Criar pagamento genérico via gateway',
    description:
      'Suporta PIX, cartão de crédito, cartão de débito e outros métodos do Mercado Pago.',
  })
  async createPayment(
    @ApiClient('userId') userId: string,
    @Body() dto: CreateGatewayPaymentDto,
  ) {
    return this.gatewayService.createPayment(userId, dto);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /gateway/payment/:id
  // ─────────────────────────────────────────────────────────────────────────
  @Get('payment/:id')
  @ApiOperation({ summary: 'Consultar status de um pagamento pelo ID do Mercado Pago' })
  @ApiParam({ name: 'id', description: 'ID do pagamento no Mercado Pago', example: '1234567890' })
  async getPayment(
    @ApiClient('userId') userId: string,
    @Param('id') paymentId: string,
  ) {
    return this.gatewayService.getPayment(userId, paymentId);
  }
}
