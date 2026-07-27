import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { issueCredential, type KeyPrefixKind } from '@paysync/shared';
import type { ApiKey } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';

const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
// A fixed dummy hash so an unknown key costs the same as a wrong key (no user enumeration by timing).
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$3g2Z8f7q1kZl0m8n7b6v5c4x3z2a1s0d9f8g7h6j5k4';

@Injectable()
export class CredentialService {
  constructor(private readonly prisma: PrismaService) {}

  hash(plaintext: string): Promise<string> {
    return hash(plaintext, ARGON);
  }

  async verify(plaintext: string, hashed: string): Promise<boolean> {
    try {
      return await verify(hashed, plaintext, ARGON);
    } catch {
      return false;
    }
  }

  issue(kind: KeyPrefixKind): { plaintext: string; prefix: string } {
    return issueCredential(kind);
  }

  /** Look up an api_key from its plaintext: prefix-indexed candidates, then Argon2 verify. */
  async findByPlaintext(plaintext: string): Promise<ApiKey | null> {
    const prefix = /^([a-z]{3}_[a-z]+_)/.exec(plaintext)?.[1];
    if (prefix === undefined) {
      await this.dummyVerify();
      return null;
    }
    const candidates = await this.prisma.apiKey.findMany({ where: { prefix, revoked_at: null } });
    for (const key of candidates) {
      if (await this.verify(plaintext, key.key_hash)) return key;
    }
    await this.dummyVerify();
    return null;
  }

  private async dummyVerify(): Promise<void> {
    try {
      await verify(DUMMY_HASH, 'dummy', ARGON);
    } catch {
      // expected; the point is the constant-time cost
    }
  }
}
