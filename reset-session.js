const fs = require('fs');
const path = './whatsapp-session';
if (fs.existsSync(path)) {
  fs.rmSync(path, { recursive: true, force: true });
  console.log('Sesi WhatsApp dihapus. Silakan jalankan ulang bot dan scan QR code baru.');
} else {
  console.log('Folder sesi tidak ditemukan.');
}