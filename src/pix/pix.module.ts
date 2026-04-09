import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PixController } from './pix.controller';
import { PixService } from './pix.service';
import { MercadoPagoProvider } from './providers/mercadopago.provider';
import { WalletModule } from '../wallet/wallet.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PixProcessor } from './pix.processor';

@Module({
  imports: [
    WalletModule,
    WebhooksModule,
    BullModule.registerQueue({ name: 'pix' }),
  ],
  controllers: [PixController],
  providers: [PixService, MercadoPagoProvider, PixProcessor],
  exports: [PixService],
})
export class PixModule {}
