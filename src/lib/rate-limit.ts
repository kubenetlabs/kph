/**
 * Simple In-Memory Rate Limiter
 *
 * Provides token-bucket rate limiting for API endpoints.
 * For production at scale, consider using Redis or a distributed rate limiter.
 */

interface RateLimitConfig {
  /** Time window in milliseconds */
  interval: number;
  /** Maximum number of requests per interval */
  limit: number;
}

interface RateLimitEntry {
  /** Number of requests in current window */
  count: number;
  /** Window reset timestamp */
  resetAt: number;
}

class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Clean up expired entries every 5 minutes
    if (typeof setInterval !== "undefined") {
      this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }
  }

  /**
   * Check if a request is allowed under the rate limit.
   * @param key Unique identifier for rate limiting (e.g., IP, organization ID)
   * @param config Rate limit configuration
   * @returns Object with allowed status and remaining count
   */
  check(
    key: string,
    config: RateLimitConfig
  ): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  } {
    const now = Date.now();
    const entry = this.store.get(key);

    // No existing entry or window expired - create new window
    if (!entry || now >= entry.resetAt) {
      const resetAt = now + config.interval;
      this.store.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        remaining: config.limit - 1,
        resetAt,
      };
    }

    // Window still active - check if under limit
    if (entry.count < config.limit) {
      entry.count++;
      return {
        allowed: true,
        remaining: config.limit - entry.count,
        resetAt: entry.resetAt,
      };
    }

    // Rate limit exceeded
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  /**
   * Remove expired entries to prevent memory leaks
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.resetAt) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Clear all rate limit entries (for testing)
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Stop the cleanup interval (for testing)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Singleton instance
const rateLimiter = new RateLimiter();

/**
 * Factory function to create a rate limiter with specific configuration.
 * Returns a function that checks the rate limit for a given key.
 *
 * @example
 * const limiter = rateLimit({ interval: 60 * 1000, limit: 5 });
 * const result = limiter.check('org:abc123');
 * if (!result.allowed) {
 *   return Response.json({ error: 'Too many requests' }, { status: 429 });
 * }
 */
export function rateLimit(config: RateLimitConfig) {
  return {
    check: (key: string) => rateLimiter.check(key, config),
  };
}

// Pre-configured rate limiters for common use cases
export const rateLimiters = {
  /**
   * Bootstrap endpoint: 5 requests per minute per organization
   * Prevents brute-force cluster registration attempts
   */
  bootstrap: rateLimit({
    interval: 60 * 1000, // 1 minute
    limit: 5,
  }),

  /**
   * Authentication endpoints: 10 requests per minute per IP
   * Prevents brute-force authentication attempts
   */
  auth: rateLimit({
    interval: 60 * 1000,
    limit: 10,
  }),

  /**
   * API token creation: 3 requests per minute per organization
   * Prevents token creation spam
   */
  tokenCreation: rateLimit({
    interval: 60 * 1000,
    limit: 3,
  }),
};
