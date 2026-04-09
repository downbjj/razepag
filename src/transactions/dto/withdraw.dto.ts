import { IsNumber, IsString, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WithdrawDto {
  @ApiProperty({ example: 100.00, description: 'Amount to withdraw in BRL' })
  @IsNumber()
  @Min(10)
  @Max(50000)
  amount: number;

  @ApiProperty({ example: 'user@email.com', description: 'Destination PIX key' })
  @IsString()
  pixKey: string;

  @ApiPropertyOptional({ example: 'CPF', enum: ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'] })
  @IsOptional()
  @IsString()
  pixKeyType?: string;

  @ApiPropertyOptional({ example: 'Nubank' })
  @IsOptional()
  @IsString()
  bankName?: string;
}
