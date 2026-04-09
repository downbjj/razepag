import {
  IsNumber, IsString, IsOptional, Min, Max, IsEmail, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGatewayPixDto {
  @ApiProperty({ example: 150.00, description: 'Valor do pagamento em BRL' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100000)
  amount: number;

  @ApiProperty({ example: 'Pedido #1234', description: 'Descrição do pagamento' })
  @IsString()
  @MinLength(1)
  description: string;

  @ApiProperty({ example: 'joao@email.com', description: 'E-mail do pagador' })
  @IsEmail()
  payerEmail: string;

  @ApiProperty({ example: 'João Silva', description: 'Nome completo do pagador' })
  @IsString()
  @MinLength(2)
  payerName: string;

  @ApiPropertyOptional({ example: '12345678909', description: 'CPF do pagador (somente números)' })
  @IsOptional()
  @IsString()
  payerCpf?: string;

  @ApiPropertyOptional({
    example: 'order_abc123',
    description: 'Referência externa do seu sistema',
  })
  @IsOptional()
  @IsString()
  externalReference?: string;
}
