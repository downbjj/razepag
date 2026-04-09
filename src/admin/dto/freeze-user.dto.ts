import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FreezeUserDto {
  @ApiProperty({ example: 'Suspicious activity detected' })
  @IsString()
  @MinLength(5)
  reason: string;
}
