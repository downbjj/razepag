import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('webhooks') private webhooksQueue: Queue,
  ) {}

  async createWebhook(userId: string, dto: CreateWebhookDto) {
    const secret = crypto.randomBytes(32).toString('hex');
    return this.prisma.webhookConfig.create({
      data: {
        userId,
        url: dto.url,
        events: dto.events,
        secret,
        isActive: true,
      },
    });
  }

  async getWebhooks(userId: string) {
    return this.prisma.webhookConfig.findMany({
      where: { userId },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async deleteWebhook(userId: string, webhookId: string) {
    const webhook = await this.prisma.webhookConfig.findFirst({
      where: { id: webhookId, userId },
    });
    if (!webhook) throw new NotFoundException('Webhook not found');
    await this.prisma.webhookConfig.delete({ where: { id: webhookId } });
    return { message: 'Webhook deleted' };
  }

  async toggleWebhook(userId: string, webhookId: string) {
    const webhook = await this.prisma.webhookConfig.findFirst({
      where: { id: webhookId, userId },
    });
    if (!webhook) throw new NotFoundException('Webhook not found');

    return this.prisma.webhookConfig.update({
      where: { id: webhookId },
      data: { isActive: !webhook.isActive },
    });
  }

  async getWebhookLogs(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      this.prisma.webhookLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.webhookLog.count({ where: { userId } }),
    ]);
    return { logs, total, page, limit };
  }

  async triggerWebhook(userId: string, event: string, payload: any, transactionId?: string) {
    const allWebhooks = await this.prisma.webhookConfig.findMany({
      where: { userId, isActive: true },
    });
    const webhooks = allWebhooks.filter(w => (w.events as string[]).includes(event));

    for (const webhook of webhooks) {
      const logId = uuidv4();
      const fullPayload = {
        id: logId,
        event,
        timestamp: new Date().toISOString(),
        data: payload,
      };

      const log = await this.prisma.webhookLog.create({
        data: {
          id: logId,
          userId,
          webhookId: webhook.id,
          event,
          payload: fullPayload,
          transactionId,
          success: false,
        },
      });

      await this.webhooksQueue.add(
        'send',
        {
          logId: log.id,
          webhookId: webhook.id,
          url: webhook.url,
          secret: webhook.secret,
          payload: fullPayload,
          attempt: 1,
        },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: false,
        },
      );
    }
  }

  generateSignature(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }
}
