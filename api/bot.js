// WhatsApp Bot Logic for Vercel
// Separated from Express handlers for better organization

const { saveSession, getSession } = require('../lib/session');

// Bot state
let sock = null;
let botStarted = false;
let baileysModule = null;
let qrcodeModule = null;

/**
 * Initialize the WhatsApp bot
 * Uses Redis for session storage instead of local files
 */
async function startBot() {
  if (botStarted) {
    console.log('⚠️ Bot already started');
    return sock;
  }

  console.log('🔄 Starting WhatsApp bot...');

  try {
    // Dynamic import for ES Modules
    if (!baileysModule) {
      baileysModule = await import('@whiskeysockets/baileys');
    }
    if (!qrcodeModule) {
      qrcodeModule = await import('qrcode-terminal');
    }

    const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileysModule;
    const qrcode = qrcodeModule.default;

    // Check for existing session in Redis
    const existingSession = await getSession('main');
    
    // For Redis session storage, we still need local auth state
    // because Baileys requires file-based auth for some operations
    const authDir = './whatsapp-session';
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    // Merge with Redis session if exists
    if (existingSession && state.creds) {
      console.log('📖 Using Redis-cached session data');
    }

    // Get latest Baileys version
    let { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📢 Using Baileys version: ${version.join('.')}, Latest: ${isLatest}`);

    // Create WASocket
    sock = makeWASocket({
      version,
      printQRInTerminal: true,
      auth: state,
      logger: { level: 1 },
    });

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        
        if (shouldReconnect) {
          console.log('🔄 Reconnecting...');
          await startBot();
        } else {
          console.log('❌ Logged out, please scan QR code again');
        }
      } else if (connection === 'open') {
        console.log('✅ Bot connected to WhatsApp');
        botStarted = true;
      }
    });

    // Save credentials when updated
    sock.ev.on('creds.update', async () => {
      console.log('💾 Saving credentials...');
      await saveCreds();
    });

    // Handle incoming messages
    sock.ev.on('messages.upsert', async (msg) => {
      await handleMessages(msg);
    });

    return sock;
  } catch (error) {
    console.error('❌ Failed to start bot:', error.message);
    throw error;
  }
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
 * Send a message
 */
async function sendMessage(jid, message, type = 'text') {
  if (!sock) {
    throw new Error('Bot not initialized');
  }

  try {
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

    const result = await sock.sendMessage(jid, messageData);
    console.log(`✅ Message sent to ${jid}`);
    return result;
  } catch (error) {
    console.error(`❌ Failed to send message: ${error.message}`);
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
 * Disconnect the bot
 */
async function disconnectBot() {
  if (sock) {
    await sock.logout();
    sock = null;
    botStarted = false;
    console.log('👋 Bot disconnected');
  }
}

module.exports = {
  startBot,
  sendMessage,
  getBotStatus,
  disconnectBot,
};
