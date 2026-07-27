import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';

import { CryptoService } from '../../../config/crypto.service.js';

// ±1 step (30s) clock drift tolerance.
authenticator.options = { window: 1 };

@Injectable()
export class TotpService {
  constructor(private readonly crypto: CryptoService) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  otpauthUri(email: string, secret: string): string {
    return authenticator.keyuri(email, 'payment-sync', secret);
  }

  qrDataUrl(otpauth: string): Promise<string> {
    return toDataURL(otpauth);
  }

  verify(code: string, secret: string): boolean {
    return authenticator.verify({ token: code, secret });
  }

  encryptSecret(secret: string): Buffer {
    return this.crypto.encrypt(secret);
  }

  decryptSecret(blob: Uint8Array): string {
    return this.crypto.decrypt(blob);
  }
}
