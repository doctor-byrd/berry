import { Injectable, Inject } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, createHmac, scryptSync } from 'crypto';
import { environment } from '../common/environment';

/**
 * Envelope Encryption Service
 * 
 * Implements AES-256-GCM envelope encryption for PII protection,
 *
 * 
 * Token Format: v1.<base64iv>.<base64WrappedDek>.<base64ciphertext+tag>
 * 
 * Security Properties:
 * - AES-256-GCM for authenticated encryption
 * - Envelope encryption with KEK/DEK hierarchy
 * - HMAC-SHA256 blind indexing for duplicate detection
 * - Constant-time comparison for hash verification
 */
@Injectable()
export class EncryptionService {
  private readonly kek: Buffer;
  private readonly hmacKey: Buffer;
  private readonly version = 'v1';

  constructor() {
    // Load Key Encryption Key from environment in prod this should come from HSM, AWS KMS, or HashiCorp Vault
    const rootKey = environment.VAULT_ROOT_KEY
    
    if (!rootKey) {
      throw new Error(
        'VAULT_ROOT_KEY environment variable is required. ' +
        'Generate one with: openssl rand -hex 32'
      );
    }

    // Derive KEK using PBKDF2 for key stretching
    this.kek = this.deriveKey(rootKey, 'envelope-kek-salt', 32);
    
    // Separate HMAC key for blind indexing (key separation)
    this.hmacKey = this.deriveKey(rootKey, 'hmac-blind-index-salt', 32);
  }

  /**
   * Derive a key from the root key using PBKDF2 (Updated with maxmem configuration)
   * @param rootKey - The root secret key
   * @param salt - Salt for key derivation (public, non-secret)
   * @param length - Desired key length in bytes
   * @returns Derived key as Buffer
   */
  private deriveKey(rootKey: string, salt: string, length: number): Buffer {
    return scryptSync(rootKey, salt, length, {
      N: 32768,               // CPU/memory cost parameter
      r: 8,                   // Block size
      p: 1,                   // Parallelization parameter
      maxmem: 64 * 1024 * 1024 // 64MB allocation allowance (fixes the RangeError)
    });
  }

  /**
   * Encrypt PII using AES-256-GCM envelope encryption
   * 
   * Process:
   * 1. Generate random 256-bit Data Encryption Key (DEK)
   * 2. Wrap DEK with KEK using AES-256-GCM
   * 3. Encrypt plaintext with DEK using AES-256-GCM
   * 4. Serialize: version.iv.wrappedDek.ciphertext+tag
   * 
   * @param plaintext - The PII to encrypt (e.g., identity number)
   * @returns Encrypted token in format: v1.<dataIv>.<wrapIv>.<wrappedDek>.<ciphertext+tag>
   */
  encryptPii(plaintext: string): string {
    if (!plaintext || typeof plaintext !== 'string') {
      throw new Error('Plaintext must be a non-empty string');
    }

    // Step 1: Generate random DEK (32 bytes = 256 bits)
    const dek = randomBytes(32);

    // Step 2: Generate random IV for DEK wrapping (12 bytes = 96 bits, GCM standard)
    const wrapIv = randomBytes(12);

    // Step 3: Wrap DEK with KEK using AES-256-GCM
    const wrapCipher = createCipheriv('aes-256-gcm', this.kek, wrapIv);
    let wrappedDek = wrapCipher.update(dek);
    wrappedDek = Buffer.concat([wrappedDek, wrapCipher.final()]);
    const wrapAuthTag = wrapCipher.getAuthTag();

    // Combine wrapped DEK + auth tag
    const wrappedDekWithAuth = Buffer.concat([wrappedDek, wrapAuthTag]);

    // Step 4: Generate random IV for data encryption
    const dataIv = randomBytes(12);

    // Step 5: Encrypt plaintext with DEK using AES-256-GCM
    const dataCipher = createCipheriv('aes-256-gcm', dek, dataIv);
    let ciphertext = dataCipher.update(Buffer.from(plaintext, 'utf8'));
    ciphertext = Buffer.concat([ciphertext, dataCipher.final()]);
    const dataAuthTag = dataCipher.getAuthTag();

    // Combine ciphertext + auth tag
    const ciphertextWithTag = Buffer.concat([ciphertext, dataAuthTag]);

    // Step 6: Serialize token
    const token = [
      this.version,
      dataIv.toString('base64'),
      wrapIv.toString('base64'),
      wrappedDekWithAuth.toString('base64'),
      ciphertextWithTag.toString('base64'),
    ].join('.');

    return token;
  }

  /**
   * Decrypt PII token back to plaintext
   * 
   * Process:
   * 1. Parse token components
   * 2. Unwrap DEK using KEK
   * 3. Decrypt ciphertext with DEK
   * 4. Verify auth tags (automatic in GCM mode)
   * 
   * @param token - Encrypted token in format: v1.<dataIv>.<wrapIv>.<wrappedDek>.<ciphertext+tag>
   * @returns Decrypted plaintext string
   */
  decryptPii(token: string): string {
    if (!token || typeof token !== 'string') {
      throw new Error('Token must be a non-empty string');
    }

    const parts = token.split('.');
    
    if (parts.length !== 5) {
      throw new Error('Invalid token format: expected 5 parts separated by dots');
    }

    const [version, dataIvB64, wrapIvB64, wrappedDekB64, ciphertextWithTagB64] = parts;

    if (version !== this.version) {
      throw new Error(`Unsupported token version: ${version}. Expected ${this.version}`);
    }

    const dataIv = Buffer.from(dataIvB64, 'base64');
    const wrapIv = Buffer.from(wrapIvB64, 'base64');
    const wrappedDekWithTag = Buffer.from(wrappedDekB64, 'base64');
    const ciphertextWithTag = Buffer.from(ciphertextWithTagB64, 'base64');

    // Extract wrapped DEK and auth tag
    const wrappedDek = wrappedDekWithTag.subarray(0, -16);
    const wrapAuthTag = wrappedDekWithTag.subarray(-16);

    // Extract ciphertext and auth tag
    const ciphertext = ciphertextWithTag.subarray(0, -16);
    const dataAuthTag = ciphertextWithTag.subarray(-16);

    // Step 3: Unwrap DEK using KEK
    const wrapDecipher = createDecipheriv('aes-256-gcm', this.kek, wrapIv);
    wrapDecipher.setAuthTag(wrapAuthTag);
    let dek = wrapDecipher.update(wrappedDek);
    dek = Buffer.concat([dek, wrapDecipher.final()]);

    // Step 4: Decrypt ciphertext with DEK
    const dataDecipher = createDecipheriv('aes-256-gcm', dek, dataIv);
    dataDecipher.setAuthTag(dataAuthTag);
    let plaintext = dataDecipher.update(ciphertext);
    plaintext = Buffer.concat([plaintext, dataDecipher.final()]);

    return plaintext.toString('utf8');
  }

  /**
   * Create HMAC-SHA256 blind index for duplicate detection
   * 
   * This allows detecting duplicate identity numbers without
   * storing or comparing plaintext values. The hash is deterministic
   * (same input always produces same output) but irreversible.
   * 
   * Security Properties:
   * - Uses separate HMAC key (key separation)
   * - Constant-time comparison prevents timing attacks
   * - Cannot reverse hash to get plaintext
   * 
   * @param plaintext - The identity number to hash
   * @returns Hex-encoded HMAC-SHA256 hash (64 characters)
   * 
   * @example
   * const hash = encryptionService.hashIdentity('1234567890');
   * // Returns: "a1b2c3d4..." (64 hex chars)
   * 
   * // Later, check for duplicates:
   * const existingHash = await db.findOne({ identityHash: hash });
   */
  hashIdentity(plaintext: string): string {
    if (!plaintext || typeof plaintext !== 'string') {
      throw new Error('Plaintext must be a non-empty string');
    }

    // Create HMAC-SHA256 with dedicated HMAC key
    const hmac = createHmac('sha256', this.hmacKey);
    hmac.update(plaintext, 'utf8');
    
    return hmac.digest('hex');
  }

  /**
   * Mask identity number for display purposes
   * 
   * Shows only the first `head` and last `tail` characters,
   * replacing the middle with asterisks.
   * 
   * Used for role-based PII masking in API responses.
   * 
   * @param plaintext - The identity number to mask
   * @param head - Number of characters to show at the start (default: 2)
   * @param tail - Number of characters to show at the end (default: 2)
   * @returns Masked identity number
   * 
   * @example
   * encryptionService.maskIdentity('1234567890');
   * // Returns: "12******90"
   * 
   * encryptionService.maskIdentity('1234567890', 3, 3);
   * // Returns: "123****7890"
   */
  maskIdentity(plaintext: string, head = 2, tail = 2): string {
    if (!plaintext || typeof plaintext !== 'string') {
      throw new Error('Plaintext must be a non-empty string');
    }

    const length = plaintext.length;
    
    // If string is too short, mask entirely
    if (length <= head + tail) {
      return '*'.repeat(length);
    }

    const visibleHead = plaintext.substring(0, head);
    const visibleTail = plaintext.substring(length - tail);
    const maskedLength = length - head - tail;

    return `${visibleHead}${'*'.repeat(maskedLength)}${visibleTail}`;
  }

  /**
   * Verify an identity number against a stored hash
   * 
   * Constant-time comparison to prevent timing attacks.
   * Used during customer lookup or authentication flows.
   * 
   * @param plaintext - The identity number to verify
   * @param storedHash - The previously computed hash to compare against
   * @returns true if the plaintext matches the hash, false otherwise
   * 
   * @example
   * const isMatch = encryptionService.verifyIdentity('1234567890', storedHash);
   */
  verifyIdentity(plaintext: string, storedHash: string): boolean {
    const computedHash = this.hashIdentity(plaintext);
    
    if (computedHash.length !== storedHash.length) {
      return false;
    }

    // Native implementation guarantees true constant-time validation
    return require('crypto').timingSafeEqual(
      Buffer.from(computedHash, 'utf8'),
      Buffer.from(storedHash, 'utf8')
    );
  }

  /**
   * Get the current encryption version
   * 
   * Useful for migration scenarios when upgrading encryption schemes.
   * 
   * @returns Current token version string (e.g., "v1")
   */
  getVersion(): string {
    return this.version;
  }

  /**
   * Re-encrypt a token with a new version (for migration)
   * 
   * Decrypts the old token and re-encrypts with current settings.
   * Use when upgrading encryption algorithms or key sizes.
   * 
   * @param oldToken - Token encrypted with older version
   * @returns Newly encrypted token with current version
   * 
   * @deprecated Only use during planned migration windows
   */
  migrateToken(oldToken: string): string {
    const plaintext = this.decryptPii(oldToken);
    return this.encryptPii(plaintext);
  }
}