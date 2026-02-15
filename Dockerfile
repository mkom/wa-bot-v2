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

# Expose the port (Koyeb will override this with PORT env var)
ENV PORT=8888
EXPOSE 8888

# Run directly without PM2 for simpler container management on Koyeb
CMD ["node", "index.js"]
