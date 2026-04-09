import { IsNumber, IsString, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendPixDto {
  @ApiProperty({ example: 'user@example.com', description: 'PIX key (email, CPF, phone, or UUID)' })
  @IsString()
  pixKey: string;

  @ApiProperty({ example: 50.00 })
  @IsNumber()
  @Min(0.01)
  @Max(50000)
  amount: number;

  @ApiPropertyOptional({ example: 'Payment description' })
  @IsOptional()
  @IsString()
  description?: string;
}
