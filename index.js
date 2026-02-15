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

/**
 * Get the appropriate auth directory
 * Uses local dir for persistent storage on VPS
 */
function getAuthDir() {
  return './whatsapp-session';
}

// **Fungsi untuk memulai bot dengan sesi lokal**
async function startBot() {
    console.log("🔄 Memulai WhatsApp bot...");

    // Dynamic import untuk Baileys (ES Module)
    const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = await import("@whiskeysockets/baileys");
    const qrcode = (await import('qrcode-terminal')).default;

    // Get the appropriate auth directory
    const authDir = getAuthDir();
    console.log(`📁 Using auth directory: ${authDir}`);

    // **Inisialisasi sesi lokal dengan MultiFileAuthState**
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    let { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📢 Menggunakan versi Baileys: ${version.join('.')}, Terbaru: ${isLatest}`);

    sock = makeWASocket({
        version,
        printQRInTerminal: false, // Deprecated, handle QR manually below
        auth: state
    });

    // Simpan sesi ketika diperbarui
    sock.ev.on('creds.update', async () => {
        console.log("✅ Menyimpan sesi lokal...");
        await saveCreds();
    });

    sock.ev.on('messages.upsert', async (msg) => {
        const m = msg.messages[0];
    
        if (!m.message || m.key.fromMe) return; // Abaikan pesan kosong & pesan dari bot sendiri
    
        const sender = m.key.remoteJid;
        const messageText = m.message.conversation || m.message.extendedTextMessage?.text || '';
    
        //console.log(`📩 Pesan diterima dari ${sender}: ${messageText}`);
    
        // **Tes Balasan Otomatis**
        if (messageText.toLowerCase() === 'halo') {
            await sock.sendMessage(sender, { text: 'Halo! Saya bot WhatsApp Anda. 🚀' });
        } else if (messageText.toLowerCase() === 'test') {
            await sock.sendMessage(sender, { text: '✅ Bot aktif dan siap digunakan!' });
        } else {
            //await sock.sendMessage(sender, { text: `Kamu mengirim: "${messageText}". Saya masih belajar! 🤖` });
        }
    });

    const { Boom } = await import('@hapi/boom');

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
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log("⚠️ Koneksi terputus, code:", statusCode);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log("🚫 Session invalid, menghapus session & scan ulang QR");
                const fs = require('fs');
                fs.rmSync('./whatsapp-session', { recursive: true, force: true });
            }

            console.log("🔁 Reconnecting...");
            await startBot();
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

    console.log(`🤖 Bot connected`);
    res.json({ status: 'connected' });
});

// **QR Code Endpoint - Untuk discan di browser**
app.get('/qr', async (req, res) => {
    if (!currentQR) {
        return res.send('<h1>QR Code belum tersedia</h1><p>Tunggu sebentar atau restart bot untuk mendapatkan QR baru.</p>');
    }
    
    try {
        const qrImage = await QRCode.toDataURL(currentQR);
        res.send(`
            <html>
                <head>
                    <title>WA Bot QR Code</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                </head>
                <body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0f0f0;font-family:Arial,sans-serif;">
                    <div style="text-align:center;background:white;padding:20px;border-radius:10px;box-shadow:0 2px10px rgba(0,0,0,0.1);">
                        <h2>Scan QR ini dengan WhatsApp</h2>
                        <p>Buka WhatsApp > Linked Devices > Link a Device</p>
                        <img src="${qrImage}" alt="QR Code" style="width:300px;height:300px;">
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
    if (!sock) {
        return res.status(500).json({ success: false, message: "Bot belum terhubung ke WhatsApp" });
    }

    // Format nomor agar sesuai dengan format internasional
    const formattedNumber = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;

    try {
        await sock.sendMessage(formattedNumber, { text: bodyMessage });
        res.json({ success: true, message: `Pesan berhasil dikirim ke ${number}` });
    } catch (error) {
        console.error("❌ Error mengirim pesan:", error);
        res.status(500).json({ success: false, message: "Gagal mengirim pesan", error });
    }

});

// Jalankan server Express
const PORT = process.env.PORT || 8888;

// Health check route for Koyeb / Vercel
app.get('/api', (req, res) => {
    res.json({ 
        status: 'ok', 
        bot: sock ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan di port ${PORT}`);
});
