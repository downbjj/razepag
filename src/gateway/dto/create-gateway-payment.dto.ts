import {
  IsNumber, IsString, IsOptional, Min, Max, IsEmail, MinLength, IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGatewayPaymentDto {
  @ApiProperty({ example: 500.00, description: 'Valor do pagamento em BRL' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100000)
  amount: number;

  @ApiProperty({ example: 'Compra na loja X', description: 'Descrição do pagamento' })
  @IsString()
  @MinLength(1)
  description: string;

  @ApiProperty({
    example: 'pix',
    description: 'Método de pagamento: pix, credit_card, debit_card, bolbradesco, etc.',
  })
  @IsString()
  paymentMethodId: string;

  @ApiProperty({ example: 'joao@email.com' })
  @IsEmail()
  payerEmail: string;

  @ApiProperty({ example: 'João Silva' })
  @IsString()
  @MinLength(2)
  payerName: string;

  @ApiPropertyOptional({ example: '12345678909', description: 'CPF (somente números)' })
  @IsOptional()
  @IsString()
  payerCpf?: string;

  @ApiPropertyOptional({
    example: 'abc123token',
    description: 'Token do cartão (gerado pelo SDK do MP, obrigatório para credit/debit_card)',
  })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({ example: 1, description: 'Parcelas (para cartão de crédito)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(18)
  installments?: number;

  @ApiPropertyOptional({ example: '233', description: 'Emissor do cartão' })
  @IsOptional()
  @IsString()
  issuerId?: string;

  @ApiPropertyOptional({ example: 'order_xyz999', description: 'Referência externa do seu sistema' })
  @IsOptional()
  @IsString()
  externalReference?: string;
}
