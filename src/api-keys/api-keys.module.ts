import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { GatewayClientService } from './gateway-client.service';

@Module({
  controllers: [ApiKeysController],
  providers: [GatewayClientService],
  exports: [GatewayClientService],
})
export class ApiKeysModule {}
