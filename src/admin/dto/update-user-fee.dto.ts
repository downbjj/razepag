import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';

export class UpdateUserFeeDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  feePercent: number;

  @IsNumber()
  @Min(0)
  feeFixed: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
