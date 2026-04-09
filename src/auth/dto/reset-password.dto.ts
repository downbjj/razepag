import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ example: 'abc123token...' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'NewPass@123', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
