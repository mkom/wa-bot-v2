// Redis-based auth state adapter for Baileys
// Replaces useMultiFileAuthState with pure Redis storage
// Compatible with Koyeb, Vercel, and other ephemeral filesystem platforms

const { redis } = require('./redis');

const SESSION_PREFIX = 'baileys:auth:';

/**
 * Serialize Baileys data using Baileys' own BufferJSON
 * This properly handles Buffers, Uint8Arrays, and other special types
 */
function serialize(data) {
  return JSON.stringify(data, (key, value) => {
    // Handle Buffer
    if (Buffer.isBuffer(value)) {
      return { type: 'Buffer', data: value.toString('base64') };
    }
    // Handle Uint8Array
    if (value instanceof Uint8Array) {
      return { type: 'Uint8Array', data: Buffer.from(value).toString('base64') };
    }
    // Handle other typed arrays
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      return { 
        type: value.constructor.name, 
        data: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') 
      };
    }
    return value;
  });
}

/**
 * Deserialize Baileys data - restore Buffers and TypedArrays
 */
function deserialize(data) {
  if (!data) return null;
  
  try {
    // If data is already an object (Upstash auto-parsed), process it directly
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    
    return restoreBuffers(parsed);
  } catch (error) {
    console.error('Deserialize error:', error.message);
    return null;
  }
}

/**
 * Recursively restore Buffers and TypedArrays in an object
 */
function restoreBuffers(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => restoreBuffers(item));
  }
  
  // Handle special types
  if (obj.type && obj.data) {
    try {
      const buffer = Buffer.from(obj.data, 'base64');
      
      switch (obj.type) {
        case 'Buffer':
          return buffer;
        case 'Uint8Array':
          return new Uint8Array(buffer);
        case 'Uint16Array':
          return new Uint16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
        case 'Uint32Array':
          return new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
        case 'Int8Array':
          return new Int8Array(buffer);
        case 'Int16Array':
          return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
        case 'Int32Array':
          return new Int32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
        default:
          // If unknown type but has data, return as Buffer
          return buffer;
      }
    } catch (e) {
      console.error('Error restoring buffer:', e.message);
      return obj;
    }
  }
  
  // Handle plain objects - recursively process all properties
  const result = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      result[key] = restoreBuffers(obj[key]);
    }
  }
  return result;
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
      
      // Deserialize to restore Buffers and TypedArrays
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
      
      // Debug: log what we're saving
      if (id === 'creds') {
        console.log('💾 Saving creds keys:', Object.keys(data || {}));
      }
      
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

  // Import Baileys initAuthCreds to generate proper credentials
  const { initAuthCreds } = await import('@whiskeysockets/baileys');

  // Load credentials from Redis
  let creds = await readData('creds');
  
  // Debug: check what we loaded
  if (creds) {
    console.log('📋 Loaded creds keys:', Object.keys(creds));
    console.log('📋 noiseKey exists:', !!creds.noiseKey);
    console.log('📋 noiseKey has private:', !!(creds.noiseKey && creds.noiseKey.private));
    console.log('📋 noiseKey.private is Buffer:', !!(creds.noiseKey && creds.noiseKey.private && Buffer.isBuffer(creds.noiseKey.private)));
  }
  
  if (!creds || !creds.noiseKey || !creds.noiseKey.private) {
    console.log('📭 No valid session found in Redis, creating new session...');
    creds = initAuthCreds();
    console.log('📋 New creds keys:', Object.keys(creds));
  } else {
    console.log('✅ Valid session credentials loaded from Redis');
  }

  // Load all other keys
  const allKeys = await loadAllKeys();
  const keyStore = {};
  
  for (const key of allKeys) {
    if (key !== 'creds') {
      keyStore[key] = await readData(key);
    }
  }
  
  if (allKeys.length > 1) {
    console.log(`📚 Loaded ${allKeys.length - 1} auth keys from Redis`);
  }

  // Construct auth state object with proper key store interface
  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {};
        for (const id of ids) {
          const value = keyStore[`${type}-${id}`];
          if (value) {
            data[id] = value;
          }
        }
        return data;
      },
      set: async (data) => {
        console.log('🔑 keys.set called with types:', Object.keys(data));
        for (const type in data) {
          for (const id in data[type]) {
            const key = `${type}-${id}`;
            const value = data[type][id];
            
            if (value) {
              keyStore[key] = value;
              await writeData(key, value);
            } else {
              delete keyStore[key];
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
      // Upstash Redis `del` expects variadic keys, not an array
      await redis.del(...keys);
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
};
