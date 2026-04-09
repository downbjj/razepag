import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { PixService } from './pix.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreatePixChargeDto } from './dto/create-pix-charge.dto';
import { SendPixDto } from './dto/send-pix.dto';
import { TransferDto } from './dto/transfer.dto';

@ApiTags('PIX')
@Controller('pix')
export class PixController {
  private readonly logger = new Logger(PixController.name);

  constructor(private readonly pixService: PixService) {}

  @Post('charge')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Criar cobrança PIX (QR Code)' })
  async createCharge(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePixChargeDto,
  ) {
    return this.pixService.createCharge(userId, dto);
  }

  @Post('send')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar PIX para chave externa' })
  async sendPix(
    @CurrentUser('sub') userId: string,
    @Body() dto: SendPixDto,
  ) {
    return this.pixService.sendPix(userId, dto);
  }

  @Post('transfer')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transferência interna entre usuários pela chave PIX' })
  async transfer(
    @CurrentUser('sub') userId: string,
    @Body() dto: TransferDto,
  ) {
    return this.pixService.transferToUser(userId, dto.pixKey, dto.amount, dto.description);
  }

  @Get('transactions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Listar transações do usuário' })
  @ApiQuery({ name: 'page',   required: false, type: Number })
  @ApiQuery({ name: 'limit',  required: false, type: Number })
  @ApiQuery({ name: 'type',   required: false })
  @ApiQuery({ name: 'status', required: false })
  async getTransactions(
    @CurrentUser('sub') userId: string,
    @Query('page')   page   = 1,
    @Query('limit')  limit  = 20,
    @Query('type')   type?:  string,
    @Query('status') status?: string,
  ) {
    return this.pixService.getTransactions(userId, +page, +limit, type, status);
  }

  @Get('transactions/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Detalhes de uma transação' })
  async getTransaction(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.pixService.getTransaction(userId, id);
  }

  /**
   * POST /pix/webhook
   * Recebe notificações do Mercado Pago.
   *
   * Segurança:
   * - Sem autenticação JWT (MP não envia token)
   * - Extrai APENAS o payment ID do body
   * - SEMPRE consulta a API do MP para validar o status real
   * - Nunca confia em status, valor ou qualquer campo do body
   *
   * URL configurada no painel MP: https://razepague.com/api/pix/webhook
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook do Mercado Pago (sem autenticação)' })
  async mercadoPagoWebhook(
    @Body() payload: any,
    @Req()  req: Request,
  ) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    this.logger.log(`Webhook recebido de IP: ${ip}`);
    return this.pixService.handleMercadoPagoWebhook(payload);
  }

  /**
   * POST /pix/webhook/provider
   * Webhook legado para compatibilidade.
   */
  @Post('webhook/provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook genérico do provedor (legado)' })
  async providerWebhook(@Body() payload: any) {
    return this.pixService.handleWebhookFromProvider(payload);
  }
}
