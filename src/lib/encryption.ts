import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get the encryption key from environment variables.
 * The key should be a 32-byte (256-bit) hex string.
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }

  // If the key is hex-encoded (64 chars), decode it
  if (key.length === 64) {
    return Buffer.from(key, "hex");
  }

  // Otherwise, hash the key to get 32 bytes
  return crypto.createHash("sha256").update(key).digest();
}

/**
 * Encrypt a string using AES-256-GCM.
 * Returns a base64-encoded string containing IV + ciphertext + auth tag.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Combine IV + ciphertext + authTag
  const result = Buffer.concat([iv, encrypted, authTag]);

  return result.toString("base64");
}

/**
 * Decrypt a string that was encrypted with the encrypt function.
 * Expects a base64-encoded string containing IV + ciphertext + auth tag.
 */
export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(encryptedData, "base64");

  // Extract IV, ciphertext, and auth tag
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH, data.length - AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Generate a secure random API token.
 * Returns the raw token (to be shown to user once) and its SHA-256 hash (to store in DB).
 */
export function generateApiToken(): {
  token: string;
  tokenHash: string;
  prefix: string;
} {
  // Generate 32 random bytes and encode as base64url
  const tokenBytes = crypto.randomBytes(32);
  const token = `phub_${tokenBytes.toString("base64url")}`;

  // Create SHA-256 hash for storage
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  // Prefix for identification (first 8 chars after phub_)
  const prefix = token.substring(0, 12);

  return { token, tokenHash, prefix };
}

/**
 * Hash a token for lookup in the database.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a random encryption key (for initial setup).
 * Returns a 64-character hex string (32 bytes).
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString("hex");
}
