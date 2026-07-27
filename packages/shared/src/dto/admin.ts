/** Admin API DTOs — representative core surface (expanded in Task 04). */

import type { CompanyStatus, KeyType } from '../enums.js';

import type { IsoTimestamp } from './common.js';

export interface AdminLoginRequest {
  email: string;
  password: string;
}

export interface AdminLoginResponse {
  mfa_required?: boolean;
  enrolment_required?: boolean;
  mfa_token?: string;
  locked_until?: IsoTimestamp;
}

export interface TotpVerifyRequest {
  mfa_token: string;
  code: string;
}

export interface AdminSessionTokens {
  access_token: string;
  expires_in: number;
}

export interface CreateCompanyRequest {
  name: string;
  company_code?: string;
  contact_email: string;
  contact_phone?: string;
  notes?: string;
  default_callback_url?: string;
}

/** One-time credential reveal block (architecture §7.4). Never retrievable again. */
export interface CompanyCredentialReveal {
  company_code: string;
  server_key: string;
  device_enroll_key: string;
  webhook_secret: string;
  warning: string;
}

export interface IssueKeyRequest {
  key_type: KeyType;
  label: string;
  scopes?: string[];
  expires_at?: IsoTimestamp;
}

export interface CompanyStatusChangeRequest {
  status: CompanyStatus;
  reason: string;
}
