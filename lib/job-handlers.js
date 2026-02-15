// Job Handlers for WhatsApp Bot Queue System
// Each handler processes a specific job type

const { sendMessage: botSendMessage, startBot, disconnectBot } = require('../api/bot');
const { updateJobStatus } = require('./queue');

/**
 * Handle SEND_MESSAGE job
 * Sends a single message to a WhatsApp number
 */
async function handleSendMessage(job) {
  const { to, message, type = 'text' } = job.payload;
  
  try {
    console.log(`📤 Sending message to ${to}...`);
    
    // Initialize bot (connects using Redis session)
    await startBot();
    
    // Wait for bot to be fully connected before sending
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Send message
    const result = await botSendMessage(to, message, type);
    
    // Disconnect immediately after sending
    await disconnectBot();
    
    console.log(`✅ Message sent successfully to ${to}`);
    
    return {
      success: true,
      messageId: result?.key?.id,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`❌ Failed to send message to ${to}:`, error.message);
    
    // Ensure disconnect even on error
    try {
      await disconnectBot();
    } catch (disconnectError) {
      console.error('Error during disconnect:', disconnectError.message);
    }
    
    throw error;
  }
}

/**
 * Handle BROADCAST job
 * Sends a message to multiple recipients
 */
async function handleBroadcast(job) {
  const { recipients, message, type = 'text', delay = 1000 } = job.payload;
  
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('Recipients must be a non-empty array');
  }
  
  const results = [];
  const errors = [];
  
  try {
    console.log(`📢 Broadcasting to ${recipients.length} recipients...`);
    
    // Initialize bot once for all messages
    await startBot();
    
    // Send to each recipient with delay
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      
      try {
        console.log(`📤 [${i + 1}/${recipients.length}] Sending to ${recipient}...`);
        
        const result = await botSendMessage(recipient, message, type);
        
        results.push({
          recipient,
          success: true,
          messageId: result?.key?.id,
        });
        
        // Add delay between messages to avoid rate limiting
        if (i < recipients.length - 1 && delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        console.error(`❌ Failed to send to ${recipient}:`, error.message);
        errors.push({
          recipient,
          error: error.message,
        });
        results.push({
          recipient,
          success: false,
          error: error.message,
        });
      }
    }
    
    // Disconnect after all messages sent
    await disconnectBot();
    
    console.log(`✅ Broadcast completed: ${results.filter(r => r.success).length}/${recipients.length} successful`);
    
    return {
      success: true,
      total: recipients.length,
      successful: results.filter(r => r.success).length,
      failed: errors.length,
      results,
      errors,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`❌ Broadcast failed:`, error.message);
    
    // Ensure disconnect even on error
    try {
      await disconnectBot();
    } catch (disconnectError) {
      console.error('Error during disconnect:', disconnectError.message);
    }
    
    throw error;
  }
}

/**
 * Handle SCHEDULED_MESSAGE job
 * Sends a message at a specific time (already scheduled by queue)
 */
async function handleScheduledMessage(job) {
  const { to, message, type = 'text', scheduledFor } = job.payload;
  
  try {
    console.log(`⏰ Sending scheduled message to ${to} (scheduled for ${scheduledFor})...`);
    
    // Initialize bot
    await startBot();
    
    // Send message
    const result = await botSendMessage(to, message, type);
    
    // Disconnect immediately
    await disconnectBot();
    
    console.log(`✅ Scheduled message sent successfully to ${to}`);
    
    return {
      success: true,
      messageId: result?.key?.id,
      scheduledFor,
      sentAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`❌ Failed to send scheduled message to ${to}:`, error.message);
    
    // Ensure disconnect even on error
    try {
      await disconnectBot();
    } catch (disconnectError) {
      console.error('Error during disconnect:', disconnectError.message);
    }
    
    throw error;
  }
}

/**
 * Handle CUSTOM job
 * Executes custom logic defined in the job payload
 */
async function handleCustom(job) {
  const { handler, data } = job.payload;
  
  try {
    console.log(`🔧 Executing custom handler: ${handler}...`);
    
    // Initialize bot if needed
    await startBot();
    
    // Execute custom handler (should be a function name or identifier)
    // This is a placeholder - implement based on your custom needs
    let result;
    
    switch (handler) {
      case 'check_status':
        result = { status: 'active', timestamp: new Date().toISOString() };
        break;
      case 'get_contacts':
        // Example: Get contacts from bot
        result = { contacts: [], timestamp: new Date().toISOString() };
        break;
      default:
        throw new Error(`Unknown custom handler: ${handler}`);
    }
    
    // Disconnect
    await disconnectBot();
    
    console.log(`✅ Custom handler ${handler} executed successfully`);
    
    return {
      success: true,
      handler,
      result,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`❌ Custom handler failed:`, error.message);
    
    // Ensure disconnect even on error
    try {
      await disconnectBot();
    } catch (disconnectError) {
      console.error('Error during disconnect:', disconnectError.message);
    }
    
    throw error;
  }
}

/**
 * Main job processor
 * Routes jobs to appropriate handlers
 */
async function processJob(job) {
  const { id, type } = job;
  
  console.log(`🔄 Processing job ${id} (${type})...`);
  
  let result;
  
  try {
    switch (type) {
      case 'send_message':
        result = await handleSendMessage(job);
        break;
      case 'broadcast':
        result = await handleBroadcast(job);
        break;
      case 'scheduled_message':
        result = await handleScheduledMessage(job);
        break;
      case 'custom':
        result = await handleCustom(job);
        break;
      default:
        throw new Error(`Unknown job type: ${type}`);
    }
    
    // Update job status to completed
    await updateJobStatus(id, 'completed', result);
    
    console.log(`✅ Job ${id} completed successfully`);
    return result;
  } catch (error) {
    console.error(`❌ Job ${id} failed:`, error.message);
    
    // Update job status to failed
    await updateJobStatus(id, 'failed', { error: error.message });
    
    throw error;
  }
}

/**
 * Process multiple jobs (batch processing)
 */
async function processJobs(jobs) {
  const results = [];
  
  for (const job of jobs) {
    try {
      const result = await processJob(job);
      results.push({
        jobId: job.id,
        success: true,
        result,
      });
    } catch (error) {
      results.push({
        jobId: job.id,
        success: false,
        error: error.message,
      });
    }
  }
  
  return results;
}

module.exports = {
  handleSendMessage,
  handleBroadcast,
  handleScheduledMessage,
  handleCustom,
  processJob,
  processJobs,
};
