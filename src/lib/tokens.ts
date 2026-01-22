/**
 * Token Utilities
 *
 * Handles generation and validation of agent tokens for cluster authentication.
 * Uses cryptographically secure random generation.
 */

import { randomBytes, createHash } from "crypto";

/**
 * Token prefix for easy identification
 * Format: kph_{type}_{random}
 */
const TOKEN_PREFIXES = {
  AGENT: "kph_agent_",
  REGISTRATION: "kph_reg_",
  API: "kph_api_",
} as const;

export type TokenType = keyof typeof TOKEN_PREFIXES;

/**
 * Generated token result
 */
export interface GeneratedToken {
  /** The full token to be provided to the user (stored nowhere) */
  token: string;
  /** SHA-256 hash of the token (stored in database) */
  tokenHash: string;
  /** First 8 characters for identification (stored in database) */
  tokenPrefix: string;
  /** Expiry date if applicable */
  expiresAt: Date | null;
}

/**
 * Generates a cryptographically secure agent token
 *
 * @param type - The type of token to generate
 * @param expiryDays - Number of days until token expires (0 = never)
 * @returns Generated token with hash for storage
 */
export function generateAgentToken(
  type: TokenType = "AGENT",
  expiryDays = 365
): GeneratedToken {
  // Generate 32 bytes of random data (256 bits of entropy)
  const randomPart = randomBytes(32).toString("base64url");

  // Construct full token with prefix
  const token = `${TOKEN_PREFIXES[type]}${randomPart}`;

  // Hash the token for storage (we never store the actual token)
  const tokenHash = hashToken(token);

  // Extract prefix for identification
  const tokenPrefix = token.slice(0, TOKEN_PREFIXES[type].length + 8);

  // Calculate expiry
  const expiresAt =
    expiryDays > 0 ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000) : null;

  return {
    token,
    tokenHash,
    tokenPrefix,
    expiresAt,
  };
}

/**
 * Generates a registration token for cluster self-registration
 */
export function generateRegistrationToken(expiryDays = 7): GeneratedToken {
  return generateAgentToken("REGISTRATION", expiryDays);
}

/**
 * Generates an API token for external integrations
 */
export function generateApiToken(expiryDays = 90): GeneratedToken {
  return generateAgentToken("API", expiryDays);
}

/**
 * Hashes a token using SHA-256
 *
 * @param token - The raw token to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Validates a token against a stored hash
 *
 * @param token - The raw token to validate
 * @param storedHash - The hash stored in the database
 * @returns True if the token matches
 */
export function validateToken(token: string, storedHash: string): boolean {
  const computedHash = hashToken(token);
  // Use timing-safe comparison to prevent timing attacks
  return timingSafeEqual(computedHash, storedHash);
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Extracts the token type from a token string
 */
export function getTokenType(token: string): TokenType | null {
  for (const [type, prefix] of Object.entries(TOKEN_PREFIXES)) {
    if (token.startsWith(prefix)) {
      return type as TokenType;
    }
  }
  return null;
}

/**
 * Validates that a token has the expected format
 */
export function isValidTokenFormat(token: string): boolean {
  // Check for valid prefix
  const type = getTokenType(token);
  if (!type) {
    return false;
  }

  // Check minimum length (prefix + at least 32 chars of random data)
  const prefix = TOKEN_PREFIXES[type];
  if (token.length < prefix.length + 32) {
    return false;
  }

  // Check that the random part is valid base64url
  const randomPart = token.slice(prefix.length);
  const base64urlRegex = /^[A-Za-z0-9_-]+$/;
  return base64urlRegex.test(randomPart);
}

/**
 * Masks a token for display (shows prefix and last 4 chars)
 */
export function maskToken(token: string): string {
  if (token.length < 12) {
    return "****";
  }
  const type = getTokenType(token);
  if (!type) {
    return `${token.slice(0, 4)}****${token.slice(-4)}`;
  }
  const prefix = TOKEN_PREFIXES[type];
  return `${prefix}****${token.slice(-4)}`;
}

/**
 * Checks if a token has expired
 */
export function isTokenExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) {
    return false; // Never expires
  }
  return new Date() > expiresAt;
}

/**
 * Returns a human-readable expiry status
 */
export function getExpiryStatus(expiresAt: Date | null): string {
  if (!expiresAt) {
    return "Never expires";
  }

  const now = new Date();
  if (now > expiresAt) {
    return "Expired";
  }

  const diff = expiresAt.getTime() - now.getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  if (days > 30) {
    return `Expires in ${Math.floor(days / 30)} months`;
  } else if (days > 0) {
    return `Expires in ${days} days`;
  } else if (hours > 0) {
    return `Expires in ${hours} hours`;
  } else {
    return "Expires soon";
  }
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  valid: boolean;
  error?: string;
  type?: TokenType;
  expired?: boolean;
}

/**
 * Comprehensive token validation
 */
export function validateTokenComprehensive(
  token: string,
  storedHash: string,
  expiresAt: Date | null
): TokenValidationResult {
  // Check format
  if (!isValidTokenFormat(token)) {
    return { valid: false, error: "Invalid token format" };
  }

  // Check expiry
  if (isTokenExpired(expiresAt)) {
    return { valid: false, error: "Token has expired", expired: true };
  }

  // Check hash
  if (!validateToken(token, storedHash)) {
    return { valid: false, error: "Invalid token" };
  }

  return {
    valid: true,
    type: getTokenType(token) ?? undefined,
    expired: false,
  };
}
