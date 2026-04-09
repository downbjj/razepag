import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private prisma: PrismaService) {}

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

      // Fire-and-forget with retry via setTimeout
      this.sendWebhookWithRetry({
        logId: log.id,
        url: webhook.url,
        secret: webhook.secret,
        payload: fullPayload,
        attempt: 1,
        maxAttempts: 5,
      });
    }
  }

  generateSignature(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  private sendWebhookWithRetry(opts: {
    logId: string;
    url: string;
    secret: string;
    payload: any;
    attempt: number;
    maxAttempts: number;
  }) {
    const { logId, url, secret, payload, attempt, maxAttempts } = opts;
    const payloadStr = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');

    axios
      .post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Event': payload.event,
          'User-Agent': 'PaymentGateway-Webhook/1.0',
        },
        timeout: 10000,
      })
      .then(async (response) => {
        await this.prisma.webhookLog.update({
          where: { id: logId },
          data: {
            responseStatus: response.status,
            responseBody: JSON.stringify(response.data).substring(0, 1000),
            success: true,
            attempts: attempt,
          },
        });
        this.logger.log(`Webhook delivered: ${logId} -> ${url} [${response.status}]`);
      })
      .catch(async (error) => {
        const status = error.response?.status;
        const body = error.response?.data
          ? JSON.stringify(error.response.data).substring(0, 500)
          : error.message;

        const nextRetryDelay = Math.pow(2, attempt - 1) * 5000; // 5s, 10s, 20s, 40s, 80s

        await this.prisma.webhookLog
          .update({
            where: { id: logId },
            data: {
              responseStatus: status || 0,
              responseBody: body,
              success: false,
              attempts: attempt,
              nextRetryAt:
                attempt < maxAttempts ? new Date(Date.now() + nextRetryDelay) : null,
            },
          })
          .catch(() => {});

        this.logger.warn(
          `Webhook failed: ${logId} -> ${url} [${status || 'no response'}] - attempt ${attempt}/${maxAttempts}`,
        );

        if (attempt < maxAttempts) {
          setTimeout(() => {
            this.sendWebhookWithRetry({
              ...opts,
              attempt: attempt + 1,
            });
          }, nextRetryDelay);
        } else {
          this.logger.error(`Webhook permanently failed after ${maxAttempts} attempts: ${logId}`);
        }
      });
  }
}
