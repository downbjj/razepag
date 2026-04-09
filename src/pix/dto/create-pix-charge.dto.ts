import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePixChargeDto {
  @ApiProperty({ example: 100.00, description: 'Amount in BRL' })
  @IsNumber()
  @Min(0.01)
  @Max(50000)
  amount: number;

  @ApiPropertyOptional({ example: 'Payment for service' })
  @IsOptional()
  @IsString()
  description?: string;
}
