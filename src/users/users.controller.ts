import { Controller, Get, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateMercadoPagoDto } from './dto/update-mercadopago.dto';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile with wallet' })
  async getProfile(@CurrentUser('sub') userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(@CurrentUser('sub') userId: string, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get user dashboard data' })
  async getDashboard(@CurrentUser('sub') userId: string) {
    return this.usersService.getDashboard(userId);
  }

  @Patch('me/mercadopago')
  @ApiOperation({
    summary: 'Salvar / atualizar token Mercado Pago do usuário',
    description:
      'O token é criptografado com AES-256 antes de ser armazenado. ' +
      'Obrigatório para usar os endpoints /gateway/*.',
  })
  async updateMercadoPagoToken(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateMercadoPagoDto,
  ) {
    return this.usersService.updateMercadoPagoToken(userId, dto.accessToken);
  }

  @Get('me/mercadopago/status')
  @ApiOperation({ summary: 'Verificar se o usuário tem token MP configurado (sem revelar o valor)' })
  async getMercadoPagoStatus(@CurrentUser('sub') userId: string) {
    const hasToken = await this.usersService.hasMercadoPagoToken(userId);
    return { configured: hasToken };
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Get user notifications' })
  async getNotifications(@CurrentUser('sub') userId: string) {
    return this.usersService.getNotifications(userId);
  }

  @Patch('notifications/:id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  async markNotificationRead(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.usersService.markNotificationRead(userId, id);
  }
}
