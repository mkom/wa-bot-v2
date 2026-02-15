// Polyfill crypto untuk Node.js 18/20
if (typeof global.crypto === 'undefined') {
    global.crypto = require('crypto');
}

require('dotenv').config();
const express = require('express');
const cors = require('cors');

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
        printQRInTerminal: true,
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
            qrcode.generate(qr, { small: true });
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
