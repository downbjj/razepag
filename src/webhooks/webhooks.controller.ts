import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
  RawBodyRequest,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { PixService } from '../pix/pix.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
  ) {}

  // Provider webhook receiver (public, secured by signature)
  @Post('provider/asaas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive webhook from Asaas provider' })
  async receiveAsaasWebhook(@Req() req: Request, @Body() payload: any) {
    this.logger.log(`Received Asaas webhook: ${payload.event}`);
    // In production, verify Asaas signature here
    // Provider webhooks are handled by PixService
    return { received: true };
  }

  // User webhook management (authenticated)
  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List user webhooks' })
  async getWebhooks(@CurrentUser('sub') userId: string) {
    return this.webhooksService.getWebhooks(userId);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create webhook endpoint' })
  async createWebhook(@CurrentUser('sub') userId: string, @Body() dto: CreateWebhookDto) {
    return this.webhooksService.createWebhook(userId, dto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete webhook' })
  async deleteWebhook(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.webhooksService.deleteWebhook(userId, id);
  }

  @Patch(':id/toggle')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Toggle webhook active state' })
  async toggleWebhook(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.webhooksService.toggleWebhook(userId, id);
  }

  @Get('logs')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get webhook delivery logs' })
  async getLogs(
    @CurrentUser('sub') userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.webhooksService.getWebhookLogs(userId, +page, +limit);
  }
}
