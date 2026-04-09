import { Module } from '@nestjs/common';
import { PixController } from './pix.controller';
import { PixService } from './pix.service';
import { MercadoPagoProvider } from './providers/mercadopago.provider';
import { WalletModule } from '../wallet/wallet.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WalletModule, WebhooksModule],
  controllers: [PixController],
  providers: [PixService, MercadoPagoProvider],
  exports: [PixService],
})
export class PixModule {}
