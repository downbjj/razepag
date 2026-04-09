import { IsString, IsOptional, IsArray, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'My Integration Key' })
  @IsString()
  @MinLength(3)
  name: string;

  @ApiPropertyOptional({
    example: ['pix:create', 'pix:read'],
    description: 'Permissions: pix:create, pix:read, transfer:create, withdraw:create',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}
