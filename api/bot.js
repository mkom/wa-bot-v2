// WhatsApp Bot Logic for Vercel
// Separated from Express handlers for better organization

const { saveSession, getSession } = require('../lib/session');
const fs = require('fs');
const path = require('path');

// Bot state
let sock = null;
let botStarted = false;
let botInitializing = false;
let baileysModule = null;
let qrcodeModule = null;
let connectionPromise = null;

/**
 * Get appropriate auth directory
 * Uses /tmp for Vercel (read-only filesystem), local dir for development
 */
function getAuthDir() {
  const isVercel = process.env.VERCEL === '1';
  if (isVercel) {
    // Vercel has /tmp as writable
    return '/tmp/whatsapp-session';
  }
  return './whatsapp-session';
}

/**
 * Restore session files from Redis to filesystem
 * This is needed because Baileys requires files in filesystem
 */
async function restoreSessionFromRedis() {
  const authDir = getAuthDir();
  
  try {
    // Create directory if it doesn't exist
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    // Get session data from Redis
    console.log('🔍 Fetching session from Redis...');
    const sessionData = await getSession('main');
    
    if (sessionData && typeof sessionData === 'object') {
      console.log('📖 Restoring session from Redis...');
      
      // Write each session file to filesystem
      for (const [filename, content] of Object.entries(sessionData)) {
        const filePath = path.join(authDir, filename);
        const fileContent = typeof content === 'object' ? JSON.stringify(content, null, 2) : content;
        fs.writeFileSync(filePath, fileContent);
        console.log(`✅ Restored: ${filename}`);
      }
      
      console.log(`🎉 Session restored successfully (${Object.keys(sessionData).length} files)`);
      return true;
    }
    
    console.log('📭 No session found in Redis');
    return false;
  } catch (error) {
    console.error('❌ Error restoring session from Redis:', error.message);
    return false;
  }
}

/**
 * Save session files to Redis
 * Called when credentials are updated
 */
async function saveSessionToRedis() {
  const authDir = getAuthDir();
  
  if (!fs.existsSync(authDir)) {
    return;
  }

  const files = fs.readdirSync(authDir);
  const sessionData = {};

  for (const file of files) {
    const filePath = path.join(authDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    try {
      sessionData[file] = JSON.parse(content);
    } catch {
      sessionData[file] = content;
    }
  }

  if (Object.keys(sessionData).length > 0) {
    await saveSession('main', sessionData);
    console.log('💾 Session saved to Redis');
  }
}

/**
 * Initialize WhatsApp bot
 * Uses Redis for session storage instead of local files
 */
async function startBot() {
  // Prevent multiple concurrent initialization attempts
  if (botStarted && sock) {
    console.log('✅ Bot already connected');
    return sock;
  }
  
  // If already initializing, wait for that to complete
  if (botInitializing && connectionPromise) {
    console.log('⏳ Bot initialization in progress, waiting...');
    try {
      await connectionPromise;
      return sock;
    } catch (error) {
      // If the initialization failed, try again
      console.log('⚠️ Previous initialization failed, retrying...');
    }
  }
  
  console.log('🔄 Starting WhatsApp bot...');
  botInitializing = true;
  
  // Create a promise that resolves when connection is established
  connectionPromise = new Promise((resolve, reject) => {
    const cleanup = () => {
      botInitializing = false;
      connectionPromise = null;
    };
    
    const startConnection = async () => {
      try {
        // Clean up any existing socket
        if (sock) {
          console.log('🧹 Cleaning up existing socket...');
          try {
            sock.ws.close();
            sock.ev.removeAllListeners();
          } catch (e) {
            // Ignore cleanup errors
          }
          sock = null;
        }

        // Dynamic import for ES Modules
        if (!baileysModule) {
          baileysModule = await import('@whiskeysockets/baileys');
        }
        if (!qrcodeModule) {
          qrcodeModule = await import('qrcode-terminal');
        }

        const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileysModule;

        // Get appropriate auth directory
        const authDir = getAuthDir();
        console.log(`📁 Using auth directory: ${authDir}`);

        // Restore session from Redis to filesystem
        await restoreSessionFromRedis();

        // Initialize auth state
        const { state, saveCreds } = await useMultiFileAuthState(authDir);

        // Get latest Baileys version
        let { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📢 Using Baileys version: ${version.join('.')}, Latest: ${isLatest}`);

        // Create WASocket
        sock = makeWASocket({
          version,
          printQRInTerminal: true,
          auth: state,
        });

        // Handle connection updates
        const connectionHandler = async (update) => {
          const { connection, lastDisconnect } = update;

          if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`🔌 Connection closed: ${DisconnectReason[statusCode] || statusCode} (shouldReconnect: ${shouldReconnect})`);
            
            botStarted = false;
            
            if (shouldReconnect) {
              // Exponential backoff for reconnection
              await new Promise(resolve => setTimeout(resolve, 1000));
              await startConnection();
            } else {
              console.log('❌ Logged out, please scan QR code again');
              cleanup();
              reject(new Error('Logged out, please scan QR code again'));
            }
          } else if (connection === 'open') {
            console.log('✅ Bot connected to WhatsApp');
            botStarted = true;
            botInitializing = false;
            resolve(sock);
          }
        };

        sock.ev.on('connection.update', connectionHandler);

        // Save credentials when updated
        sock.ev.on('creds.update', async () => {
          console.log('💾 Saving credentials...');
          await saveCreds();
          // Also save to Redis
          await saveSessionToRedis();
        });

        // Handle incoming messages
        sock.ev.on('messages.upsert', async (msg) => {
          await handleMessages(msg);
        });
      } catch (error) {
        console.error('❌ Failed to start bot:', error.message);
        cleanup();
        reject(error);
      }
    };
    
    startConnection();
  });
  
  return connectionPromise;
}

/**
 * Handle incoming messages
 */
async function handleMessages(msg) {
  const messages = msg.messages || [];
  
  for (const m of messages) {
    if (!m.message || m.key.fromMe) continue;

    const remoteJid = m.key.remoteJid;
    const messageType = Object.keys(m.message)[0];
    const messageContent = m.message[messageType];

    console.log(`📨 Message from ${remoteJid}: ${messageType}`);
  }
}

/**
 * Format phone number to WhatsApp JID
 * @param {string} phone - Phone number
 * @returns {string} Formatted JID
 */
function formatJid(phone) {
  // Handle undefined or null
  if (!phone) {
    throw new Error('Phone number is required');
  }
  
  // Convert to string
  const phoneStr = String(phone);
  
  // If already contains @, return as is
  if (phoneStr.includes('@')) {
    return phoneStr;
  }
  
  // Remove any non-digit characters
  const cleaned = phoneStr.replace(/\D/g, '');
  
  // Add @s.whatsapp.net suffix for individual users
  return `${cleaned}@s.whatsapp.net`;
}

/**
 * Send a message
 */
async function sendMessage(jid, message, type = 'text') {
  // Initialize bot if not started
  if (!sock || !botStarted) {
    console.log('🔄 Bot not initialized, starting...');
    await startBot();
    
    // Wait for connection to be established (with timeout)
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout
    while (!botStarted && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
      console.log(`⏳ Waiting for bot connection... (${attempts}/${maxAttempts})`);
    }
    
    if (!botStarted) {
      throw new Error('Bot failed to connect within timeout period');
    }
  }

  try {
    // Format the JID properly
    const formattedJid = formatJid(jid);
    console.log(`📤 Sending message to ${formattedJid}...`);
    
    // Validate that the JID is properly formatted
    if (!formattedJid || !formattedJid.includes('@')) {
      throw new Error(`Invalid JID format: ${formattedJid}`);
    }
    
    const messageData = {};

    switch (type) {
      case 'text':
        messageData.text = message;
        break;
      case 'image':
        messageData.image = { url: message };
        break;
      case 'audio':
        messageData.audio = { url: message };
        break;
      case 'document':
        messageData.document = { url: message };
        break;
      default:
        messageData.text = String(message);
    }

    const result = await sock.sendMessage(formattedJid, messageData);
    console.log(`✅ Message sent to ${formattedJid}`);
    return result;
  } catch (error) {
    console.error(`❌ Failed to send message to ${jid}: ${error?.message || 'Unknown error'}`);
    // Provide more helpful error message
    if (error?.message?.includes('jidDecode')) {
      console.error('💡 The phone number may not be registered on WhatsApp, or the format is incorrect.');
    }
    throw error;
  }
}

/**
 * Get bot connection status
 */
function getBotStatus() {
  return {
    initialized: botStarted,
    connected: sock ? true : false,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Disconnect bot
 */
async function disconnectBot() {
  if (sock) {
    try {
      // Close WebSocket connection
      if (sock.ws) {
        sock.ws.close();
      }
      // Remove all event listeners
      sock.ev.removeAllListeners();
    } catch (e) {
      console.log('⚠️ Error during socket cleanup:', e.message);
    }
    sock = null;
    botStarted = false;
    botInitializing = false;
    connectionPromise = null;
    console.log('👋 Bot disconnected');
  }
}

module.exports = {
  startBot,
  sendMessage,
  getBotStatus,
  disconnectBot,
};
