// Reset WhatsApp Session
// Clears both local filesystem and Redis sessions

require('dotenv').config();
const fs = require('fs');

async function resetSession() {
    console.log('🧹 Resetting WhatsApp session...\n');
    
    // 1. Clear local filesystem session (legacy)
    const localPath = './whatsapp-session';
    if (fs.existsSync(localPath)) {
        try {
            fs.rmSync(localPath, { recursive: true, force: true });
            console.log('✅ Local filesystem session cleared');
        } catch (error) {
            console.error('❌ Failed to clear local session:', error.message);
        }
    } else {
        console.log('ℹ️ No local session folder found');
    }
    
    // 2. Clear Redis session (current)
    try {
        const { clearAuthState } = require('./lib/baileys-redis-auth');
        const { redis } = require('./lib/redis');
        
        // Clear auth state
        await clearAuthState('main');
        
        // Also clear any old wa:session keys (legacy format)
        const oldSessionKeys = await redis.keys('wa:session:*');
        if (oldSessionKeys.length > 0) {
            await redis.del(oldSessionKeys);
            console.log(`✅ Cleared ${oldSessionKeys.length} legacy session keys from Redis`);
        }
        
        // Clear baileys auth keys
        const baileysKeys = await redis.keys('baileys:auth:*');
        if (baileysKeys.length > 0) {
            await redis.del(baileysKeys);
            console.log(`✅ Cleared ${baileysKeys.length} Baileys auth keys from Redis`);
        }
        
        console.log('\n🎉 Session reset complete!');
        console.log('📝 Next steps:');
        console.log('   1. Restart the bot');
        console.log('   2. Scan the new QR code at /qr endpoint');
        console.log('   3. Session will be saved to Redis automatically\n');
        
    } catch (error) {
        console.error('❌ Failed to clear Redis session:', error.message);
        console.log('\n⚠️ Make sure your Redis credentials are set in .env file:');
        console.log('   UPSTASH_REDIS_REST_URL=...');
        console.log('   UPSTASH_REDIS_REST_TOKEN=...\n');
    }
}

resetSession();
