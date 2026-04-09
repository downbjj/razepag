import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum CryptoWithdrawalAction {
  APPROVE = 'APPROVE',
  REJECT  = 'REJECT',
}

export class ReviewCryptoWithdrawalDto {
  @IsEnum(CryptoWithdrawalAction)
  action: CryptoWithdrawalAction;

  @IsOptional()
  @IsString()
  txHash?: string;

  @IsOptional()
  @IsString()
  adminNote?: string;
}
