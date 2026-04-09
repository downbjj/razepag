import { IsNumber, IsString, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransferDto {
  @ApiProperty({ example: 'recipient@example.com', description: 'Recipient PIX key (must be registered on this platform)' })
  @IsString()
  pixKey: string;

  @ApiProperty({ example: 25.00 })
  @IsNumber()
  @Min(0.01)
  @Max(50000)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
