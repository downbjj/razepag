import { Module } from '@nestjs/common';
import { PublicApiController } from './public-api.controller';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { PixModule } from '../pix/pix.module';
import { ClientAuthGuard } from '../gateway/guards/client-auth.guard';
import { GatewayLoggerInterceptor } from '../gateway/interceptors/gateway-logger.interceptor';
import { GatewayClientService } from '../api-keys/gateway-client.service';

@Module({
  imports: [ApiKeysModule, PixModule],
  controllers: [PublicApiController],
  providers: [ClientAuthGuard, GatewayLoggerInterceptor, GatewayClientService],
})
export class PublicApiModule {}
