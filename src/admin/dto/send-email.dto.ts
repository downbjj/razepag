import { IsString, IsEmail, IsOptional, IsArray, IsBoolean } from 'class-validator';

export class SendEmailDto {
  @IsOptional()
  @IsEmail()
  to?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  toUserIds?: string[];

  @IsOptional()
  @IsBoolean()
  broadcast?: boolean;

  @IsString()
  subject: string;

  @IsString()
  body: string;
}
