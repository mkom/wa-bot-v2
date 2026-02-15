# WhatsApp Bot with Vercel and Upstash Redis

A WhatsApp bot built with Baileys, deployed on Vercel with Upstash Redis for session caching, rate limiting, and **queue-based job processing**.

## Features

- 🚀 **Vercel Serverless Deployment** - Deploy as Vercel Functions
- 💾 **Redis Session Storage** - Use Upstash Redis instead of local files
- ⚡ **Rate Limiting** - Built-in rate limiting with @upstash/ratelimit
- 🔄 **Queue System** - Cron job and on-demand job execution with Redis queue
- 📊 **Job Management** - Track job status, retry failed jobs, and monitor queues
- 🔄 **Health Monitoring** - Endpoints for monitoring bot and Redis status
- 🎯 **Stateless Execution** - Bot connects, sends, and disconnects automatically

## Prerequisites

1. **Node.js 18+** installed
2. **Upstash Redis account** - [Sign up here](https://console.upstash.com/)
3. **Vercel account** - [Sign up here](https://vercel.com/)

## Quick Start

### 1. Clone and Install Dependencies

```bash
cd wa-bot-v2
npm install
```

### 2. Set Up Upstash Redis

1. Go to [Upstash Console](https://console.upstash.com/)
2. Create a new Redis database
3. Copy the **REST URL** and **REST Token**

### 3. Configure Environment Variables

```bash
# Copy the example env file
cp .env.example .env

# Edit .env and add your Upstash credentials
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token
```

### 4. Run Locally

```bash
npm run dev
```

The bot will start and display a QR code for WhatsApp authentication.

## Deployment to Vercel

### Option 1: Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Link your project
vercel link

# Add environment variables
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN

# Deploy to production
vercel --prod
```

### Option 2: Vercel Dashboard

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "Add New Project"
3. Import your GitHub repository
4. Add environment variables:
   - `UPSTASH_REDIS_REST_URL` (Secret)
   - `UPSTASH_REDIS_REST_TOKEN` (Secret)
5. Click "Deploy"

### ⚠️ Important: Disable Vercel Authentication

After deployment, you need to disable Vercel Authentication to allow API access:

1. Go to your project in [Vercel Dashboard](https://vercel.com/dashboard)
2. Navigate to **Settings** → **Protection**
3. Disable **Vercel Authentication**
4. Save changes

This is required because the API endpoints need to be accessible without authentication for external integrations.

## API Endpoints

Once deployed, the following endpoints are available:

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check with Redis status |
| GET | `/api` | API information |
| POST | `/api/send` | Send a WhatsApp message |
| POST | `/api/notify` | Send notification (compatible with local API) |
| GET | `/api/sessions` | List all sessions |
| DELETE | `/api/sessions` | Clear all sessions |
| POST | `/api/webhook` | Webhook for incoming messages |

### Job Management Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/jobs` | Enqueue a new job |
| GET | `/api/jobs/:jobId` | Get job status |
| POST | `/api/jobs/:jobId/cancel` | Cancel a pending job |
| POST | `/api/jobs/:jobId/retry` | Retry a failed job |
| GET | `/api/jobs/list/:status` | List jobs by status |
| GET | `/api/jobs/stats` | Get queue statistics |

### Worker & Cron Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/worker` | Process jobs on-demand |
| GET | `/api/cron` | Trigger cron job manually |

### Example: Send a Message

```bash
curl -X POST https://your-project.vercel.app/api/send \
  -H "Content-Type: application/json" \
  -d '{"to": "1234567890@s.whatsapp.net", "message": "Hello from the bot!"}'
```

### Example: Enqueue a Job

```bash
curl -X POST https://your-project.vercel.app/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "send_message",
    "payload": {
      "to": "1234567890@s.whatsapp.net",
      "message": "Hello from queue!"
    }
  }'
```

### Example: Check Job Status

```bash
curl https://your-project.vercel.app/api/jobs/job_1234567890_abc123
```

### Example: Get Queue Statistics

```bash
curl https://your-project.vercel.app/api/jobs/stats
```

## Queue System

This bot includes a powerful queue system for cron job and on-demand execution. For detailed documentation, see [docs/QUEUE_SYSTEM.md](docs/QUEUE_SYSTEM.md).

### Key Features

- **Stateless Execution**: Bot connects, sends, and disconnects automatically
- **Redis Queue**: Jobs stored in Upstash Redis with priority support
- **Cron Jobs**: Automatic processing every 5 minutes (configurable)
- **On-Demand Processing**: Trigger worker manually via API
- **Job Types**: Send message, broadcast, scheduled message, custom
- **Retry Logic**: Automatic retry with exponential backoff
- **Status Tracking**: Monitor job status in real-time

### Quick Start with Queue

```bash
# Enqueue a message job
curl -X POST https://your-project.vercel.app/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "send_message",
    "payload": {
      "to": "1234567890@s.whatsapp.net",
      "message": "Hello from queue!"
    }
  }'

# The job will be processed automatically by cron (every 5 minutes)
# Or process immediately:
curl -X POST https://your-project.vercel.app/api/worker \
  -H "Content-Type: application/json" \
  -d '{"action": "process", "count": 1}'
```

## Project Structure

```
wa-bot-v2/
├── api/
│   ├── index.js      # Main API handler (Vercel Functions)
│   ├── bot.js        # WhatsApp bot logic
│   ├── cron.js       # Cron job handler
│   └── worker.js     # On-demand worker endpoint
├── lib/
│   ├── redis.js      # Redis configuration & helpers
│   ├── session.js    # Redis-based session storage
│   ├── queue.js      # Queue system for job management
│   └── job-handlers.js # Job processors
├── docs/
│   └── QUEUE_SYSTEM.md # Queue system documentation
├── vercel.json       # Vercel configuration with cron jobs
├── package.json      # Dependencies & scripts
├── .env.example      # Environment variables template
└── README.md         # This file
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis REST Token |
| `CRON_SECRET` | No | Secret to protect cron endpoints (recommended) |
| `MAX_JOBS_PER_RUN` | No | Maximum jobs to process per cron run (default: 10) |
| `NODE_ENV` | No | Environment (development/production) |
| `PORT` | No | Port for local development (default: 3000) |

## Limitations & Considerations

### WhatsApp Bot on Vercel

⚠️ **Important**: WhatsApp bots using Baileys require persistent WebSocket connections, which can be challenging with Vercel's serverless model:

1. **Cold Starts**: The bot may experience delays on first request
2. **Session Management**: Sessions are stored in Redis for persistence
3. **WebSocket Limitations**: Long-running connections may time out

### Queue System Architecture

✅ **Solution**: This bot uses a queue-based architecture that works perfectly with Vercel:

1. **Stateless Execution**: Bot connects, sends message, and disconnects immediately
2. **No Persistent Connection**: No need to keep WebSocket open 24/7
3. **Redis Queue**: Jobs are queued and processed on-demand or by cron
4. **Automatic Retry**: Failed jobs are retried with exponential backoff
5. **Session Persistence**: WhatsApp session is stored in Redis for 7 days

### Recommended Production Setup

For production WhatsApp bots, this queue-based architecture is ideal:

- **Vercel**: Deploy API endpoints and cron jobs
- **Upstash Redis**: Store sessions, queue data, and job status
- **Pre-Auth**: Authenticate locally and save session to Redis
- **Queue System**: Use cron jobs for scheduled processing or trigger on-demand

### Pre-Authentication Process

1. Run the bot locally: `npm run dev`
2. Scan QR code with WhatsApp
3. Session is automatically saved to Redis
4. Deploy to Vercel - bot will use the saved session
5. No need to scan QR code on Vercel

## Troubleshooting

### Redis Connection Failed

```
❌ Redis connection error
```
Make sure your Upstash credentials are correct and the database is active.

### Session Not Found

```
📭 Session not found: main
```
The session will be created automatically when you scan the QR code.

### Rate Limited

```
429 Too Many Requests
```
You're making too many requests. Wait a few seconds before trying again.

### Jobs Not Processing

1. Check cron job status in Vercel dashboard
2. Verify Redis connection: `GET /health`
3. Check queue stats: `GET /api/jobs/stats`
4. Manually trigger worker: `POST /api/worker`

### Bot Connection Issues

1. Verify session exists in Redis
2. Check session expiration (7 days TTL)
3. Re-authenticate locally if session expired
4. Check Upstash Redis status

### High Failure Rate

1. Check job error messages
2. Verify phone numbers are valid
3. Check message content format
4. Review rate limiting settings

For more troubleshooting tips, see [docs/QUEUE_SYSTEM.md](docs/QUEUE_SYSTEM.md).

## License

ISC

## Support

For issues and questions:
- Open a GitHub issue
- Check [docs/QUEUE_SYSTEM.md](docs/QUEUE_SYSTEM.md) for queue system documentation
- Review [RECOMMENDATIONS.md](RECOMMENDATIONS.md) for best practices
