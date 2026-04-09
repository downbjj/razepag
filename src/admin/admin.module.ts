import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { WalletModule } from '../wallet/wallet.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WalletModule, WebhooksModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
