import { embedQuery } from "./voyage";
import { serviceClient, type MatchedChunk } from "./supabase";
import { buildPrompt, REFUSAL_TEXT } from "./prompt";
import { generateAnswer } from "./anthropic";
import { RELEVANCE_FLOOR, MATCH_COUNT, MAX_QUESTION_CHARS } from "./config";

export interface Source {
  n: number;
  breadcrumb: string;
  source_path: string;
  source_url: string | null;
  subjects: string[];
  section_no: number | null;
  chunk_kind: "fact-list" | "concept";
  similarity: number;
}

export interface RagResult {
  grounded: boolean;
  answer: string;
  sources: Source[];
  topSimilarity: number;
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

/**
 * The full query path: embed -> retrieve -> relevance floor (retrieve-or-refuse)
 * -> grounded generation -> answer + the sources actually cited.
 */
export async function answerQuestion(
  rawQuestion: string,
  subject?: string | null,
): Promise<RagResult> {
  const question = rawQuestion.trim().slice(0, MAX_QUESTION_CHARS);

  const embedding = await embedQuery(question);
  const sb = serviceClient();
  const { data, error } = await sb.rpc("match_chunks", {
    query_embedding: embedding,
    match_count: MATCH_COUNT,
    subject_filter: subject ?? null,
  });
  if (error) throw new Error(`match_chunks failed: ${error.message}`);

  const matches = (data ?? []) as MatchedChunk[];
  const topSimilarity = matches[0]?.similarity ?? 0;

  // Retrieve-or-refuse: nothing close enough, so we do not answer.
  if (matches.length === 0 || topSimilarity < RELEVANCE_FLOOR) {
    return { grounded: false, answer: REFUSAL_TEXT, sources: [], topSimilarity };
  }

  const { system, user } = buildPrompt(question, matches);
  const answer = await generateAnswer(system, user);

  // The model may itself refuse if the sources don't actually answer it.
  if (answer.trim() === REFUSAL_TEXT) {
    return { grounded: false, answer: REFUSAL_TEXT, sources: [], topSimilarity };
  }

  // Show the sources the answer cited; fall back to the top 3 if it cited none.
  const cited = citedIndexes(answer, matches.length);
  const chosen = cited.length ? cited : [1, 2, 3].slice(0, matches.length);
  const sources: Source[] = chosen.map((n) => {
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

  return { grounded: true, answer, sources, topSimilarity };
}
