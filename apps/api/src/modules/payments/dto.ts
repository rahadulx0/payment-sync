import { Provider } from '@paysync/shared';
import { IsEnum, IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';

export class RegisterPaymentDto {
  @IsString()
  @Length(1, 80)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  order_id!: string;

  @IsString()
  @Length(1, 24)
  amount!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  transaction_id?: string;

  @IsOptional()
  @IsEnum(Provider)
  provider?: Provider;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  sender_msisdn?: string;

  @IsOptional()
  @IsString()
  callback_url?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CancelPaymentDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  reason?: string;
}

export class CorrectTrxidDto {
  @IsString()
  @Length(1, 64)
  transaction_id!: string;
}
