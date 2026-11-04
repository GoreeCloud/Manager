import { github } from "./github.js";
import { cloudflare } from "./cloudflare.js";
import { openai } from "./openai.js";
import { openrouter } from "./openrouter.js";
import { safeMessage, sourceResult } from "./http.js";

async function attempt(name, callback) {
  try {
    const data = await callback();
    return sourceResult(name, data, data === null ? "Not configured" : null);
  } catch (error) {
    return sourceResult(name, null, safeMessage(error));
  }
}

export async function overview(env, fetcher = fetch, nowMs = Date.now()) {
  const sources = await Promise.all([
    attempt("github", () => github(env, fetcher)),
    attempt("cloudflare", () => cloudflare(env, fetcher)),
    attempt("openai", () => openai(env, fetcher, nowMs)),
    attempt("openrouter", () => openrouter(env, fetcher)),
  ]);
  return { generatedAt: new Date(nowMs).toISOString(), readOnly: true, sources };
}
