import type { MatchedChunk } from "./supabase";

/** The exact sentence the app uses when a question isn't covered by the corpus. */
export const REFUSAL_TEXT = "That doesn't appear to be in the 2026 syllabus.";

const SYSTEM = `You answer questions about the World Scholar's Cup 2026 syllabus (the Guiding Questions) for coaches and students.

Rules, in order of importance:
1. Use ONLY the numbered SOURCES provided. Do not use any outside knowledge.
2. If the sources do not contain the answer, reply with exactly: "${REFUSAL_TEXT}" and nothing else. Never guess or invent a WSC fact.
3. Cite every source you use by its [n] number, inline.
4. Never reproduce quoted passages verbatim (poem lines, lyrics, long quotations). Refer to titles, creators, years, and sections instead.
5. Answer style: for fact-list sources, be terse and cite the exact source. For concept sources, give a short synthesis across the relevant sources. Keep it brief and useful for someone coaching or revising.`;

export function buildPrompt(question: string, matches: MatchedChunk[]): {
  system: string;
  user: string;
} {
  const sources = matches
    .map(
      (m, i) =>
        `[${i + 1}] (${m.chunk_kind}) ${m.breadcrumb}\n${m.content}`,
    )
    .join("\n\n");

  const user = `SOURCES:\n${sources}\n\nQUESTION: ${question}`;
  return { system: SYSTEM, user };
}
