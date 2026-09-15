/**
 * Central config. Read from env with safe defaults so the app and the local
 * scripts share one source of truth. Embedding model + dimension MUST match
 * between ingest and query, or retrieval silently returns garbage.
 */

export const VOYAGE_MODEL = process.env.VOYAGE_MODEL ?? "voyage-3.5-lite";
export const EMBED_DIM = Number(process.env.EMBED_DIM ?? 1024);

export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

export const RELEVANCE_FLOOR = Number(process.env.RELEVANCE_FLOOR ?? 0.3);
export const MATCH_COUNT = Number(process.env.MATCH_COUNT ?? 6);
export const MAX_QUESTION_CHARS = Number(process.env.MAX_QUESTION_CHARS ?? 400);

/** The six WSC subject areas, used for the optional retrieval filter. */
export const SUBJECTS = [
  "Science & Technology",
  "Social Studies",
  "History",
  "Art & Music",
  "Literature & Media",
  "Special Area",
] as const;
export type Subject = (typeof SUBJECTS)[number];
