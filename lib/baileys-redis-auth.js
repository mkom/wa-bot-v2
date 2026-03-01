// Redis-based auth state adapter for Baileys
// Replaces useMultiFileAuthState with pure Redis storage
// Compatible with Koyeb, Vercel, and other ephemeral filesystem platforms

const { redis } = require('./redis');

const SESSION_PREFIX = 'baileys:auth:';

/**
 * Initialize empty auth credentials structure for Baileys
 */
function initAuthCreds() {
  return {
    noiseKey: undefined,
    signedIdentityKey: undefined,
    signedPreKey: undefined,
    registrationId: undefined,
    advSecretKey: undefined,
    me: undefined,
    accountSyncCounter: 0,
    accountSettings: undefined,
    platform: undefined,
  };
}

/**
 * Serialize Baileys data (handles Buffers, etc.)
 * Baileys uses special BufferJSON replacer/reviver
 */
function serialize(data) {
  return JSON.stringify(data, (key, value) => {
    if (Buffer.isBuffer(value)) {
      return { type: 'Buffer', data: value.toString('base64') };
    }
    if (value instanceof Uint8Array) {
      return { type: 'Uint8Array', data: Buffer.from(value).toString('base64') };
    }
    return value;
  });
}

/**
 * Deserialize Baileys data (restores Buffers, etc.)
 */
function deserialize(jsonString) {
  if (!jsonString) return null;
  
  try {
    const parsed = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
    
    return JSON.parse(JSON.stringify(parsed), (key, value) => {
      if (value && typeof value === 'object') {
        if (value.type === 'Buffer' && value.data) {
          return Buffer.from(value.data, 'base64');
        }
        if (value.type === 'Uint8Array' && value.data) {
          return new Uint8Array(Buffer.from(value.data, 'base64'));
        }
      }
      return value;
    });
  } catch (error) {
    console.error('Deserialize error:', error.message);
    return null;
  }
}

/**
 * Redis-based Auth State for Baileys
 * Compatible interface with useMultiFileAuthState
 */
async function useRedisAuthState(sessionId = 'main') {
  const prefix = `${SESSION_PREFIX}${sessionId}:`;

  /**
   * Read data from Redis
   */
  const readData = async (id) => {
    try {
      const fullKey = `${prefix}${id}`;
      const value = await redis.get(fullKey);
      
      if (!value) return null;
      
      // Upstash might return already parsed object
      if (typeof value === 'object' && !Buffer.isBuffer(value)) {
        return value;
      }
      
      return deserialize(value);
    } catch (error) {
      console.error(`❌ Error reading ${id} from Redis:`, error.message);
      return null;
    }
  };

  /**
   * Write data to Redis
   */
  const writeData = async (id, data) => {
    try {
      const fullKey = `${prefix}${id}`;
      const serialized = serialize(data);
      
      // Save with 30 days TTL (session expires after 30 days of inactivity)
      await redis.set(fullKey, serialized, { ex: 86400 * 30 });
      return true;
    } catch (error) {
      console.error(`❌ Error writing ${id} to Redis:`, error.message);
      return false;
    }
  };

  /**
   * Remove data from Redis
   */
  const removeData = async (id) => {
    try {
      const fullKey = `${prefix}${id}`;
      await redis.del(fullKey);
      return true;
    } catch (error) {
      console.error(`❌ Error removing ${id} from Redis:`, error.message);
      return false;
    }
  };

  /**
   * Load all existing auth keys from Redis
   */
  const loadAllKeys = async () => {
    try {
      const keys = await redis.keys(`${prefix}*`);
      return keys.map(k => k.replace(prefix, ''));
    } catch (error) {
      console.error('❌ Error loading keys from Redis:', error.message);
      return [];
    }
  };

  // Load credentials
  let creds = await readData('creds');
  
  if (!creds) {
    console.log('📭 No existing session found in Redis, creating new session...');
    creds = initAuthCreds();
  } else {
    console.log('✅ Session credentials loaded from Redis');
  }

  // Load all other keys
  const allKeys = await loadAllKeys();
  const keys = {};
  
  for (const key of allKeys) {
    if (key !== 'creds') {
      keys[key] = await readData(key);
    }
  }
  
  if (allKeys.length > 0) {
    console.log(`📚 Loaded ${allKeys.length - (creds ? 1 : 0)} auth keys from Redis`);
  }

  // Construct auth state object
  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {};
        for (const id of ids) {
          const value = keys[`${type}-${id}`];
          if (value) {
            data[id] = value;
          }
        }
        return data;
      },
      set: async (data) => {
        for (const type in data) {
          for (const id in data[type]) {
            const key = `${type}-${id}`;
            const value = data[type][id];
            
            if (value) {
              keys[key] = value;
              await writeData(key, value);
            } else {
              delete keys[key];
              await removeData(key);
            }
          }
        }
      },
    },
  };

  /**
   * Save credentials when they update
   */
  const saveCreds = async () => {
    try {
      await writeData('creds', state.creds);
      console.log('💾 Auth credentials saved to Redis');
    } catch (error) {
      console.error('❌ Failed to save credentials:', error.message);
    }
  };

  return {
    state,
    saveCreds,
  };
}

/**
 * Clear all auth data from Redis
 */
async function clearAuthState(sessionId = 'main') {
  try {
    const prefix = `${SESSION_PREFIX}${sessionId}:`;
    const keys = await redis.keys(`${prefix}*`);
    
    if (keys.length > 0) {
      await redis.del(keys);
      console.log(`🗑️ Cleared ${keys.length} auth keys from Redis`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error clearing auth state:', error.message);
    return false;
  }
}

/**
 * Check if session exists in Redis
 */
async function sessionExists(sessionId = 'main') {
  try {
    const prefix = `${SESSION_PREFIX}${sessionId}:`;
    const keys = await redis.keys(`${prefix}*`);
    return keys.length > 0;
  } catch (error) {
    console.error('❌ Error checking session:', error.message);
    return false;
  }
}

module.exports = {
  useRedisAuthState,
  clearAuthState,
  sessionExists,
  SESSION_PREFIX,
  initAuthCreds,
};
