/**
 * Central config. Read from env with safe defaults so the app and the local
 * scripts share one source of truth. Embedding model + dimension MUST match
 * between ingest and query, or retrieval silently returns garbage.
 */

export const VOYAGE_MODEL = process.env.VOYAGE_MODEL ?? "voyage-3.5-lite";
export const EMBED_DIM = Number(process.env.EMBED_DIM ?? 1024);

// Haiku 4.5 is cheap and current, and grounded RAG answers are short. Swap to
// claude-sonnet-5 (or claude-opus-5) via env for higher quality. IDs carry no
// date suffix.
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";

export const RELEVANCE_FLOOR = Number(process.env.RELEVANCE_FLOOR ?? 0.3);
export const MATCH_COUNT = Number(process.env.MATCH_COUNT ?? 6);
export const MAX_QUESTION_CHARS = Number(process.env.MAX_QUESTION_CHARS ?? 400);

// Per-user (per-IP) daily spend cap for the public demo, in USD. Best-effort,
// in-memory; the real backstop is the account-level cap in the API dashboards.
export const USER_SPEND_CAP_USD = Number(process.env.USER_SPEND_CAP_USD ?? 1);

// Generation pricing per 1M tokens [input, output], for the cost estimate.
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5": [2, 10],
  "claude-opus-5": [5, 25],
};
export const [INPUT_USD_PER_MTOK, OUTPUT_USD_PER_MTOK] =
  PRICES[ANTHROPIC_MODEL] ?? [1, 5];
