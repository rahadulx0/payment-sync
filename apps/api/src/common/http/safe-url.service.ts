import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { Injectable } from '@nestjs/common';
import { AppError } from '@paysync/shared';

import { isPrivateIp } from './ip-range.js';

export interface SafeUrl {
  url: string;
  resolvedIps: string[];
}

type Resolver = (host: string) => Promise<{ address: string }[]>;

/**
 * SSRF defence (architecture §13.1 T7). Used at register time AND re-run at
 * webhook send time (DNS can be re-pointed afterwards). No redirects are ever
 * followed; Task 09 pins the connection to a validated IP.
 */
@Injectable()
export class SafeUrlService {
  /** Overridable in tests. */
  resolver: Resolver = (host) => lookup(host, { all: true });

  async validate(raw: string): Promise<SafeUrl> {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new AppError('INVALID_CALLBACK_URL', 'Malformed callback URL.');
    }
    if (u.protocol !== 'https:') {
      throw new AppError('INVALID_CALLBACK_URL', 'Callback URL must use https.');
    }
    if (u.username !== '' || u.password !== '') {
      throw new AppError(
        'INVALID_CALLBACK_URL',
        'Credentials are not allowed in the callback URL.',
      );
    }
    if (u.port !== '' && u.port !== '443') {
      throw new AppError('INVALID_CALLBACK_URL', 'Only port 443 is allowed.');
    }
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      throw new AppError('INVALID_CALLBACK_URL', 'Callback host is not publicly reachable.');
    }

    let ips: string[];
    if (isIP(host) !== 0) {
      ips = [host];
    } else {
      let records: { address: string }[];
      try {
        records = await this.resolver(host);
      } catch {
        throw new AppError('INVALID_CALLBACK_URL', 'Callback host does not resolve.');
      }
      ips = records.map((r) => r.address);
      if (ips.length === 0) {
        throw new AppError('INVALID_CALLBACK_URL', 'Callback host does not resolve.');
      }
    }
    for (const ip of ips) {
      if (isPrivateIp(ip)) {
        throw new AppError('INVALID_CALLBACK_URL', 'Callback URL resolves to a private address.');
      }
    }
    return { url: u.toString(), resolvedIps: ips };
  }
}
