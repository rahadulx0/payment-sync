import { IsEmail, IsNotEmpty, IsString, Length, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class TotpVerifyDto {
  @IsString()
  @IsNotEmpty()
  mfa_token!: string;

  @IsString()
  @Length(6, 10)
  code!: string;
}

export class MfaTokenDto {
  @IsString()
  @IsNotEmpty()
  mfa_token!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  current_password!: string;

  @IsString()
  @MinLength(12)
  new_password!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
