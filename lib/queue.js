// Redis Queue System for WhatsApp Bot
// Handles job queuing, processing, and status tracking

const { redis } = require('./redis');

// Helper function to safely parse job data from Redis
function parseJobData(jobData) {
  if (!jobData) {
    return null;
  }
  // Handle both string and object responses
  if (typeof jobData === 'string') {
    return JSON.parse(jobData);
  }
  return jobData;
}

// Queue configuration
const QUEUE_PREFIX = 'wa:queue:';
const JOB_PREFIX = 'wa:job:';
const QUEUE_TTL = 86400 * 7; // 7 days
const JOB_TTL = 86400; // 24 hours for job data

// Job status constants
const JobStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

// Job types
const JobType = {
  SEND_MESSAGE: 'send_message',
  BROADCAST: 'broadcast',
  SCHEDULED_MESSAGE: 'scheduled_message',
  CUSTOM: 'custom',
};

/**
 * Generate a unique job ID
 */
function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Enqueue a job
 * @param {string} type - Job type
 * @param {Object} payload - Job payload
 * @param {Object} options - Job options (priority, delay, etc.)
 * @returns {Promise<string>} Job ID
 */
async function enqueueJob(type, payload, options = {}) {
  const jobId = generateJobId();
  const job = {
    id: jobId,
    type,
    payload,
    status: JobStatus.PENDING,
    createdAt: new Date().toISOString(),
    attempts: 0,
    maxAttempts: options.maxAttempts || 3,
    priority: options.priority || 0,
    delay: options.delay || 0,
    scheduledFor: options.scheduledFor || null,
    metadata: options.metadata || {},
  };

  // Store job data
  await redis.set(`${JOB_PREFIX}${jobId}`, JSON.stringify(job), {
    ex: JOB_TTL,
  });

  // Add to queue (with score for priority and delay)
  const score = (job.priority * 1000000) + Date.now() + (job.delay * 1000);
  await redis.zadd(`${QUEUE_PREFIX}${type}`, { score, member: jobId });

  console.log(`✅ Job enqueued: ${jobId} (${type})`);
  return jobId;
}

/**
 * Dequeue a job (get next job from queue)
 * @param {string} type - Job type
 * @returns {Promise<Object|null>} Job object or null
 */
async function dequeueJob(type) {
  const now = Date.now();
   
   // Get jobs that are ready to process (score <= now)
   // Use zrange with limit instead of zrangebyscore
   const jobs = await redis.zrange(`${QUEUE_PREFIX}${type}`, 0, 1);
   
   if (jobs.length === 0) {
     return null;
   }

   const jobId = jobs[0];
   
   // Remove from queue
   await redis.zrem(`${QUEUE_PREFIX}${type}`, jobId);
   
   // Get job data
   const jobData = await redis.get(`${JOB_PREFIX}${jobId}`);
   const job = parseJobData(jobData);
   if (!job) {
     return null;
   }

   // Update status to processing
   job.status = JobStatus.PROCESSING;
   job.startedAt = new Date().toISOString();
   await redis.set(`${JOB_PREFIX}${jobId}`, JSON.stringify(job), { ex: JOB_TTL });

   console.log(`🔄 Job dequeued: ${jobId} (${type})`);
   return job;
}

/**
 * Update job status
 * @param {string} jobId - Job ID
 * @param {string} status - New status
 * @param {Object} result - Result data (for completed/failed jobs)
 */
async function updateJobStatus(jobId, status, result = {}) {
  const jobData = await redis.get(`${JOB_PREFIX}${jobId}`);
  const job = parseJobData(jobData);
  if (!job) {
    return false;
  }
  job.status = status;
  job.updatedAt = new Date().toISOString();

  if (status === JobStatus.COMPLETED) {
    job.completedAt = new Date().toISOString();
    job.result = result;
  } else if (status === JobStatus.FAILED) {
    job.failedAt = new Date().toISOString();
    job.error = result.error || 'Unknown error';
    job.attempts++;
    
    // Retry logic
    if (job.attempts < job.maxAttempts) {
      job.status = JobStatus.PENDING;
      const retryDelay = Math.pow(2, job.attempts) * 1000; // Exponential backoff
      const score = Date.now() + retryDelay;
      await redis.zadd(`${QUEUE_PREFIX}${job.type}`, { score, member: jobId });
      console.log(`🔄 Job ${jobId} will retry in ${retryDelay}ms (attempt ${job.attempts}/${job.maxAttempts})`);
    }
  }

  await redis.set(`${JOB_PREFIX}${jobId}`, JSON.stringify(job), { ex: JOB_TTL });
  console.log(`📊 Job ${jobId} status updated: ${status}`);
  return true;
}

/**
 * Get job status
 * @param {string} jobId - Job ID
 * @returns {Promise<Object|null>} Job object or null
 */
async function getJobStatus(jobId) {
  const jobData = await redis.get(`${JOB_PREFIX}${jobId}`);
  return parseJobData(jobData);
}

/**
 * Cancel a job
 * @param {string} jobId - Job ID
 * @returns {Promise<boolean>} Success status
 */
async function cancelJob(jobId) {
  const jobData = await redis.get(`${JOB_PREFIX}${jobId}`);
  const job = parseJobData(jobData);
  if (!job) {
    return false;
  }
  
  // Only cancel pending jobs
  if (job.status !== JobStatus.PENDING) {
    return false;
  }

  // Remove from queue
  await redis.zrem(`${QUEUE_PREFIX}${job.type}`, jobId);
  
  // Update status
  await updateJobStatus(jobId, JobStatus.CANCELLED);
  
  console.log(`❌ Job cancelled: ${jobId}`);
  return true;
}

/**
 * Get queue statistics
 * @param {string} type - Job type (optional, for specific queue)
 * @returns {Promise<Object>} Queue statistics
 */
async function getQueueStats(type = null) {
  const queues = type ? [type] : Object.values(JobType);
  const stats = {
    total: 0,
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    byType: {},
  };

  for (const queueType of queues) {
    const queueSize = await redis.zcard(`${QUEUE_PREFIX}${queueType}`);
    stats.byType[queueType] = {
      pending: queueSize,
    };
    stats.total += queueSize;
    stats.pending += queueSize;
  }

  // Get all job keys to count by status
  const jobKeys = await redis.keys(`${JOB_PREFIX}*`);
  for (const key of jobKeys) {
    const jobData = await redis.get(key);
    const job = parseJobData(jobData);
    if (job) {
      if (job.status === JobStatus.PROCESSING) {
        stats.processing++;
      } else if (job.status === JobStatus.COMPLETED) {
        stats.completed++;
      } else if (job.status === JobStatus.FAILED) {
        stats.failed++;
      } else if (job.status === JobStatus.CANCELLED) {
        stats.cancelled++;
      }
    }
  }

  return stats;
}

/**
 * Clean up old completed/failed jobs
 * @param {number} olderThan - Age in seconds (default: 7 days)
 * @returns {Promise<number>} Number of jobs cleaned
 */
async function cleanupOldJobs(olderThan = 86400 * 7) {
  const cutoffTime = Date.now() - (olderThan * 1000);
  let cleaned = 0;

  const jobKeys = await redis.keys(`${JOB_PREFIX}*`);
  for (const key of jobKeys) {
    const jobData = await redis.get(key);
    const job = parseJobData(jobData);
    if (job) {
      const jobTime = new Date(job.createdAt).getTime();
      
      // Clean old completed/failed/cancelled jobs
      if (
        (job.status === JobStatus.COMPLETED ||
         job.status === JobStatus.FAILED ||
         job.status === JobStatus.CANCELLED) &&
        jobTime < cutoffTime
      ) {
        await redis.del(key);
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} old jobs`);
  }
  
  return cleaned;
}

/**
 * Get jobs by status
 * @param {string} status - Job status
 * @param {number} limit - Maximum number of jobs to return
 * @returns {Promise<Array>} Array of jobs
 */
async function getJobsByStatus(status, limit = 50) {
  const jobs = [];
  const jobKeys = await redis.keys(`${JOB_PREFIX}*`);
  
  for (const key of jobKeys.slice(0, limit)) {
    const jobData = await redis.get(key);
    const job = parseJobData(jobData);
    if (job) {
      if (job.status === status) {
        jobs.push(job);
      }
    }
  }
  
  // Sort by creation time (newest first)
  jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return jobs;
}

/**
 * Retry a failed job
 * @param {string} jobId - Job ID
 * @returns {Promise<boolean>} Success status
 */
async function retryJob(jobId) {
  const jobData = await redis.get(`${JOB_PREFIX}${jobId}`);
  const job = parseJobData(jobData);
  if (!job) {
    return false;
  }
  
  // Only retry failed jobs
  if (job.status !== JobStatus.FAILED) {
    return false;
  }

  // Reset job for retry
  job.status = JobStatus.PENDING;
  job.attempts = 0;
  job.error = null;
  job.updatedAt = new Date().toISOString();
  
  // Add back to queue
  const score = (job.priority * 1000000) + Date.now();
  await redis.zadd(`${QUEUE_PREFIX}${job.type}`, { score, member: jobId });
  
  // Update job data
  await redis.set(`${JOB_PREFIX}${jobId}`, JSON.stringify(job), { ex: JOB_TTL });
  
  console.log(`🔄 Job ${jobId} queued for retry`);
  return true;
}

module.exports = {
  JobStatus,
  JobType,
  enqueueJob,
  dequeueJob,
  updateJobStatus,
  getJobStatus,
  cancelJob,
  getQueueStats,
  cleanupOldJobs,
  getJobsByStatus,
  retryJob,
  generateJobId,
};
