import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import * as fs from 'fs';
import * as path from 'path';

// Load GEMINI_API_KEY from .env if not set in the process environment
if (!process.env.GEMINI_API_KEY) {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^\s*GEMINI_API_KEY\s*=\s*["']?([^#"']*)["']?/);
      if (match) {
        process.env.GEMINI_API_KEY = match[1].trim();
        break;
      }
    }
  }
}

export const ai = genkit({
  plugins: [googleAI()],
  promptDir: './prompts'
});

function isTransientError(error: any): boolean {
  if (!error) return false;
  
  // 1. Check network connection codes (including causes)
  const code = error.code || (error.cause && error.cause.code);
  const transientNetworkCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'];
  if (transientNetworkCodes.includes(code)) {
    return true;
  }
  
  // 2. Check fetch wrapper messages
  const message = error.message || '';
  if (message.includes('fetch failed') || message.includes('ECONNRESET') || message.includes('socket hang up')) {
    return true;
  }
  
  // 3. Check HTTP status codes
  const status = error.status || error.statusCode || (error.response && error.response.status);
  if (status === 429 || (status >= 500 && status < 600)) {
    return true;
  }
  
  return false;
}

export async function runWithRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0 || !isTransientError(error)) {
      throw error;
    }
    console.warn(`Transient API error encountered (${error.message || error}). Retrying in ${delay}ms... (${retries} attempts left)`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return runWithRetry(fn, retries - 1, delay * 2); // Exponential backoff
  }
}
