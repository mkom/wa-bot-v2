// Migrate local WhatsApp session to Redis
// Run this after authenticating locally to save session to Redis

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { saveSession } = require('./lib/session');

const AUTH_DIR = './whatsapp-session';
const SESSION_ID = 'main';

async function migrateSession() {
  console.log('🔄 Migrating WhatsApp session to Redis...\n');

  // Check if local session exists
  if (!fs.existsSync(AUTH_DIR)) {
    console.log('❌ Local session directory not found:', AUTH_DIR);
    console.log('Please run "npm run dev" and scan QR code first.');
    return;
  }

  // Read all session files
  const files = fs.readdirSync(AUTH_DIR);
  console.log(`📁 Found ${files.length} session files in ${AUTH_DIR}`);

  if (files.length === 0) {
    console.log('❌ No session files found. Please authenticate first.');
    return;
  }

  // Read all files and create session object
  const sessionData = {};
  for (const file of files) {
    const filePath = path.join(AUTH_DIR, file);
    const fileContent = fs.readFileSync(filePath, 'utf-8');

    try {
      // Parse JSON if it's a JSON file
      sessionData[file] = JSON.parse(fileContent);
      console.log(`✅ Read: ${file}`);
    } catch (error) {
      // Store as string if not JSON
      sessionData[file] = fileContent;
      console.log(`✅ Read: ${file} (text)`);
    }
  }

  // Save entire session object to Redis
  console.log('\n💾 Saving session to Redis...');
  const success = await saveSession(SESSION_ID, sessionData);

  if (success) {
    console.log(`\n🎉 Successfully migrated ${files.length} session files to Redis!`);
    console.log('\n📝 Next steps:');
    console.log('1. Deploy to Vercel: vercel --prod');
    console.log('2. The bot will restore session from Redis automatically');
    console.log('3. No need to scan QR code on Vercel!\n');
  } else {
    console.log('\n❌ Failed to save session to Redis');
  }
}

migrateSession().catch(console.error);
