// Vercel API Handler for WhatsApp Bot
// This file handles HTTP requests in Vercel serverless environment

const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { startBot } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://rt5vc.vercel.app',
      'http://localhost:3000',
      'http://localhost:5173',
    ];
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: 'GET, POST, PUT, DELETE, OPTIONS',
  allowedHeaders: 'Content-Type, Authorization',
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check Redis connection
    const { redis } = require('../lib/redis');
    const redisStatus = await redis.ping();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      redis: redisStatus === 'PONG' ? 'connected' : 'error',
    });
  } catch (error) {
    res.json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

// Bot status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: ['/health', '/api', '/api/send', '/api/sessions'],
  });
});

// API Info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'WhatsApp Bot API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      send: '/api/send',
      notify: '/api/notify',
      sessions: '/api/sessions',
      jobs: {
        enqueue: '/api/jobs',
        status: '/api/jobs/:jobId',
        cancel: '/api/jobs/:jobId/cancel',
        retry: '/api/jobs/:jobId/retry',
        list: '/api/jobs/list/:status',
        stats: '/api/jobs/stats',
      },
      worker: '/api/worker',
      cron: '/api/cron',
    },
  });
});

// Send message endpoint
app.post('/api/send', async (req, res) => {
  try {
    const { to, message, type = 'text', usePipedream = false } = req.body;

    if (!to || !message) {
      return res.status(400).json({
        error: 'Missing required fields: to, message',
      });
    }

    // Check if Pipedream should be used
    const pipedreamWebhookUrl = process.env.PIPEDREAM_WEBHOOK_URL;
    
    if (usePipedream && pipedreamWebhookUrl) {
      // Use Pipedream for processing (hybrid mode)
      const { enqueueJob, JobType } = require('../lib/queue');
      
      // Enqueue job
      const jobId = await enqueueJob(JobType.SEND_MESSAGE, { to, message, type });
      
      // Trigger Pipedream
      await triggerPipedream(pipedreamWebhookUrl, jobId);
      
      res.json({
        success: true,
        jobId,
        status: 'queued',
        message: 'Message queued for processing via Pipedream',
      });
    } else {
      // Use local processing (Vercel only)
      const { sendMessage } = require('./bot');
      
      const result = await sendMessage(to, message, type);
      res.json({
        success: true,
        messageId: result?.key?.id,
        status: 'sent',
      });
    }
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      error: 'Failed to send message',
      details: error.message,
    });
  }
});

/**
 * Trigger Pipedream webhook
 */
async function triggerPipedream(webhookUrl, jobId) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    });
    console.log(`🚀 Pipedream triggered for job ${jobId}`);
  } catch (error) {
    console.error('Failed to trigger Pipedream:', error.message);
  }
}

// Notify endpoint (compatible with local /api/notify)
app.post('/api/notify', async (req, res) => {
  try {
    const { number, bodyMessage } = req.body;

    if (!number || !bodyMessage) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: number, bodyMessage',
      });
    }

    // Format nomor
    const formattedNumber = number.includes('@s.whatsapp.net') 
      ? number 
      : `${number}@s.whatsapp.net`;

    const { sendMessage } = require('./bot');
    const result = await sendMessage(formattedNumber, bodyMessage, 'text');

    res.json({
      success: true,
      message: `Pesan berhasil dikirim ke ${number}`,
      messageId: result?.key?.id,
    });
  } catch (error) {
    console.error('Notify error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengirim pesan',
      details: error.message,
    });
  }
});

// Session management endpoints
app.get('/api/sessions', async (req, res) => {
  try {
    const { getAllSessionIds } = require('../lib/session');
    const sessions = await getAllSessionIds();
    res.json({
      count: sessions.length,
      sessions,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get sessions',
      details: error.message,
    });
  }
});

app.delete('/api/sessions', async (req, res) => {
  try {
    const { clearAllSessions } = require('../lib/session');
    await clearAllSessions();
    res.json({
      success: true,
      message: 'All sessions cleared',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to clear sessions',
      details: error.message,
    });
  }
});

// Webhook endpoint for incoming messages
app.post('/api/webhook', async (req, res) => {
  try {
    const messages = req.body.messages || [];
    for (const msg of messages) {
      console.log('Incoming message:', msg.key?.id || msg.key?.remoteJid);
    }
    res.json({ received: messages.length });
  } catch (error) {
    res.status(500).json({
      error: 'Webhook processing failed',
      details: error.message,
    });
  }
});

// ===========================================
// Job Management Endpoints
// ===========================================

// Enqueue a job
app.post('/api/jobs', async (req, res) => {
  try {
    const { type, payload, options = {} } = req.body;

    if (!type || !payload) {
      return res.status(400).json({
        error: 'Missing required fields: type, payload',
      });
    }

    const { enqueueJob, JobType } = require('../lib/queue');

    // Validate job type
    if (!Object.values(JobType).includes(type)) {
      return res.status(400).json({
        error: `Invalid job type. Valid types: ${Object.values(JobType).join(', ')}`,
      });
    }

    const jobId = await enqueueJob(type, payload, options);

    res.json({
      success: true,
      jobId,
      type,
      status: 'pending',
      message: 'Job enqueued successfully',
    });
  } catch (error) {
    console.error('Enqueue job error:', error);
    res.status(500).json({
      error: 'Failed to enqueue job',
      details: error.message,
    });
  }
});

// Get job status
app.get('/api/jobs/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { getJobStatus } = require('../lib/queue');

    const job = await getJobStatus(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
      });
    }

    res.json({
      success: true,
      job,
    });
  } catch (error) {
    console.error('Get job status error:', error);
    res.status(500).json({
      error: 'Failed to get job status',
      details: error.message,
    });
  }
});

// Cancel a job
app.post('/api/jobs/:jobId/cancel', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { cancelJob } = require('../lib/queue');

    const cancelled = await cancelJob(jobId);

    if (!cancelled) {
      return res.status(400).json({
        error: 'Job not found or cannot be cancelled (only pending jobs can be cancelled)',
      });
    }

    res.json({
      success: true,
      jobId,
      message: 'Job cancelled successfully',
    });
  } catch (error) {
    console.error('Cancel job error:', error);
    res.status(500).json({
      error: 'Failed to cancel job',
      details: error.message,
    });
  }
});

// Retry a failed job
app.post('/api/jobs/:jobId/retry', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { retryJob } = require('../lib/queue');

    const retried = await retryJob(jobId);

    if (!retried) {
      return res.status(400).json({
        error: 'Job not found or cannot be retried (only failed jobs can be retried)',
      });
    }

    res.json({
      success: true,
      jobId,
      message: 'Job queued for retry',
    });
  } catch (error) {
    console.error('Retry job error:', error);
    res.status(500).json({
      error: 'Failed to retry job',
      details: error.message,
    });
  }
});

// Get jobs by status
app.get('/api/jobs/list/:status', async (req, res) => {
  try {
    const { status } = req.params;
    const limit = parseInt(req.query.limit || '50', 10);
    const { getJobsByStatus, JobStatus } = require('../lib/queue');

    // Validate status
    if (!Object.values(JobStatus).includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Valid statuses: ${Object.values(JobStatus).join(', ')}`,
      });
    }

    const jobs = await getJobsByStatus(status, limit);

    res.json({
      success: true,
      status,
      count: jobs.length,
      jobs,
    });
  } catch (error) {
    console.error('Get jobs by status error:', error);
    res.status(500).json({
      error: 'Failed to get jobs',
      details: error.message,
    });
  }
});

// Get queue statistics
app.get('/api/jobs/stats', async (req, res) => {
  try {
    const { type } = req.query;
    const { getQueueStats } = require('../lib/queue');
    
    const stats = await getQueueStats(type);
    
    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Get queue stats error:', error);
    res.status(500).json({
      error: 'Failed to get queue statistics',
      details: error.message,
    });
  }
});

// Worker endpoint - process jobs on-demand
app.post('/api/worker', async (req, res) => {
  try {
    const worker = require('./worker');
    await worker(req, res);
  } catch (error) {
    console.error('Worker error:', error);
    res.status(500).json({
      error: 'Worker failed',
      details: error.message,
    });
  }
});

// Cron endpoint - trigger cron job manually
app.post('/api/cron', async (req, res) => {
  try {
    const cron = require('./cron');
    await cron(req, res);
  } catch (error) {
    console.error('Cron error:', error);
    res.status(500).json({
      error: 'Cron failed',
      details: error.message,
    });
  }
});

// Create HTTP server
const server = createServer(app);

// Initialize bot (only once)
let botInitialized = false;

async function initializeBot() {
  if (!botInitialized) {
    try {
      await startBot();
      botInitialized = true;
      console.log('✅ Bot initialized in API mode');
    } catch (error) {
      console.error('❌ Bot initialization failed:', error.message);
    }
  }
}

// Vercel serverless export
module.exports = async (req, res) => {
  // Initialize bot on first request
  if (!botInitialized) {
    await initializeBot();
  }
  return app(req, res);
};

// For local development
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`📍 API docs: http://localhost:${PORT}/api`);
  });
}
