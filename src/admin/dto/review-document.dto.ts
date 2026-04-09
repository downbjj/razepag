import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum DocumentAction {
  APPROVE = 'APPROVE',
  REJECT  = 'REJECT',
}

export class ReviewDocumentDto {
  @IsEnum(DocumentAction)
  action: DocumentAction;

  @IsOptional()
  @IsString()
  @MinLength(3)
  note?: string;
}
