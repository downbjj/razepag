import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { WalletModule } from '../wallet/wallet.module';
import { CryptoService } from '../common/services/crypto.service';

@Module({
  imports: [WalletModule],
  controllers: [UsersController],
  providers: [UsersService, CryptoService],
  exports: [UsersService],
})
export class UsersModule {}
