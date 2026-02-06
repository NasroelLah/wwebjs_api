/**
 * @fileoverview Simple in-memory cache with TTL support
 * @module helpers/cache
 */

/**
 * @typedef {Object} CacheEntry
 * @property {*} data - Cached data
 * @property {number} timestamp - Cache timestamp
 * @property {number} ttl - Time to live in ms
 */

class Cache {
  constructor() {
    /** @type {Map<string, CacheEntry>} */
    this.store = new Map();
    this.stats = { hits: 0, misses: 0 };
    
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Get item from cache
   * @param {string} key - Cache key
   * @returns {*|null} Cached value or null
   */
  get(key) {
    const entry = this.store.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      this.stats.misses++;
      return null;
    }
    
    this.stats.hits++;
    return entry.data;
  }

  /**
   * Set item in cache
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   * @param {number} ttl - Time to live in ms (default: 60000)
   */
  set(key, data, ttl = 60000) {
    this.store.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Check if key exists and is valid
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.store.get(key);
    if (!entry) return false;
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Delete item from cache
   * @param {string} key - Cache key
   */
  delete(key) {
    this.store.delete(key);
  }

  /**
   * Delete items matching pattern
   * @param {string} pattern - Key pattern (prefix)
   */
  deletePattern(pattern) {
    for (const key of this.store.keys()) {
      if (key.startsWith(pattern)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.store.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.store.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(2) + "%" : "0%",
    };
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Stop cleanup interval
   */
  destroy() {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

// Singleton instance
export const cache = new Cache();

// Cache TTL presets
export const CacheTTL = {
  SHORT: 10000,    // 10 seconds
  MEDIUM: 60000,   // 1 minute
  LONG: 300000,    // 5 minutes
  HOUR: 3600000,   // 1 hour
};

/**
 * Decorator for caching async function results
 * @param {string} keyPrefix - Cache key prefix
 * @param {number} ttl - Time to live
 * @returns {Function} Decorator function
 */
export function withCache(keyPrefix, ttl = CacheTTL.MEDIUM) {
  return function (fn) {
    return async function (...args) {
      const key = `${keyPrefix}:${JSON.stringify(args)}`;
      
      const cached = cache.get(key);
      if (cached !== null) {
        return cached;
      }
      
      const result = await fn.apply(this, args);
      cache.set(key, result, ttl);
      return result;
    };
  };
}
