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
      sessions: '/api/sessions',
    },
  });
});

// Send message endpoint
app.post('/api/send', async (req, res) => {
  try {
    const { to, message, type = 'text' } = req.body;

    if (!to || !message) {
      return res.status(400).json({
        error: 'Missing required fields: to, message',
      });
    }

    // Import bot module dynamically to avoid initialization issues
    const { sendMessage } = require('./bot');

    const result = await sendMessage(to, message, type);
    res.json({
      success: true,
      messageId: result?.key?.id,
      status: 'sent',
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      error: 'Failed to send message',
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
