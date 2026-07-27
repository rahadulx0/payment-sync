import { UploadSource } from '@paysync/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class DeviceRegisterDto {
  @IsString()
  @Length(3, 32)
  company_code!: string;

  @IsString()
  @Length(1, 200)
  enroll_key!: string;

  @IsUUID()
  install_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  device_name?: string;

  @IsString()
  @MaxLength(80)
  model!: string;

  @IsString()
  @MaxLength(80)
  manufacturer!: string;

  @IsString()
  @MaxLength(40)
  android_version!: string;

  @IsString()
  @MaxLength(40)
  app_version!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  wallet_msisdn?: string;
}

export class HeartbeatDto {
  @IsString() app_version!: string;
  @IsString() android_version!: string;
  @IsNumber() battery_pct!: number;
  @IsBoolean() is_charging!: boolean;
  @IsBoolean() is_ignoring_battery_opt!: boolean;
  @IsBoolean() has_sms_permission!: boolean;
  @IsString() network_type!: string;
  @IsInt() pending_upload_count!: number;
  @IsInt() failed_upload_count!: number;
  @IsOptional() @IsISO8601() last_sms_local_at?: string;
  @IsISO8601() device_now!: string;
  @IsInt() config_version!: number;
  @IsOptional() @IsObject() flags?: { is_rooted?: boolean; is_emulator?: boolean };
}

class ParsedHintDto {
  @IsOptional() @IsString() transaction_id?: string;
  @IsOptional() @IsString() amount?: string;
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsString() sender_msisdn?: string;
  @IsOptional() @IsInt() parser_rule_version?: number;
}

export class SmsMessageDto {
  @IsString() @Matches(/^[0-9a-fA-F]{64}$/) client_msg_hash!: string;
  @IsString() @Length(1, 32) sms_address!: string;
  @IsString() @Length(1, 1000) raw_message!: string;
  @IsISO8601() device_received_at!: string;
  @IsOptional() @IsISO8601() device_sms_timestamp?: string;
  @IsOptional() @ValidateNested() @Type(() => ParsedHintDto) parsed_hint?: ParsedHintDto;
}

export class SmsUploadDto {
  @IsEnum(UploadSource) upload_source!: UploadSource;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SmsMessageDto)
  messages!: SmsMessageDto[];
}

class DeviceEventDto {
  @IsString() @MaxLength(40) type!: string;
  @IsISO8601() at!: string;
  @IsOptional() @IsObject() detail?: Record<string, unknown>;
}

export class DeviceEventsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DeviceEventDto)
  events!: DeviceEventDto[];
}
