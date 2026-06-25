import { Resend } from 'resend';

export const dependencies = {
  createResend: (apiKey) => new Resend(apiKey),
};

// Placeholder prefix used in default configuration files (.env)
const PLACEHOLDER_KEY_PREFIX = 're_xxxx';

// Maximum time (ms) to wait for the Resend API before aborting the request.
const SEND_TIMEOUT_MS = 10_000;

// Delay (ms) between retry attempts on transient failures.
const RETRY_DELAY_MS = 2_000;

// Total send attempts: 1 initial try + 1 retry.
const MAX_ATTEMPTS = 2;

// Helper to check if API key is a real/valid key
const isApiKeyValid = (key) => {
  return key && typeof key === 'string' && key.trim() !== '' && !key.startsWith(PLACEHOLDER_KEY_PREFIX);
};

/**
 * Sends an email using the Resend API with built-in retry and mock mode fallback.
 * Maps to "Channel-Specific Message Processing" in the System Design article.
 * 
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.subject - Email subject line
 * @param {string} params.html - HTML content body
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
export async function sendEmail({ to, subject, html, attachments = [] }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || 'onboarding@resend.dev';
  
  // Developer sandbox override: redirects all emails to one or more test inboxes if
  // defined. Accepts a single address or a comma-separated list (Resend `to` takes an
  // array of up to 50 recipients).
  const overrideRaw = process.env.NOTIFICATION_OVERRIDE_EMAIL;
  const overrideList = overrideRaw
    ? overrideRaw.split(',').map((e) => e.trim()).filter(Boolean)
    : [];
  const recipient = overrideList.length ? (overrideList.length === 1 ? overrideList[0] : overrideList) : to;

  if (overrideList.length) {
    console.log(`[EmailProcessor] Override active: Redirecting email target from ${to} to ${overrideList.join(', ')}`);
  }

  if (!isApiKeyValid(apiKey)) {
    // MOCK MODE FALLBACK
    // Allows local testing without needing a valid Resend API key.
    console.log('\n=================== MOCK EMAIL SENT ===================');
    console.log(`From:    ${fromEmail}`);
    console.log(`To:      ${recipient}`);
    console.log(`Subject: ${subject}`);
    if (attachments.length) console.log(`Attachments: ${attachments.map((a) => a.filename).join(', ')}`);
    console.log('------------------ Content Preview ------------------');
    // Simple text version from HTML
    console.log(html.replace(/<[^>]*>/g, ' ').substring(0, 300).trim() + '...');
    console.log('=======================================================\n');
    
    return {
      success: true,
      mock: true,
      messageId: `mock-msg-${Date.now()}`,
    };
  }

  // REAL MODE - Resend Integration
  const resend = dependencies.createResend(apiKey);
  
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Guard against hung network connections with an AbortController timeout.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

      const response = await resend.emails.send({
        from: fromEmail,
        to: recipient,
        subject,
        html,
        // Resend attachments: { filename, content (base64) }, plus content_id for inline cid: images.
        ...(attachments.length ? {
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            ...(a.contentId ? { content_id: a.contentId } : {}),
          })),
        } : {}),
        // Resend SDK passes unknown keys through to fetch; AbortSignal prevents hangs.
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.error) {
        throw new Error(response.error.message || JSON.stringify(response.error));
      }

      console.log(`[EmailProcessor] Email sent successfully to ${to} (Message ID: ${response.data.id})`);
      return {
        success: true,
        messageId: response.data.id
      };
    } catch (error) {
      lastError = error;
      console.error(`[EmailProcessor] Attempt ${attempt}/${MAX_ATTEMPTS} failed for ${to}: ${error.message}`);
      
      // If we have retries left, wait before retrying
      if (attempt < MAX_ATTEMPTS) {
        console.log(`[EmailProcessor] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  // All attempts exhausted — return a guaranteed failure result.
  return {
    success: false,
    error: lastError?.message || 'All send attempts failed'
  };
}

