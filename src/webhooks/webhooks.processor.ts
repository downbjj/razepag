import { Process, Processor, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import axios from 'axios';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Processor('webhooks')
export class WebhooksProcessor {
  private readonly logger = new Logger(WebhooksProcessor.name);

  constructor(private prisma: PrismaService) {}

  @Process('send')
  async sendWebhook(job: Job<{
    logId: string;
    webhookId: string;
    url: string;
    secret: string;
    payload: any;
    attempt: number;
  }>) {
    const { logId, url, secret, payload } = job.data;
    const payloadStr = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');

    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Event': payload.event,
          'User-Agent': 'PaymentGateway-Webhook/1.0',
        },
        timeout: 10000,
      });

      await this.prisma.webhookLog.update({
        where: { id: logId },
        data: {
          responseStatus: response.status,
          responseBody: JSON.stringify(response.data).substring(0, 1000),
          success: true,
          attempts: job.attemptsMade + 1,
        },
      });

      this.logger.log(`Webhook delivered: ${logId} -> ${url} [${response.status}]`);
    } catch (error) {
      const status = error.response?.status;
      const body = error.response?.data ? JSON.stringify(error.response.data).substring(0, 500) : error.message;

      await this.prisma.webhookLog.update({
        where: { id: logId },
        data: {
          responseStatus: status || 0,
          responseBody: body,
          success: false,
          attempts: job.attemptsMade + 1,
          nextRetryAt: new Date(Date.now() + Math.pow(2, job.attemptsMade) * 5000),
        },
      });

      this.logger.warn(`Webhook failed: ${logId} -> ${url} [${status || 'no response'}] - attempt ${job.attemptsMade + 1}`);
      throw error;
    }
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Webhook job ${job.id} permanently failed: ${error.message}`);
  }
}
