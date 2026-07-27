/** Device-facing API DTOs (architecture §7.2). Frozen in Task 06. */

import type { MatchStatus, ParseStatus, Provider, UploadSource } from '../enums.js';

import type { DecimalString, IsoTimestamp } from './common.js';

export interface DeviceRegisterRequest {
  company_code: string;
  enroll_key: string;
  install_id: string;
  device_name?: string;
  model: string;
  manufacturer: string;
  android_version: string;
  app_version: string;
  wallet_msisdn?: string;
}

export interface ProviderConfig {
  provider: Provider;
  sender_addresses: string[];
}

export interface DeviceConfig {
  config_version: number;
  providers: ProviderConfig[];
  parser_rules: Record<string, unknown>;
  upload: {
    max_batch: number;
    max_body_bytes: number;
    retry_base_sec: number;
    max_attempts: number;
  };
  heartbeat_interval_sec: number;
  reconcile_interval_hours: number;
  inbox_scan_days: number;
  retention_days: number;
  min_supported_app_version: string;
}

export interface DeviceRegisterResponse {
  device_id: string;
  device_token: string;
  device_name: string;
  config: DeviceConfig;
  server_time: IsoTimestamp;
}

export interface HeartbeatRequest {
  app_version: string;
  android_version: string;
  battery_pct: number;
  is_charging: boolean;
  is_ignoring_battery_opt: boolean;
  has_sms_permission: boolean;
  network_type: string;
  pending_upload_count: number;
  failed_upload_count: number;
  last_sms_local_at?: IsoTimestamp;
  device_now: IsoTimestamp;
  config_version: number;
  flags?: { is_rooted?: boolean; is_emulator?: boolean };
}

export interface HeartbeatDirectives {
  force_full_sync: boolean;
  rotate_token: boolean;
  config_version: number;
  config_changed: boolean;
  message_for_user: string | null;
  requested_heartbeat_interval_sec: number | null;
  pause_uploads: boolean;
}

export interface HeartbeatResponse {
  server_time: IsoTimestamp;
  directives: HeartbeatDirectives;
  next_heartbeat_after_sec: number;
}

export interface SmsUploadMessage {
  client_msg_hash: string;
  sms_address: string;
  raw_message: string;
  device_received_at: IsoTimestamp;
  device_sms_timestamp?: IsoTimestamp;
  parsed_hint?: {
    provider?: Provider;
    transaction_id?: string;
    amount?: DecimalString;
    sender_msisdn?: string;
    parser_rule_version?: number;
  };
}

export interface SmsUploadRequest {
  upload_source: UploadSource;
  messages: SmsUploadMessage[];
}

export type SmsUploadResultStatus = 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';

export interface SmsUploadResult {
  client_msg_hash: string;
  status: SmsUploadResultStatus;
  sms_log_id?: string;
  parse_status?: ParseStatus;
  match_status?: MatchStatus;
  reason?: string;
  server_extraction?: {
    transaction_id?: string;
    amount?: DecimalString;
    provider?: Provider;
  };
}

export interface SmsUploadResponse {
  results: SmsUploadResult[];
  summary: { accepted: number; duplicates: number; rejected: number; matched: number };
  config_version: number;
}
