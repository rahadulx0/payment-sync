import { KeyType } from '@paysync/shared';
import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class IssueKeyDto {
  @IsEnum(KeyType)
  key_type!: KeyType;

  @IsString()
  @Length(1, 80)
  label!: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsString()
  expires_at?: string;
}
