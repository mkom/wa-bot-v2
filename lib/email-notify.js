// Email notification helper using nodemailer
const nodemailer = require('nodemailer');

/**
 * Create email transporter based on environment variables
 */
function createTransporter() {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT || 587;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (!smtpHost || !smtpUser || !smtpPass) {
        console.log('⚠️ Email not configured - SMTP credentials not set');
        return null;
    }

    return nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort),
        secure: smtpPort === 465, // true for 465, false for other ports
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });
}

/**
 * Send email notification
 * @param {string} subject - Email subject
 * @param {string} html - Email body (HTML)
 */
async function sendEmailNotification(subject, html) {
    const transporter = createTransporter();
    
    if (!transporter) {
        console.log('📧 Email notification skipped - not configured');
        return false;
    }

    const emailTo = process.env.EMAIL_TO || process.env.SMTP_USER;
    const fromEmail = process.env.SMTP_USER;

    try {
        const info = await transporter.sendMail({
            from: `"WhatsApp Bot" <${fromEmail}>`,
            to: emailTo,
            subject: subject,
            html: html,
        });

        console.log(`📧 Email sent: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error('❌ Failed to send email notification:', error.message);
        return false;
    }
}

/**
 * Send bot disconnected notification
 * @param {string} reason - Disconnection reason
 * @param {number} statusCode - Status code if available
 */
async function notifyBotDisconnected(reason, statusCode) {
    const subject = '⚠️ WhatsApp Bot Disconnected';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #dc3545;">WhatsApp Bot Disconnected</h2>
            <p>Bot telah terputus dari WhatsApp.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd;"><strong>Waktu</strong></td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd;"><strong>Status Code</strong></td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${statusCode || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd;"><strong>Alasan</strong></td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${reason || 'Unknown'}</td>
                </tr>
            </table>
            <p style="color: #666; font-size: 14px;">
                Bot akan mencoba reconnect secara otomatis dengan exponential backoff.
            </p>
        </div>
    `;

    return sendEmailNotification(subject, html);
}

/**
 * Send bot connected notification
 */
async function notifyBotConnected() {
    const subject = '✅ WhatsApp Bot Connected';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #28a745;">WhatsApp Bot Connected</h2>
            <p>Bot berhasil terhubung ke WhatsApp.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd;"><strong>Waktu</strong></td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td>
                </tr>
            </table>
        </div>
    `;

    return sendEmailNotification(subject, html);
}

module.exports = {
    sendEmailNotification,
    notifyBotDisconnected,
    notifyBotConnected,
    createTransporter,
};
