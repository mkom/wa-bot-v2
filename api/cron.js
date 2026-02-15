// Vercel Cron Job Handler
// This endpoint is triggered by Vercel's cron system to process queued jobs

const { dequeueJob, JobType, getQueueStats, cleanupOldJobs } = require('../lib/queue');
const { processJob } = require('../lib/job-handlers');

/**
 * Process jobs from the queue
 * This function is called by Vercel cron jobs
 */
async function processQueue() {
  console.log('🔄 Starting queue processing...');
  
  const stats = await getQueueStats();
  console.log(`📊 Queue stats:`, JSON.stringify(stats, null, 2));
  
  if (stats.total === 0) {
    console.log('✅ No jobs to process');
    return {
      processed: 0,
      successful: 0,
      failed: 0,
      message: 'No jobs to process',
    };
  }
  
  const results = {
    processed: 0,
    successful: 0,
    failed: 0,
    jobs: [],
  };
  
  // Process jobs from each queue type
  const queueTypes = Object.values(JobType);
  const maxJobsPerRun = parseInt(process.env.MAX_JOBS_PER_RUN || '10', 10);
  
  for (const queueType of queueTypes) {
    let jobsProcessed = 0;
    
    while (jobsProcessed < maxJobsPerRun) {
      const job = await dequeueJob(queueType);
      
      if (!job) {
        break;
      }
      
      results.processed++;
      jobsProcessed++;
      
      try {
        await processJob(job);
        results.successful++;
        results.jobs.push({
          jobId: job.id,
          type: job.type,
          status: 'success',
        });
      } catch (error) {
        results.failed++;
        results.jobs.push({
          jobId: job.id,
          type: job.type,
          status: 'failed',
          error: error.message,
        });
      }
    }
  }
  
  console.log(`✅ Queue processing completed: ${results.processed} jobs processed`);
  
  return results;
}

/**
 * Cleanup old jobs
 * This function is called by Vercel cron jobs to clean up old completed/failed jobs
 */
async function performCleanup() {
  console.log('🧹 Starting cleanup...');
  
  const cleaned = await cleanupOldJobs();
  
  console.log(`✅ Cleanup completed: ${cleaned} jobs removed`);
  
  return {
    cleaned,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Main cron handler
 * This is the entry point for Vercel cron jobs
 */
module.exports = async (req, res) => {
  // Verify cron secret (optional but recommended)
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  const expectedSecret = process.env.CRON_SECRET;
  
  if (expectedSecret && cronSecret !== expectedSecret) {
    console.warn('⚠️ Unauthorized cron attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Get action from query parameter
  const action = req.query.action || 'process';
  
  try {
    let result;
    
    switch (action) {
      case 'process':
        result = await processQueue();
        break;
      case 'cleanup':
        result = await performCleanup();
        break;
      case 'all':
        const processResult = await processQueue();
        const cleanupResult = await performCleanup();
        result = {
          process: processResult,
          cleanup: cleanupResult,
        };
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    res.json({
      success: true,
      action,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error('❌ Cron job failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};
