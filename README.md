# WhatsApp Bot with Vercel and Upstash Redis

A WhatsApp bot built with Baileys, deployed on Vercel with Upstash Redis for session caching and rate limiting.

## Features

- 🚀 **Vercel Serverless Deployment** - Deploy as Vercel Functions
- 💾 **Redis Session Storage** - Use Upstash Redis instead of local files
- ⚡ **Rate Limiting** - Built-in rate limiting with @upstash/ratelimit
- 🔄 **Health Monitoring** - Endpoints for monitoring bot and Redis status

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

## API Endpoints

Once deployed, the following endpoints are available:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check with Redis status |
| GET | `/api` | API information |
| POST | `/api/send` | Send a WhatsApp message |
| GET | `/api/sessions` | List all sessions |
| DELETE | `/api/sessions` | Clear all sessions |
| POST | `/api/webhook` | Webhook for incoming messages |

### Example: Send a Message

```bash
curl -X POST https://your-project.vercel.app/api/send \
  -H "Content-Type: application/json" \
  -d '{"to": "1234567890@s.whatsapp.net", "message": "Hello from the bot!"}'
```

## Project Structure

```
wa-bot-v2/
├── api/
│   ├── index.js      # Main API handler (Vercel Functions)
│   └── bot.js        # WhatsApp bot logic
├── lib/
│   ├── redis.js      # Redis configuration & helpers
│   └── session.js    # Redis-based session storage
├── vercel.json       # Vercel configuration
├── package.json      # Dependencies & scripts
├── .env.example      # Environment variables template
└── README.md         # This file
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis REST Token |
| `NODE_ENV` | No | Environment (development/production) |
| `PORT` | No | Port for local development (default: 3000) |

## Limitations & Considerations

### WhatsApp Bot on Vercel

⚠️ **Important**: WhatsApp bots using Baileys require persistent WebSocket connections, which can be challenging with Vercel's serverless model:

1. **Cold Starts**: The bot may experience delays on first request
2. **Session Management**: Sessions are stored in Redis for persistence
3. **WebSocket Limitations**: Long-running connections may time out

### Recommended Production Setup

For production WhatsApp bots, consider:

- **Bot Core**: Deploy on a platform with persistent server capabilities (Railway, Render, VPS)
- **API Layer**: Use Vercel for API endpoints and webhooks
- **Redis**: Use Upstash for caching and rate limiting

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

## License

ISC

## Support

For issues and questions, please open a GitHub issue.
