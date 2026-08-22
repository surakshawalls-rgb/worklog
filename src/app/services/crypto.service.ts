import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../environments/environment';

/**
 * CryptoService — AES-256-GCM message encryption using the browser-native Web Crypto API.
 *
 * Encrypted format stored in DB:  "<base64_iv>:<base64_ciphertext>"
 * Key is derived via PBKDF2 from the app-level encryptionSecret in environment.ts.
 * The same secret must be used across all clients for decryption to succeed.
 */
@Injectable({ providedIn: 'root' })
export class CryptoService {
  private readonly platformId = inject(PLATFORM_ID);
  private cachedKey: CryptoKey | null = null;
  private cachedLegacyKeys: CryptoKey[] | null = null;

  private get isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  /** Derives a CryptoKey from a secret string using PBKDF2. */
  private async deriveKey(secret: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode('syncpoint-salt-v1'),
        iterations: 100_000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /** Returns the primary encryption key. Cached after first call. */
  private async getKey(): Promise<CryptoKey> {
    if (!this.cachedKey) {
      this.cachedKey = await this.deriveKey(environment.encryptionSecret);
    }
    return this.cachedKey;
  }

  /** Returns legacy keys for fallback decryption. Cached after first call. */
  private async getLegacyKeys(): Promise<CryptoKey[]> {
    if (!this.cachedLegacyKeys) {
      const secrets: string[] = (environment as Record<string, unknown>)['legacyEncryptionSecrets'] as string[] ?? [];
      this.cachedLegacyKeys = await Promise.all(secrets.map(s => this.deriveKey(s)));
    }
    return this.cachedLegacyKeys;
  }

  /** Encrypts plaintext. Returns "<base64_iv>:<base64_ciphertext>" or original text on SSR. */
  async encrypt(plaintext: string): Promise<string> {
    if (!this.isBrowser || !plaintext) return plaintext;

    try {
      const key = await this.getKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(plaintext);

      const cipherBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded
      );

      const ivB64 = btoa(String.fromCharCode(...iv));
      const cipherB64 = btoa(String.fromCharCode(...new Uint8Array(cipherBuffer)));

      return `${ivB64}:${cipherB64}`;
    } catch {
      return plaintext;
    }
  }

  /** Decrypts a "<base64_iv>:<base64_ciphertext>" string. Returns original on failure/SSR. */
  async decrypt(ciphertext: string): Promise<string> {
    if (!this.isBrowser || !ciphertext) return ciphertext;

    // If not in encrypted format, return as-is (plain legacy message)
    if (!ciphertext.includes(':')) return ciphertext;

    const [ivB64, cipherB64] = ciphertext.split(':');
    const iv     = Uint8Array.from(atob(ivB64),     c => c.charCodeAt(0));
    const cipher = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));

    // Try primary key first, then each legacy key
    const keys = [await this.getKey(), ...await this.getLegacyKeys()];
    for (const key of keys) {
      try {
        const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
        return new TextDecoder().decode(plainBuffer);
      } catch { /* try next key */ }
    }

    return '[encrypted message]';
  }

  /** Decrypts an array of objects that have a `message` property. */
  async decryptMessages<T extends { message: string }>(items: T[]): Promise<T[]> {
    return Promise.all(
      items.map(async item => ({
        ...item,
        message: await this.decrypt(item.message),
      }))
    );
  }
}
