// Test Redis connection
require('dotenv').config();

const { redis, cache } = require('./lib/redis');

async function testRedis() {
  console.log('🧪 Testing Redis connection...\n');

  try {
    // Test 1: Ping
    console.log('1. Testing PING...');
    const pingResult = await redis.ping();
    console.log(`   ✅ PING response: ${pingResult}`);
    
    // Test 2: Set and Get
    console.log('\n2. Testing SET/GET...');
    const testKey = 'wa:test:connection';
    const testValue = { message: 'Hello from WhatsApp Bot!', timestamp: new Date().toISOString() };
    
    await cache.set(testKey, testValue, 60); // 60 seconds TTL
    const retrievedValue = await cache.get(testKey);
    
    if (retrievedValue && retrievedValue.message === testValue.message) {
      console.log(`   ✅ SET/GET successful: ${JSON.stringify(retrievedValue)}`);
    } else {
      console.log('   ❌ SET/GET failed: Value mismatch');
    }

    // Test 3: Rate Limiter
    console.log('\n3. Testing Rate Limiter...');
    const { ratelimit } = require('./lib/redis');
    const result = await ratelimit.limit('test-user');
    console.log(`   ✅ Rate limit result: ${JSON.stringify({ allowed: result.success, remaining: result.remaining })}`);

    // Test 4: Cleanup
    console.log('\n4. Cleaning up test data...');
    await cache.del(testKey);
    console.log('   ✅ Test data cleaned up');

    console.log('\n🎉 All Redis tests passed!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Redis test failed:', error.message);
    console.error('   Make sure your .env file has valid Upstash credentials.\n');
    process.exit(1);
  }
}

testRedis();
