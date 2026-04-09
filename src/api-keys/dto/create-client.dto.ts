import {
  IsString, IsOptional, IsArray, MinLength, MaxLength, IsIP,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClientDto {
  @ApiProperty({ example: 'Minha Loja Online', description: 'Nome identificador do client' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    example: ['192.168.1.100', '10.0.0.1'],
    description: 'Lista de IPs permitidos. Vazio = aceita qualquer IP.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedIps?: string[];
}
