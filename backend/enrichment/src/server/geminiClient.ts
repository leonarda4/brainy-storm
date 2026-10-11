/**
 * Shared GoogleGenAI Client instance configured for server-side execution.
 */
import './environment.js';
import { GoogleGenAI } from '@google/genai';

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

if (!process.env.GEMINI_API_KEY) {
  console.warn(
    '[GeminiClient] WARNING: GEMINI_API_KEY environment variable is not defined. Ensure it is configured in your environment or Secrets.'
  );
}

export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});
