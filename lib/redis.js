// Redis configuration for Upstash
// Uses @upstash/redis for Vercel serverless compatibility

const { Redis } = require('@upstash/redis');
const { Ratelimit } = require('@upstash/ratelimit');

// Create Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || 'your_upstash_redis_url_here',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || 'your_upstash_redis_token_here',
});

// Rate limiter configuration
const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(10, '10 s'),
  analytics: true,
  prefix: 'wa-bot',
});

// Cache helper functions
const cache = {
  // Set a value with optional TTL (in seconds)
  async set(key, value, ttl = 86400) {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await redis.setex(key, ttl, serialized);
      } else {
        await redis.set(key, serialized);
      }
      return true;
    } catch (error) {
      console.error('Redis SET error:', error.message);
      return false;
    }
  },

  // Get a value
  async get(key) {
    try {
      const value = await redis.get(key);
      if (value) {
        // Handle both string and object responses
        if (typeof value === 'string') {
          return JSON.parse(value);
        }
        return value;
      }
      return null;
    } catch (error) {
      console.error('Redis GET error:', error.message);
      return null;
    }
  },

  // Delete a key
  async del(key) {
    try {
      await redis.del(key);
      return true;
    } catch (error) {
      console.error('Redis DEL error:', error.message);
      return false;
    }
  },

  // Check if key exists
  async exists(key) {
    try {
      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Redis EXISTS error:', error.message);
      return false;
    }
  },

  // Increment a counter
  async incr(key) {
    try {
      return await redis.incr(key);
    } catch (error) {
      console.error('Redis INCR error:', error.message);
      return 0;
    }
  },

  // Get or set pattern (get if exists, otherwise set with value)
  async getOrSet(key, fetchFn, ttl = 86400) {
    try {
      let value = await this.get(key);
      if (value === null) {
        value = await fetchFn();
        if (value !== undefined) {
          await this.set(key, value, ttl);
        }
      }
      return value;
    } catch (error) {
      console.error('Redis GET_OR_SET error:', error.message);
      return null;
    }
  },
};

module.exports = {
  redis,
  ratelimit,
  cache,
};
