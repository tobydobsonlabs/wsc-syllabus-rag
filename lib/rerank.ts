/**
 * Voyage AI reranker. Vector search is a fast first pass that's good at "roughly
 * the same topic"; a cross-encoder reranker then scores the query against each
 * candidate together, so we can fetch a wide net cheaply and keep only the few
 * most relevant chunks — better precision, and fewer chunks sent to the model.
 */
import { RERANK_MODEL } from "./config";

const VOYAGE_RERANK_URL = "https://api.voyageai.com/v1/rerank";

/**
 * Rerank `documents` against `query`; returns the indices of the top `topN`,
 * best first. Throws on API error so the caller can fall back to vector order.
 */
export async function rerankDocs(
  query: string,
  documents: string[],
  topN: number,
): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");
  if (documents.length === 0) return [];

  const res = await fetch(VOYAGE_RERANK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      documents,
      model: RERANK_MODEL,
      top_k: Math.min(topN, documents.length),
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`Voyage rerank error ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    data?: { index: number; relevance_score: number }[];
  };
  const data = json.data;
  if (!data || data.length === 0) {
    throw new Error("Voyage rerank returned no results");
  }
  // Voyage returns data already sorted by relevance_score, highest first.
  return data.map((d) => d.index);
}
