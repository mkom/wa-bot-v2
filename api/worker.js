// Queue Worker API Endpoint
// This endpoint processes jobs from the queue on-demand
// Can be triggered manually or by external systems
// Includes distributed locking to prevent multiple instance conflicts

const { dequeueJob, JobType, getQueueStats } = require('../lib/queue');
const { processJob } = require('../lib/job-handlers');
const { redis } = require('../lib/redis');

// Cooldown configuration
const COOLDOWN_KEY = 'wa:last_message_sent';
const DEFAULT_COOLDOWN_MS = 5000; // 5 seconds between messages

// Distributed lock configuration
const LOCK_KEY = 'wa:message_lock';
const LOCK_TIMEOUT_MS = 30000; // 30 seconds lock timeout
const LOCK_RETRY_DELAY_MS = 1000; // 1 second between lock retry attempts
const MAX_LOCK_RETRIES = 5; // Maximum retries to acquire lock

// Circuit breaker configuration
const CIRCUIT_BREAKER_KEY = 'wa:circuit_breaker';
const CIRCUIT_FAILURE_THRESHOLD = 5; // Number of failures before opening circuit
const CIRCUIT_TIMEOUT_MS = 30000; // 30 seconds before trying again

// Message deduplication
const DEDUP_KEY_PREFIX = 'wa:msg_dedup:';
const DEDUP_TTL_SECONDS = 300; // 5 minutes deduplication window

/**
 * Acquire distributed lock
 * @returns {Promise<boolean>} True if lock acquired, false otherwise
 */
async function acquireLock() {
  try {
    // Use SET NX EX for atomic lock acquisition with expiry
    const result = await redis.set(LOCK_KEY, Date.now().toString(), {
      nx: true, // Only set if not exists
      ex: 30, // 30 seconds expiry
    });
    return result === 'OK' || result === true;
  } catch (error) {
    console.error('Error acquiring lock:', error.message);
    return false;
  }
}

/**
 * Release distributed lock
 */
async function releaseLock() {
  try {
    await redis.del(LOCK_KEY);
    console.log('🔓 Lock released');
  } catch (error) {
    console.error('Error releasing lock:', error.message);
  }
}

/**
 * Check if lock is held by another instance
 * @returns {Promise<{held: boolean, holderSince?: number}>}
 */
async function checkLock() {
  try {
    const lockValue = await redis.get(LOCK_KEY);
    if (lockValue) {
      return { held: true, holderSince: parseInt(lockValue) };
    }
    return { held: false };
  } catch (error) {
    console.error('Error checking lock:', error.message);
    return { held: false };
  }
}

/**
 * Wait for lock to become available with retry
 * @returns {Promise<boolean>} True if lock acquired, false if max retries exceeded
 */
async function waitForLock() {
  for (let i = 0; i < MAX_LOCK_RETRIES; i++) {
    if (await acquireLock()) {
      console.log('🔐 Lock acquired');
      return true;
    }
    
    const lockInfo = await checkLock();
    console.log(`⏳ Lock held by another instance (attempt ${i + 1}/${MAX_LOCK_RETRIES})`);
    
    if (i < MAX_LOCK_RETRIES - 1) {
      await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
    }
  }
  
  console.warn('⚠️ Failed to acquire lock after max retries');
  return false;
}

/**
 * Check if circuit breaker is open (preventing further attempts)
 * @returns {Promise<boolean>}
 */
async function isCircuitOpen() {
  try {
    const circuitData = await redis.get(CIRCUIT_BREAKER_KEY);
    if (circuitData) {
      const { state, lastFailure } = typeof circuitData === 'string' 
        ? JSON.parse(circuitData) 
        : circuitData;
      
      if (state === 'OPEN') {
        const timeSinceFailure = Date.now() - new Date(lastFailure).getTime();
        if (timeSinceFailure < CIRCUIT_TIMEOUT_MS) {
          return true;
        }
        // Reset circuit after timeout
        await redis.del(CIRCUIT_BREAKER_KEY);
      }
    }
    return false;
  } catch (error) {
    console.error('Error checking circuit breaker:', error.message);
    return false;
  }
}

/**
 * Record circuit breaker failure
 */
async function recordCircuitFailure() {
  try {
    const circuitData = await redis.get(CIRCUIT_BREAKER_KEY);
    let failures = 1;
    let state = 'HALF_OPEN';
    
    if (circuitData) {
      const data = typeof circuitData === 'string' ? JSON.parse(circuitData) : circuitData;
      failures = (data.failures || 0) + 1;
      state = failures >= CIRCUIT_FAILURE_THRESHOLD ? 'OPEN' : 'HALF_OPEN';
    }
    
    await redis.set(CIRCUIT_BREAKER_KEY, JSON.stringify({
      state,
      failures,
      lastFailure: new Date().toISOString(),
    }), { ex: CIRCUIT_TIMEOUT_MS * 2 });
    
    if (state === 'OPEN') {
      console.warn('🔴 Circuit breaker opened - too many failures');
    }
  } catch (error) {
    console.error('Error recording circuit failure:', error.message);
  }
}

/**
 * Reset circuit breaker on success
 */
async function resetCircuit() {
  try {
    await redis.del(CIRCUIT_BREAKER_KEY);
    console.log('🟢 Circuit breaker reset');
  } catch (error) {
    console.error('Error resetting circuit breaker:', error.message);
  }
}

/**
 * Check for duplicate message (deduplication)
 * @param {string} messageKey - Unique identifier for the message
 * @returns {Promise<boolean>} True if duplicate detected
 */
async function isDuplicateMessage(messageKey) {
  try {
    const fullKey = `${DEDUP_KEY_PREFIX}${messageKey}`;
    const exists = await redis.exists(fullKey);
    if (exists) {
      console.log(`🔁 Duplicate message detected: ${messageKey}`);
      return true;
    }
    
    // Mark this message as processed
    await redis.set(fullKey, Date.now().toString(), { ex: DEDUP_TTL_SECONDS });
    return false;
  } catch (error) {
    console.error('Error checking duplicate:', error.message);
    return false;
  }
}

/**
 * Get the cooldown time remaining before sending next message
 * @returns {Promise<number>} Milliseconds to wait (0 if ready)
 */
async function getCooldownRemaining() {
  try {
    const lastSent = await redis.get(COOLDOWN_KEY);
    if (!lastSent) return 0;
    
    const lastSentTime = parseInt(lastSent);
    const elapsed = Date.now() - lastSentTime;
    const remaining = DEFAULT_COOLDOWN_MS - elapsed;
    
    return remaining > 0 ? remaining : 0;
  } catch (error) {
    console.error('Error checking cooldown:', error.message);
    return 0;
  }
}

/**
 * Update the last message sent timestamp
 */
async function updateCooldown() {
  try {
    await redis.set(COOLDOWN_KEY, Date.now().toString(), { ex: 60 }); // 60 second TTL
  } catch (error) {
    console.error('Error updating cooldown:', error.message);
  }
}

/**
 * Wait for cooldown to complete
 * @param {number} additionalDelay - Additional delay in ms
 */
async function waitForCooldown(additionalDelay = 0) {
  const cooldownRemaining = await getCooldownRemaining();
  const totalDelay = cooldownRemaining + additionalDelay;
  
  if (totalDelay > 0) {
    console.log(`⏳ Cooldown: waiting ${totalDelay}ms before next message...`);
    await new Promise(resolve => setTimeout(resolve, totalDelay));
  }
}

/**
 * Process a single job from the queue with distributed locking
 */
async function processSingleJob(queueType = null) {
  // Check circuit breaker
  if (await isCircuitOpen()) {
    return {
      success: false,
      message: 'Circuit breaker open - try again later',
      retryAfter: CIRCUIT_TIMEOUT_MS,
    };
  }
  
  // Try to acquire lock
  if (!await waitForLock()) {
    return {
      success: false,
      message: 'Another instance is processing, try again later',
      retryAfter: LOCK_RETRY_DELAY_MS * MAX_LOCK_RETRIES,
    };
  }
  
  const types = queueType ? [queueType] : Object.values(JobType);
  
  for (const type of types) {
    const job = await dequeueJob(type);
    if (job) {
      // Check for duplicate message
      const dedupKey = `${job.type}:${job.id}:${JSON.stringify(job.payload)}`;
      if (await isDuplicateMessage(dedupKey)) {
        releaseLock();
        return {
          success: false,
          jobId: job.id,
          message: 'Duplicate message ignored',
        };
      }
      
      // Wait for cooldown before processing
      await waitForCooldown();
      
      try {
        const result = await processJob(job);
        await updateCooldown();
        await resetCircuit();
        releaseLock();
        return {
          success: true,
          jobId: job.id,
          type: job.type,
          result,
        };
      } catch (error) {
        await recordCircuitFailure();
        releaseLock();
        return {
          success: false,
          jobId: job.id,
          type: job.type,
          error: error.message,
        };
      }
    }
  }
  
  releaseLock();
  return {
    success: false,
    message: 'No jobs available in queue',
  };
}

/**
 * Process multiple jobs from the queue with distributed locking
 * With proper delays between jobs to prevent socket conflicts
 */
async function processMultipleJobs(count = 5, queueType = null) {
  // Check circuit breaker
  if (await isCircuitOpen()) {
    return [{
      success: false,
      message: 'Circuit breaker open - try again later',
      retryAfter: CIRCUIT_TIMEOUT_MS,
    }];
  }
  
  // Try to acquire lock
  if (!await waitForLock()) {
    return [{
      success: false,
      message: 'Another instance is processing, try again later',
      retryAfter: LOCK_RETRY_DELAY_MS * MAX_LOCK_RETRIES,
    }];
  }
  
  const results = [];
  const types = queueType ? [queueType] : Object.values(JobType);
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;
  
  for (let i = 0; i < count; i++) {
    let jobProcessed = false;
    
    for (const type of types) {
      const job = await dequeueJob(type);
      if (job) {
        // Check for duplicate message
        const dedupKey = `${job.type}:${job.id}:${JSON.stringify(job.payload)}`;
        if (await isDuplicateMessage(dedupKey)) {
          results.push({
            success: false,
            jobId: job.id,
            message: 'Duplicate message ignored',
          });
          continue;
        }
        
        // Wait for cooldown before processing (add 2s extra for send_message jobs)
        const additionalDelay = job.type === JobType.SEND_MESSAGE ? 2000 : 0;
        await waitForCooldown(additionalDelay);
        
        try {
          const result = await processJob(job);
          await updateCooldown();
          results.push({
            success: true,
            jobId: job.id,
            type: job.type,
            result,
          });
          jobProcessed = true;
          consecutiveFailures = 0;
          await resetCircuit();
          break;
        } catch (error) {
          consecutiveFailures++;
          await recordCircuitFailure();
          results.push({
            success: false,
            jobId: job.id,
            type: job.type,
            error: error.message,
          });
          jobProcessed = true;
          
          // Break on too many consecutive failures
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.warn(`⚠️ Too many consecutive failures (${consecutiveFailures}), stopping batch`);
            releaseLock();
            return results;
          }
          break;
        }
      }
    }
    
    if (!jobProcessed) {
      break;
    }
  }
  
  releaseLock();
  return results;
}

/**
 * Main worker handler
 */
module.exports = async (req, res) => {
  // Only allow POST requests for job processing
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { action = 'process', count = 5, queueType } = req.body;
    
    console.log(`🔄 Worker triggered: action=${action}, count=${count}, queueType=${queueType}`);
    
    let result;
    
    switch (action) {
      case 'process':
        // Process multiple jobs
        result = await processMultipleJobs(count, queueType);
        break;
      case 'single':
        // Process a single job
        result = await processSingleJob(queueType);
        break;
      case 'stats':
        // Get queue statistics
        result = await getQueueStats(queueType);
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    res.json({
      success: true,
      action,
      timestamp: new Date().toISOString(),
      data: result,
    });
  } catch (error) {
    console.error('❌ Worker error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};
