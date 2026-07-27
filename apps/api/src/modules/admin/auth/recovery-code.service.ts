import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class RecoveryCodeService {
  /** 10 human-friendly codes like `ABCD-EFGH`. */
  generate(count = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const raw = randomBytes(8);
      let s = '';
      for (const b of raw) s += ALPHABET.charAt(b % ALPHABET.length);
      codes.push(`${s.slice(0, 4)}-${s.slice(4, 8)}`);
    }
    return codes;
  }

  hashAll(codes: string[]): Promise<string[]> {
    return Promise.all(codes.map((c) => hash(c, ARGON)));
  }

  /** Verify a code against the stored hashes; on match, return the remaining hashes. */
  async consume(code: string, hashes: string[]): Promise<{ ok: boolean; remaining: string[] }> {
    for (let i = 0; i < hashes.length; i++) {
      const h = hashes[i];
      if (h === undefined) continue;
      try {
        if (await verify(h, code, ARGON)) {
          return { ok: true, remaining: hashes.filter((_, idx) => idx !== i) };
        }
      } catch {
        // not this one
      }
    }
    return { ok: false, remaining: hashes };
  }
}
