import {
  Controller, Post, Get, Body, Param, Query,
  UseGuards, UseInterceptors, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiSecurity, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { ClientAuthGuard } from '../gateway/guards/client-auth.guard';
import { GatewayLoggerInterceptor } from '../gateway/interceptors/gateway-logger.interceptor';
import { ApiClient } from '../gateway/decorators/api-client.decorator';
import { PixService } from '../pix/pix.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePixChargeDto } from '../pix/dto/create-pix-charge.dto';
import { TransferDto } from '../pix/dto/transfer.dto';

@ApiTags('Public API v1')
@ApiSecurity('client_id')
@ApiSecurity('client_secret')
@ApiHeader({ name: 'client_id',     description: 'Client ID gerado pelo sistema',                    required: true })
@ApiHeader({ name: 'client_secret', description: 'Client Secret (mostrado somente na criação)', required: true })
@UseGuards(ClientAuthGuard)
@UseInterceptors(GatewayLoggerInterceptor)
@Controller('v1')
export class PublicApiController {
  constructor(
    private readonly pixService: PixService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('pix/charge')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Criar cobrança PIX' })
  async createCharge(
    @ApiClient('userId') userId: string,
    @Body() dto: CreatePixChargeDto,
  ) {
    return this.pixService.createCharge(userId, dto);
  }

  @Get('pix/charge/:id')
  @ApiOperation({ summary: 'Consultar status da cobrança' })
  async getCharge(
    @ApiClient('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.pixService.getTransaction(userId, id);
  }

  @Post('transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transferir para outro usuário pela chave PIX' })
  async transfer(
    @ApiClient('userId') userId: string,
    @Body() dto: TransferDto,
  ) {
    return this.pixService.transferToUser(userId, dto.pixKey, dto.amount, dto.description);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Listar transações' })
  async getTransactions(
    @ApiClient('userId') userId: string,
    @Query('page')   page  = 1,
    @Query('limit')  limit = 20,
    @Query('status') status?: string,
  ) {
    return this.pixService.getTransactions(userId, +page, +limit, undefined, status);
  }

  @Get('balance')
  @ApiOperation({ summary: 'Consultar saldo' })
  async getBalance(@ApiClient('userId') userId: string) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { balance: true, pendingBalance: true },
    });
    return user || { balance: 0, pendingBalance: 0 };
  }
}
