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
