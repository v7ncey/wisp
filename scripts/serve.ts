// Local dev server: serves public/ and routes /api/coach to the same handler Vercel runs.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleCoach } from "../src/server/handler";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const PORT = Number(process.env.PORT ?? 5178);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".zip": "application/zip",
  ".json": "application/json",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/api/coach") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await handleCoach(
      new Request(url, { method: req.method, headers: req.headers as HeadersInit, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }),
      { GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? process.env.GEMINI_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL },
    );
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const rel = normalize(url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  if (rel.startsWith("..")) return void res.writeHead(400).end();
  try {
    const body = await readFile(join(PUBLIC, rel));
    res.writeHead(200, { "content-type": TYPES[extname(rel)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, () => console.log(`Wisp demo on http://localhost:${PORT}`));
