import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * AES-256-CBC encryption/decryption for sensitive values (e.g., MP access tokens).
 * Requires ENCRYPTION_KEY env var — exactly 32 ASCII characters.
 *
 * Encrypted format: "<iv_hex>:<ciphertext_hex>"
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const rawKey = this.configService.get<string>('ENCRYPTION_KEY', '');

    if (!rawKey || rawKey.length !== 32) {
      this.logger.warn(
        'ENCRYPTION_KEY is missing or not 32 chars — using insecure fallback. Set it in .env for production!',
      );
    }

    // Pad or trim to exactly 32 bytes
    const normalised = rawKey.padEnd(32, '0').slice(0, 32);
    this.key = Buffer.from(normalised, 'utf-8');
  }

  encrypt(plaintext: string): string {
    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
      return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
    } catch (err) {
      this.logger.error('Encryption failed', err);
      throw new InternalServerErrorException('Encryption error');
    }
  }

  decrypt(ciphertext: string): string {
    try {
      const [ivHex, encryptedHex] = ciphertext.split(':');
      if (!ivHex || !encryptedHex) throw new Error('Invalid ciphertext format');

      const iv = Buffer.from(ivHex, 'hex');
      const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
      return decrypted.toString('utf-8');
    } catch (err) {
      this.logger.error('Decryption failed', err);
      throw new InternalServerErrorException('Decryption error');
    }
  }

  /** Returns true if string looks like an encrypted value (iv:ciphertext). */
  isEncrypted(value: string): boolean {
    return /^[0-9a-f]{32}:[0-9a-f]+$/.test(value);
  }
}
