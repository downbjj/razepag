import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateMercadoPagoDto {
  @ApiProperty({
    example: 'APP_USR-1234567890abcdef',
    description:
      'Access token do Mercado Pago. Obtido em https://www.mercadopago.com.br/developers/panel/app. ' +
      'Armazenado criptografado com AES-256.',
  })
  @IsString()
  @MinLength(10)
  accessToken: string;
}
