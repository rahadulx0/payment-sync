import { Injectable } from '@nestjs/common';
import type { DeviceConfig } from '@paysync/shared';

import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RuleRepository } from '../parsing/rule.repository.js';

@Injectable()
export class DeviceConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: RuleRepository,
  ) {}

  configVersion(): number {
    return this.rules.getConfigVersion();
  }

  async build(): Promise<DeviceConfig> {
    const profiles = await this.prisma.providerProfile.findMany({ where: { is_active: true } });
    const parserRules: Record<string, unknown> = {};
    for (const rule of this.rules.getRules()) {
      parserRules[rule.provider.toLowerCase()] = rule;
    }
    return {
      config_version: this.rules.getConfigVersion(),
      providers: profiles.map((p) => ({
        provider: p.provider,
        sender_addresses: p.sender_addresses,
      })),
      parser_rules: parserRules,
      upload: { max_batch: 50, max_body_bytes: 262_144, retry_base_sec: 30, max_attempts: 10 },
      heartbeat_interval_sec: 900,
      reconcile_interval_hours: 6,
      inbox_scan_days: 7,
      retention_days: 30,
      min_supported_app_version: '1.0.0',
    };
  }
}
