import { IsNumber, IsString, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminAdjustBalanceDto {
  @ApiProperty({ example: 100.00, description: 'Positive to credit, negative to debit' })
  @IsNumber()
  @Min(-100000)
  @Max(100000)
  amount: number;

  @ApiProperty({ example: 'Manual correction - support ticket #123' })
  @IsString()
  description: string;
}
