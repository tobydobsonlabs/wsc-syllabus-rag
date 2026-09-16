import { embedQuery } from "./voyage";
import { serviceClient, type MatchedChunk } from "./supabase";
import { buildPrompt, REFUSAL_TEXT } from "./prompt";
import { generateAnswer } from "./anthropic";
import {
  RELEVANCE_FLOOR,
  MATCH_COUNT,
  MAX_QUESTION_CHARS,
  INPUT_USD_PER_MTOK,
  OUTPUT_USD_PER_MTOK,
} from "./config";
import type { Source } from "./types";

export type { Source };

export interface RagResult {
  grounded: boolean;
  answer: string;
  sources: Source[];
  topSimilarity: number;
  floor: number;
  /** Estimated generation cost in USD, for the per-user spend cap. */
  costUsd: number;
  /** All retrieved chunks (top-K), for eval recall scoring. Ignored by the UI. */
  retrieved: { breadcrumb: string; source_path: string; similarity: number }[];
}

/** Estimated generation cost in USD from token usage, for the per-user spend cap. */
export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1e6) * INPUT_USD_PER_MTOK +
    (outputTokens / 1e6) * OUTPUT_USD_PER_MTOK
  );
}

/** Pull the [n] citations the model actually used, in order, deduped. */
function citedIndexes(answer: string, max: number): number[] {
  const found = new Set<number>();
  for (const m of answer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= max) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

/** Embed the question and retrieve the top-K chunks by cosine similarity. */
export async function retrieveChunks(question: string): Promise<{
  matches: MatchedChunk[];
  topSimilarity: number;
  retrieved: RagResult["retrieved"];
}> {
  const embedding = await embedQuery(question);
  const sb = serviceClient();
  // The DB function keeps an optional subject_filter (see sql/schema.sql); the UI
  // no longer scopes by subject, so we always search the whole corpus (null).
  const { data, error } = await sb.rpc("match_chunks", {
    query_embedding: embedding,
    match_count: MATCH_COUNT,
    subject_filter: null,
  });
  if (error) throw new Error(`match_chunks failed: ${error.message}`);

  const matches = (data ?? []) as MatchedChunk[];
  const topSimilarity = matches[0]?.similarity ?? 0;
  const retrieved = matches.map((m) => ({
    breadcrumb: m.breadcrumb,
    source_path: m.source_path,
    similarity: m.similarity,
  }));
  return { matches, topSimilarity, retrieved };
}

/** Map the [n] citations in an answer to Source cards (falls back to the top 3). */
export function buildSources(answer: string, matches: MatchedChunk[]): Source[] {
  const cited = citedIndexes(answer, matches.length);
  const chosen = cited.length ? cited : [1, 2, 3].slice(0, matches.length);
  return chosen.map((n) => {
    const m = matches[n - 1];
    return {
      n,
      breadcrumb: m.breadcrumb,
      source_path: m.source_path,
      source_url: m.source_url,
      subjects: m.subjects,
      section_no: m.section_no,
      chunk_kind: m.chunk_kind,
      similarity: m.similarity,
    };
  });
}

/**
 * Non-streaming query path (used by the eval + query scripts): embed -> retrieve
 * -> relevance floor (retrieve-or-refuse) -> grounded generation -> answer + the
 * sources actually cited. The live app streams instead, via app/api/ask, which
 * shares retrieveChunks() and buildSources().
 */
export async function answerQuestion(rawQuestion: string): Promise<RagResult> {
  const question = rawQuestion.trim().slice(0, MAX_QUESTION_CHARS);
  const { matches, topSimilarity, retrieved } = await retrieveChunks(question);

  // Retrieve-or-refuse: nothing close enough, so we do not answer (no model call).
  if (matches.length === 0 || topSimilarity < RELEVANCE_FLOOR) {
    return { grounded: false, answer: REFUSAL_TEXT, sources: [], topSimilarity, floor: RELEVANCE_FLOOR, costUsd: 0, retrieved };
  }

  const { system, user } = buildPrompt(question, matches);
  const gen = await generateAnswer(system, user);
  const costUsd = estimateCost(gen.inputTokens, gen.outputTokens);

  // The model may itself refuse if the sources don't actually answer it.
  if (gen.text.trim() === REFUSAL_TEXT) {
    return { grounded: false, answer: REFUSAL_TEXT, sources: [], topSimilarity, floor: RELEVANCE_FLOOR, costUsd, retrieved };
  }

  const sources = buildSources(gen.text, matches);
  return { grounded: true, answer: gen.text, sources, topSimilarity, floor: RELEVANCE_FLOOR, costUsd, retrieved };
}
