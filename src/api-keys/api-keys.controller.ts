import {
  Controller, Get, Post, Delete, Patch, Body, Param, Query,
  UseGuards, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
import { GatewayClientService } from './gateway-client.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientIpsDto } from './dto/update-client-ips.dto';

// ─────────────────────────────────────────────────────────────────────────────
// USER — /api/api-keys/clients
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('Credentials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly svc: GatewayClientService) {}

  @Get('clients')
  @ApiOperation({ summary: 'Listar credenciais do usuário logado' })
  async list(@CurrentUser('sub') userId: string) {
    return this.svc.listByUser(userId);
  }

  @Post('clients')
  @ApiOperation({
    summary: 'Criar credenciais (client_id + client_secret)',
    description:
      '⚠️ O client_secret é retornado **UMA ÚNICA VEZ**. ' +
      'Não é possível recuperá-lo depois. Guarde em local seguro.',
  })
  async create(@CurrentUser('sub') userId: string, @Body() dto: CreateClientDto) {
    return this.svc.create(userId, dto);
  }

  @Patch('clients/:id/reset')
  @ApiOperation({
    summary: 'Resetar credenciais — gera novo client_id + client_secret',
    description: 'As credenciais anteriores são invalidadas imediatamente.',
  })
  @ApiParam({ name: 'id', description: 'ID interno da credencial (não o client_id)' })
  async reset(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.svc.resetCredentials(id, userId, false);
  }

  @Patch('clients/:id/toggle')
  @ApiOperation({ summary: 'Ativar ou desativar credencial' })
  async toggle(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.svc.toggleActive(id, userId, false);
  }

  @Patch('clients/:id/ips')
  @ApiOperation({
    summary: 'Atualizar lista de IPs permitidos',
    description: 'Envie [] para liberar qualquer IP.',
  })
  async updateIps(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateClientIpsDto,
  ) {
    return this.svc.updateAllowedIps(id, dto, userId, false);
  }

  @Delete('clients/:id')
  @ApiOperation({ summary: 'Excluir credencial permanentemente' })
  async delete(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.svc.delete(id, userId, false);
  }

  @Get('clients/:id/logs')
  @ApiOperation({ summary: 'Ver log de requisições da credencial' })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async logs(
    @CurrentUser('sub') _userId: string,
    @Param('id') id: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.getLogs(id, page, limit);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADMIN — /api/api-keys/admin/clients
  // ─────────────────────────────────────────────────────────────────────────

  @Get('admin/clients')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '[Admin] Listar todas as credenciais' })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async adminList(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.svc.listAll(page, limit);
  }

  @Post('admin/clients/:userId')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '[Admin] Criar credencial para um usuário específico' })
  async adminCreate(@Param('userId') targetId: string, @Body() dto: CreateClientDto) {
    return this.svc.create(targetId, dto);
  }

  @Patch('admin/clients/:id/reset')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '[Admin] Resetar credenciais de qualquer client' })
  async adminReset(@Param('id') id: string, @CurrentUser('sub') adminId: string) {
    return this.svc.resetCredentials(id, adminId, true);
  }

  @Patch('admin/clients/:id/toggle')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '[Admin] Ativar / desativar qualquer client' })
  async adminToggle(@Param('id') id: string, @CurrentUser('sub') adminId: string) {
    return this.svc.toggleActive(id, adminId, true);
  }

  @Patch('admin/clients/:id/ips')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '[Admin] Atualizar IPs de qualquer client' })
  async adminIps(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body() dto: UpdateClientIpsDto,
  ) {
    return this.svc.updateAllowedIps(id, dto, adminId, true);
  }

  @Delete('admin/clients/:id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '[Admin] Excluir qualquer client' })
  async adminDelete(@Param('id') id: string, @CurrentUser('sub') adminId: string) {
    return this.svc.delete(id, adminId, true);
  }

  @Get('admin/clients/:id/logs')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '[Admin] Ver logs de qualquer client' })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async adminLogs(
    @Param('id') id: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.getLogs(id, page, limit);
  }
}
