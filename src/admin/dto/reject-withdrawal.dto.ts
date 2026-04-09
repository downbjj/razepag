import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectWithdrawalDto {
  @ApiProperty({ example: 'Invalid PIX key' })
  @IsString()
  @MinLength(3)
  reason: string;
}
