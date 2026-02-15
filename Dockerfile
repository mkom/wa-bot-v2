FROM node:20-slim

# Install dependencies for Baileys and Puppeteer (if needed)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    imagemagick \
    webp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application
COPY . .

# Create session directory
RUN mkdir -p whatsapp-session

# Expose the port
EXPOSE 8888

# Use PM2 to manage the process
RUN npm install -g pm2

CMD ["pm2-runtime", "index.js"]
