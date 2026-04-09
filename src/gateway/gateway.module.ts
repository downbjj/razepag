import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { MercadoPagoGatewayService } from './services/mercadopago.service';
import { ClientAuthGuard } from './guards/client-auth.guard';
import { GatewayLoggerInterceptor } from './interceptors/gateway-logger.interceptor';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CryptoService } from '../common/services/crypto.service';

@Module({
  imports: [
    PrismaModule,
    ApiKeysModule,  // exports GatewayClientService — used by ClientAuthGuard + GatewayLoggerInterceptor
  ],
  controllers: [GatewayController],
  providers: [
    GatewayService,
    MercadoPagoGatewayService,
    ClientAuthGuard,
    GatewayLoggerInterceptor,
    CryptoService,
  ],
  exports: [GatewayService, MercadoPagoGatewayService],
})
export class GatewayModule {}
