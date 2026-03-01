// Polyfill crypto untuk Node.js 18/20
if (typeof global.crypto === 'undefined') {
    global.crypto = require('crypto');
}

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());

// Konfigurasi CORS
const corsOptions = {
    origin: ['https://rt5vc.vercel.app', 'http://localhost:3000'],
    methods: 'GET, POST, PUT, DELETE, OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
};
app.use(cors(corsOptions));

let sock;
let currentQR = null;
let reconnectAttempts = 0;
let reconnectTimer = null;

/**
 * Get the appropriate auth directory (legacy, kept for compatibility)
 * Uses Redis auth state adapter instead
 */
function getAuthDir() {
  return './whatsapp-session';
}

/**
 * Cleanup socket resources
 */
function cleanupSocket() {
    if (sock) {
        try {
            sock.ws?.close();
            sock.ev?.removeAllListeners();
        } catch (e) {
            // Ignore cleanup errors
        }
        sock = null;
    }
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

// **Fungsi untuk memulai bot dengan sesi Redis**
async function startBot() {
    console.log("🔄 Memulai WhatsApp bot...");

    // Dynamic import untuk Baileys (ES Module)
    const { makeWASocket, fetchLatestBaileysVersion, DisconnectReason } = await import("@whiskeysockets/baileys");
    const qrcode = (await import('qrcode-terminal')).default;
    const { Boom } = await import('@hapi/boom');

    // Import Redis auth adapter
    const { useRedisAuthState, clearAuthState } = require('./lib/baileys-redis-auth');

    // **Inisialisasi sesi dari Redis**
    console.log('📡 Loading auth state from Redis...');
    const { state, saveCreds } = await useRedisAuthState('main');

    let { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📢 Menggunakan versi Baileys: ${version.join('.')}, Terbaru: ${isLatest}`);

    // Cleanup existing socket if any
    cleanupSocket();

    sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: state,
        // Add keep-alive settings
        keepAliveIntervalMs: 30000,
        // Browser info
        browser: ['Ubuntu', 'Chrome', '22.04.4'],
    });

    // Simpan sesi ketika diperbarui - langsung ke Redis
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (msg) => {
        const m = msg.messages[0];
    
        if (!m.message || m.key.fromMe) return; // Abaikan pesan kosong & pesan dari bot sendiri
    
        const sender = m.key.remoteJid;
        const messageText = m.message.conversation || m.message.extendedTextMessage?.text || '';
    
        // **Tes Balasan Otomatis**
        if (messageText.toLowerCase() === 'halo') {
            await sock.sendMessage(sender, { text: 'Halo! Saya bot WhatsApp Anda. 🚀' });
        } else if (messageText.toLowerCase() === 'test') {
            await sock.sendMessage(sender, { text: '✅ Bot aktif dan siap digunakan!' });
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("\n📸 QR Code ditemukan — silakan scan:");
            currentQR = qr;
            // Try to generate terminal QR (works sometimes)
            try {
                qrcode.generate(qr, { small: true });
            } catch(e) {
                console.log("📸 QR Code tersedia di endpoint /qr");
            }
        }

        if (connection === 'open') {
            console.log('✅ Bot berhasil terhubung ke WhatsApp');
            reconnectAttempts = 0; // Reset reconnect counter on successful connection
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const reason = lastDisconnect?.error?.message || 'Unknown';
            
            console.log(`⚠️ Koneksi terputus, code: ${statusCode}, reason: ${reason}`);

            // Handle logged out - clear session and don't reconnect
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log("🚫 Session invalid (logged out), menghapus session...");
                await clearAuthState('main');
                currentQR = null;
                reconnectAttempts = 0;
                
                // Wait a bit then restart to get new QR
                console.log("🔄 Restarting for new QR code scan...");
                reconnectTimer = setTimeout(() => startBot(), 3000);
                return;
            }

            // Handle bad session
            if (statusCode === DisconnectReason.badSession) {
                console.log("🚫 Bad session, clearing and reconnecting...");
                await clearAuthState('main');
                reconnectAttempts = 0;
                reconnectTimer = setTimeout(() => startBot(), 3000);
                return;
            }

            // Handle restart required
            if (statusCode === DisconnectReason.restartRequired) {
                console.log("🔄 Restart required, reconnecting...");
                reconnectAttempts = 0;
                reconnectTimer = setTimeout(() => startBot(), 2000);
                return;
            }

            // For other disconnects, use exponential backoff
            reconnectAttempts++;
            const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
            
            console.log(`🔁 Reconnecting in ${backoffMs}ms (attempt ${reconnectAttempts})...`);
            
            reconnectTimer = setTimeout(async () => {
                try {
                    await startBot();
                } catch (error) {
                    console.error('❌ Reconnect failed:', error.message);
                }
            }, backoffMs);
        }
    });

}

// Jalankan bot
startBot();

// **API Endpoint untuk Cek Status Bot**
app.get('/status', (req, res) => {
    if (!sock) {
        console.log(`🤖 Bot disconnected`);
        return res.json({ status: 'disconnected' });
    }

    const isConnected = sock.user ? true : false;
    console.log(`🤖 Bot ${isConnected ? 'connected' : 'connecting'}`);
    res.json({ 
        status: isConnected ? 'connected' : 'connecting',
        user: sock.user ? sock.user.id : null,
        reconnectAttempts: reconnectAttempts
    });
});

// **QR Code Endpoint - Untuk discan di browser**
app.get('/qr', async (req, res) => {
    if (!currentQR) {
        return res.send(`
            <html>
                <head><title>WA Bot QR Code</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
                <body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0f0f0;font-family:Arial,sans-serif;">
                    <div style="text-align:center;background:white;padding:20px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
                        <h2>QR Code belum tersedia</h2>
                        <p>Bot sedang memulai, silakan tunggu beberapa detik atau refresh halaman ini.</p>
                        <p>Status reconnect: ${reconnectAttempts} attempts</p>
                        <button onclick="location.reload()" style="padding:10px 20px;margin-top:10px;cursor:pointer;">Refresh</button>
                    </div>
                </body>
            </html>
        `);
    }
    
    try {
        const qrImage = await QRCode.toDataURL(currentQR);
        res.send(`
            <html>
                <head>
                    <title>WA Bot QR Code</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <meta http-equiv="refresh" content="30">
                </head>
                <body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0f0f0;font-family:Arial,sans-serif;">
                    <div style="text-align:center;background:white;padding:20px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
                        <h2>Scan QR ini dengan WhatsApp</h2>
                        <p>Buka WhatsApp > Linked Devices > Link a Device</p>
                        <img src="${qrImage}" alt="QR Code" style="width:300px;height:300px;">
                        <p style="font-size:12px;color:#666;margin-top:10px;">Halaman refresh otomatis setiap 30 detik</p>
                    </div>
                </body>
            </html>
        `);
    } catch (error) {
        res.status(500).send('Error generating QR: ' + error.message);
    }
});


app.post('/api/notify', async (req, res) => {
    const { number, bodyMessage } = req.body;

    // Pastikan socket sudah siap sebelum mengirim pesan
    if (!sock || !sock.user) {
        return res.status(500).json({ success: false, message: "Bot belum terhubung ke WhatsApp" });
    }

    // Format nomor agar sesuai dengan format internasional
    const formattedNumber = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;

    try {
        await sock.sendMessage(formattedNumber, { text: bodyMessage });
        res.json({ success: true, message: `Pesan berhasil dikirim ke ${number}` });
    } catch (error) {
        console.error("❌ Error mengirim pesan:", error);
        res.status(500).json({ success: false, message: "Gagal mengirim pesan", error: error.message });
    }

});

// Jalankan server Express
const PORT = process.env.PORT || 8888;

// Health check route for Koyeb / Vercel
app.get('/api', (req, res) => {
    res.json({ 
        status: 'ok', 
        bot: sock?.user ? 'connected' : (sock ? 'connecting' : 'disconnected'),
        timestamp: new Date().toISOString(),
        reconnectAttempts: reconnectAttempts
    });
});

// Clear session endpoint (for manual reset)
app.post('/api/clear-session', async (req, res) => {
    try {
        const { clearAuthState } = require('./lib/baileys-redis-auth');
        await clearAuthState('main');
        currentQR = null;
        reconnectAttempts = 0;
        cleanupSocket();
        
        // Restart bot after clearing
        setTimeout(() => startBot(), 1000);
        
        res.json({ success: true, message: 'Session cleared, bot restarting...' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan di port ${PORT}`);
    console.log(`📍 Status: http://localhost:${PORT}/status`);
    console.log(`📍 QR Code: http://localhost:${PORT}/qr`);
    console.log(`📍 API: http://localhost:${PORT}/api`);
});
