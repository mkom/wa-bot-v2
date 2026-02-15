// Redis-based session storage for WhatsApp bot
// Replaces local file-based session storage with Upstash Redis

const { redis } = require('./redis');

// Session configuration
const SESSION_TTL = 86400 * 7; // 7 days in seconds
const SESSION_PREFIX = 'wa:session:';

/**
 * Save WhatsApp session to Redis
 * @param {string} sessionId - Unique session identifier
 * @param {Object} sessionData - Session data to store
 */
async function saveSession(sessionId, sessionData) {
  const key = `${SESSION_PREFIX}${sessionId}`;
  try {
    await redis.set(key, JSON.stringify(sessionData), {
      ex: SESSION_TTL,
    });
    console.log(`✅ Session saved: ${sessionId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to save session: ${error.message}`);
    return false;
  }
}

/**
 * Get WhatsApp session from Redis
 * @param {string} sessionId - Unique session identifier
 * @returns {Object|null} Session data or null if not found
 */
async function getSession(sessionId) {
  const key = `${SESSION_PREFIX}${sessionId}`;
  try {
    const data = await redis.get(key);
    if (data) {
      console.log(`📖 Session loaded: ${sessionId}`);
      // Handle both string and object responses from Redis
      if (typeof data === 'string') {
        return JSON.parse(data);
      }
      return data;
    }
    console.log(`📭 Session not found: ${sessionId}`);
    return null;
  } catch (error) {
    console.error(`❌ Failed to get session: ${error.message}`);
    return null;
  }
}

/**
 * Delete WhatsApp session from Redis
 * @param {string} sessionId - Unique session identifier
 */
async function deleteSession(sessionId) {
  const key = `${SESSION_PREFIX}${sessionId}`;
  try {
    await redis.del(key);
    console.log(`🗑️ Session deleted: ${sessionId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to delete session: ${error.message}`);
    return false;
  }
}

/**
 * Check if session exists
 * @param {string} sessionId - Unique session identifier
 * @returns {boolean} True if session exists
 */
async function sessionExists(sessionId) {
  const key = `${SESSION_PREFIX}${sessionId}`;
  try {
    const result = await redis.exists(key);
    return result === 1;
  } catch (error) {
    console.error(`❌ Failed to check session: ${error.message}`);
    return false;
  }
}

/**
 * Update specific session fields
 * @param {string} sessionId - Unique session identifier
 * @param {Object} updates - Fields to update
 */
async function updateSession(sessionId, updates) {
  const sessionData = await getSession(sessionId);
  if (sessionData) {
    const updatedData = { ...sessionData, ...updates };
    return await saveSession(sessionId, updatedData);
  }
  return false;
}

/**
 * Get all session keys (for debugging/cleanup)
 * @returns {Array<string>} Array of session IDs
 */
async function getAllSessionIds() {
  try {
    const keys = await redis.keys(`${SESSION_PREFIX}*`);
    return keys.map(key => key.replace(SESSION_PREFIX, ''));
  } catch (error) {
    console.error(`❌ Failed to get all sessions: ${error.message}`);
    return [];
  }
}

/**
 * Clear all sessions (use with caution)
 */
async function clearAllSessions() {
  try {
    const keys = await redis.keys(`${SESSION_PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(keys);
      console.log(`🗑️ Cleared ${keys.length} sessions`);
    }
    return true;
  } catch (error) {
    console.error(`❌ Failed to clear sessions: ${error.message}`);
    return false;
  }
}

module.exports = {
  saveSession,
  getSession,
  deleteSession,
  sessionExists,
  updateSession,
  getAllSessionIds,
  clearAllSessions,
  SESSION_PREFIX,
  SESSION_TTL,
};
