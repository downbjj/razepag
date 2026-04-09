import { Controller, Post, Patch, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WithdrawDto } from './dto/withdraw.dto';

@ApiTags('Transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('withdraw')
  @ApiOperation({ summary: 'Request a withdrawal via PIX' })
  async requestWithdrawal(@CurrentUser('sub') userId: string, @Body() dto: WithdrawDto) {
    return this.transactionsService.requestWithdrawal(userId, dto);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel pending withdrawal' })
  async cancelWithdrawal(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.transactionsService.cancelWithdrawal(userId, id);
  }
}
