import { IsUrl, IsArray, ArrayNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const VALID_EVENTS = [
  'payment.completed',
  'payment.failed',
  'payment.pending',
  'transfer.completed',
  'transfer.received',
  'withdrawal.approved',
  'withdrawal.rejected',
];

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://yourserver.com/webhook' })
  @IsUrl({ require_tld: false })
  url: string;

  @ApiProperty({
    example: ['payment.completed', 'payment.failed'],
    description: `Valid events: ${VALID_EVENTS.join(', ')}`,
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events: string[];
}
