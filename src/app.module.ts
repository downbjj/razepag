import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { TransactionsModule } from './transactions/transactions.module';
import { PixModule } from './pix/pix.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { WalletModule } from './wallet/wallet.module';
import { PublicApiModule } from './public-api/public-api.module';
import { GatewayModule } from './gateway/gateway.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
    }),

    ThrottlerModule.forRoot([
      { name: 'short',  ttl: 1000,  limit: 10  },
      { name: 'medium', ttl: 10000, limit: 50  },
      { name: 'long',   ttl: 60000, limit: 100 },
    ]),

    PrismaModule,
    AuthModule,
    UsersModule,
    AdminModule,
    TransactionsModule,
    PixModule,
    WebhooksModule,
    ApiKeysModule,
    WalletModule,
    PublicApiModule,
    GatewayModule,
  ],
})
export class AppModule {}
