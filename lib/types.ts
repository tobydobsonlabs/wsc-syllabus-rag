/**
 * Types shared between the server (RAG pipeline, API route) and the client
 * (page component). Keep this module free of server-only imports so it can be
 * pulled into a client component safely.
 */

/** One cited source, shown in the answer's Sources list. */
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

/** The newline-delimited JSON events the /api/ask stream sends to the client. */
export type AskEvent =
  | { type: "delta"; text: string }
  | { type: "done"; sources: Source[]; topSimilarity: number; floor: number }
  | { type: "refused"; topSimilarity: number; floor: number }
  | { type: "error"; error: string };
