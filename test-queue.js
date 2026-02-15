// Test script for queue system
// Run with: node test-queue.js

require('dotenv').config();
const { enqueueJob, getJobStatus, getQueueStats } = require('./lib/queue');

async function testQueue() {
  console.log('🧪 Testing Queue System...\n');

  try {
    // Test 1: Enqueue a job
    console.log('Test 1: Enqueueing a job...');
    const jobId = await enqueueJob('send', {
      phone: '6281234567890',
      message: 'Test message from queue',
    }, 1);
    console.log(`✅ Job enqueued: ${jobId}\n`);

    // Test 2: Get job status
    console.log('Test 2: Getting job status...');
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait a bit
    const status = await getJobStatus(jobId);
    console.log(`✅ Job status:`, status, '\n');

    // Test 3: Get queue stats
    console.log('Test 3: Getting queue stats...');
    const stats = await getQueueStats();
    console.log(`✅ Queue stats:`, stats, '\n');

    console.log('🎉 All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testQueue();
