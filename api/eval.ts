import { handleEval } from "../src/server/eval-handler.js";

// Token-protected; see src/server/eval-handler.ts. Returns 404 unless WISP_EVAL_TOKEN is set and sent.
const env = () => ({
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? process.env.GEMINI_KEY,
  WISP_EVAL_TOKEN: process.env.WISP_EVAL_TOKEN,
});

export const maxDuration = 60;

export function POST(req: Request) {
  return handleEval(req, env());
}

export function GET(req: Request) {
  return handleEval(req, env());
}
