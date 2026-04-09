import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateClientIpsDto {
  @ApiProperty({
    example: ['192.168.1.100', '203.0.113.5'],
    description: 'Nova lista completa de IPs permitidos. Envie [] para liberar todos.',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  allowedIps: string[];
}
