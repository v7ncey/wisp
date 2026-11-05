import { handleCoach } from "../src/server/handler.js";

// Vercel Node function using the Web Request/Response API.
const env = () => ({ GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? process.env.GEMINI_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL });

export function POST(req: Request) {
  return handleCoach(req, env());
}

export function OPTIONS(req: Request) {
  return handleCoach(req, env());
}
