# WhatsApp Bot with Koyeb / VPS

A WhatsApp bot built with Baileys, deployable on **Koyeb** or **VPS**. Supports Redis for session persistence and 24/7 always-on operation.

## Features

- 🚀 **Koyeb Deployment** - Free tier Docker container with 24/7 uptime
- 💾 **Redis Session Storage** - Use Upstash Redis for session persistence
- 📱 **QR Code via Browser** - Easy WhatsApp authentication via `/qr` endpoint
- 🎯 **Always-On Mode** - Deploy on Koyeb or VPS for continuous bot operation
- 🔄 **Auto Reconnect** - Exponential backoff reconnection on disconnect

## Prerequisites

1. **Node.js 18+** installed
2. **Upstash Redis account** - [Sign up here](https://console.upstash.com/)
3. **Koyeb account** (for Koyeb deployment) - [Sign up here](https://koyeb.com/)

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

## Deployment

### Koyeb (Recommended - Free & Always-On)

Koyeb provides a free tier that supports Docker containers and keeps your bot running 24/7.

1. Push your code to GitHub
2. Go to [Koyeb Dashboard](https://koyeb.com/)
3. Create a new **Service** > Select **GitHub**
4. Choose your repository
5. Select **Docker** as the build method
6. Add environment variables:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
7. Set **Port** to `8888`
8. Click **Deploy**

After deployment:
- Visit `/qr` endpoint to scan WhatsApp QR code
- Visit `/status` to check bot connection status
- Visit `/health` for health check (used by Koyeb)

### VPS (Oracle Cloud Free Tier)

For maximum control and persistence, deploy on a VPS. See [docs/VPS_SETUP_GUIDE.md](docs/VPS_SETUP_GUIDE.md) for detailed instructions.

## API Endpoints

Once deployed, the following endpoints are available:

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check with server and bot status |
| GET | `/status` | Bot connection status |
| GET | `/qr` | QR code page for WhatsApp authentication |
| GET | `/api` | API information and bot status |
| POST | `/api/notify` | Send a WhatsApp message |
| POST | `/api/clear-session` | Clear session and restart bot |

### Example: Send a Message

```bash
curl -X POST https://your-app.koyeb.app/api/notify \
  -H "Content-Type: application/json" \
  -d '{
    "number": "6281234567890",
    "bodyMessage": "Hello from the bot!"
  }'
```

### Example: Check Bot Status

```bash
curl https://your-app.koyeb.app/status
```

### Example: Clear Session

```bash
curl -X POST https://your-app.koyeb.app/api/clear-session
```

## Project Structure

```
wa-bot-v2/
├── lib/
│   ├── redis.js         # Redis configuration & helpers
│   ├── session.js       # Redis-based session storage
│   ├── baileys-redis-auth.js  # Baileys auth adapter for Redis
│   ├── queue.js         # Queue system for job management
│   └── email-notify.js  # Email notification helpers
├── docs/
│   ├── VPS_SETUP_GUIDE.md    # VPS deployment guide
│   └── QUEUE_SYSTEM.md       # Queue system documentation
├── Dockerfile          # Docker configuration for Koyeb
├── package.json        # Dependencies & scripts
├── .env.example        # Environment variables template
├── index.js            # Main entry point (Express + Bot)
└── README.md           # This file
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis REST Token |
| `NODE_ENV` | No | Environment (development/production) |
| `PORT` | No | Port for server (default: 8888) |

## Troubleshooting

### Redis Connection Failed

```
❌ Redis connection error
```
Make sure your Upstash credentials are correct and the database is active.

### Session Not Found

```
📭 No session found in Redis
```
The session will be created automatically when you scan the QR code.

### Bot Not Connected

```
⚠️ Bot failed to start
```
1. Check Redis connection
2. Verify Upstash Redis status
3. Check Koyeb logs for detailed error messages
4. Try clearing session: `POST /api/clear-session`

### High Failure Rate

1. Check if phone numbers are valid and registered on WhatsApp
2. Verify message content format
3. Review rate limiting settings

## License

ISC
