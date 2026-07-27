import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ConfigService } from './config.service.js';

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * AES-256-GCM envelope encryption for secrets that must be retrievable
 * (webhook secrets, TOTP secrets). Blob layout: [version:1][iv:12][tag:16][ct].
 * The key is host-held via KEY_ENCRYPTION_KEY (architecture §13.2).
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = config.crypto.keyEncryptionKey;
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]);
  }

  decrypt(blob: Buffer): string {
    if (blob.length < 1 + IV_LEN + TAG_LEN) {
      throw new Error('ciphertext blob too short');
    }
    const version = blob.subarray(0, 1);
    if (version[0] !== VERSION) {
      throw new Error(`unsupported ciphertext version ${String(version[0])}`);
    }
    const iv = blob.subarray(1, 1 + IV_LEN);
    const tag = blob.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
    const ct = blob.subarray(1 + IV_LEN + TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }
}
