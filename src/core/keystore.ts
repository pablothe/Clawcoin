/**
 * Encrypted keystore management for the bot execution key.
 *
 * Uses ethers.js v6 encrypted JSON keystore (scrypt-based) so the private key
 * is never stored in plaintext. The password MUST come from the
 * CLAWCOIN_KEYSTORE_PASSWORD environment variable — never from config files
 * or chat messages.
 *
 * Key rotation is a board-only operation: this module generates the new key
 * but applying it on-chain (updating AllowanceModule delegate, Zodiac Roles
 * member) requires board multi-sig.
 */

import { Wallet, encryptKeystoreJson, decryptKeystoreJson } from "ethers";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface KeystoreInfo {
  /** Ethereum address (public, safe to display) */
  address: string;
  /** Path to the encrypted keystore file */
  keystorePath: string;
  /** When the key was generated */
  createdAt: string;
}

export class KeystoreManager {
  private keystorePath: string;

  constructor(keystorePath: string) {
    this.keystorePath = resolve(keystorePath);
  }

  /**
   * Generate a new random keypair and encrypt it to disk.
   * NEVER returns or logs the private key.
   */
  async generateAndEncrypt(password: string): Promise<KeystoreInfo> {
    const wallet = Wallet.createRandom();

    // Encrypt with high scrypt work factor
    const encrypted = await encryptKeystoreJson(wallet as any, password, {
      scrypt: { N: 262144 },
    });

    // Ensure directory exists with restrictive permissions
    const dir = dirname(this.keystorePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    }

    // Write keystore with owner-only permissions
    await writeFile(this.keystorePath, encrypted, {
      mode: 0o600,
      encoding: "utf-8",
    });

    // Write metadata (no secrets)
    const info: KeystoreInfo = {
      address: wallet.address,
      keystorePath: this.keystorePath,
      createdAt: new Date().toISOString(),
    };

    await writeFile(
      this.metaPath(),
      JSON.stringify(info, null, 2),
      { mode: 0o600, encoding: "utf-8" },
    );

    return info;
  }

  /**
   * Decrypt the keystore and return a Wallet instance.
   * The password should come from env var CLAWCOIN_KEYSTORE_PASSWORD.
   */
  async decrypt(password: string): Promise<Wallet> {
    if (!existsSync(this.keystorePath)) {
      throw new Error(`Keystore not found at ${this.keystorePath}`);
    }
    const encrypted = await readFile(this.keystorePath, "utf-8");
    const wallet = await decryptKeystoreJson(encrypted, password);
    return new Wallet(wallet.privateKey);
  }

  /**
   * Get the password from the environment variable.
   * Throws if not set — prevents accidental use without proper setup.
   */
  static getPasswordFromEnv(): string {
    const password = process.env.CLAWCOIN_KEYSTORE_PASSWORD;
    if (!password) {
      throw new Error(
        "CLAWCOIN_KEYSTORE_PASSWORD environment variable is required. " +
          "Set it before running the bot.",
      );
    }
    return password;
  }

  /**
   * Get public info without decryption.
   */
  async getInfo(): Promise<KeystoreInfo | null> {
    const metaPath = this.metaPath();
    if (!existsSync(metaPath)) return null;
    const meta = await readFile(metaPath, "utf-8");
    return JSON.parse(meta) as KeystoreInfo;
  }

  /**
   * Check if a keystore exists at the configured path.
   */
  exists(): boolean {
    return existsSync(this.keystorePath);
  }

  /**
   * Rotate: generate new key, backup old keystore, return both addresses.
   * The old keystore is renamed with a timestamp suffix (never deleted).
   *
   * NOTE: This only generates the new local key. Updating the on-chain
   * delegate (AllowanceModule, Zodiac Roles) requires a board multi-sig
   * proposal — handled by emergency.ts.
   */
  async rotate(password: string): Promise<{
    oldAddress: string;
    newAddress: string;
    oldKeystoreBackup: string;
  }> {
    const oldInfo = await this.getInfo();
    if (!oldInfo) throw new Error("No existing keystore to rotate");

    // Backup old keystore
    const backupPath = `${this.keystorePath}.${Date.now()}.bak`;
    await rename(this.keystorePath, backupPath);

    // Backup old metadata
    const metaBackup = `${this.metaPath()}.${Date.now()}.bak`;
    if (existsSync(this.metaPath())) {
      await rename(this.metaPath(), metaBackup);
    }

    // Generate new key
    const newInfo = await this.generateAndEncrypt(password);

    return {
      oldAddress: oldInfo.address,
      newAddress: newInfo.address,
      oldKeystoreBackup: backupPath,
    };
  }

  private metaPath(): string {
    return this.keystorePath.replace(/\.json$/, ".meta.json");
  }
}
