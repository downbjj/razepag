import { IsString, IsOptional, IsBoolean, IsArray, IsEnum } from 'class-validator';

export enum NotificationType { INFO = 'INFO', WARNING = 'WARNING', SUCCESS = 'SUCCESS', ERROR = 'ERROR' }

export class SendNotificationDto {
  @IsString()
  title: string;

  @IsString()
  message: string;

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  @IsBoolean()
  broadcast?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];
}
