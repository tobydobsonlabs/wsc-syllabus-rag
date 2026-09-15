/**
 * Voyage AI embeddings client.
 *
 * Unlike the yapyapgo integration (which embeds everything as `document`), this
 * RAG uses the recommended asymmetric setup: chunks embed as `document`, the
 * user's question embeds as `query`. Voyage's two modes produce different
 * vectors tuned for that retrieval direction. See DECISIONS.md.
 */
import { VOYAGE_MODEL, EMBED_DIM } from "./config";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
export type InputType = "query" | "document";

export async function embed(texts: string[], inputType: InputType): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");
  if (texts.length === 0) return [];

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: inputType,
      output_dimension: EMBED_DIM,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Voyage API error ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as { data?: { embedding: number[] }[] };
  const vectors = json.data?.map((d) => d.embedding);
  if (!vectors || vectors.length !== texts.length) {
    throw new Error("Voyage returned an unexpected number of embeddings");
  }
  // Fail loudly on a dimension mismatch — a silent one corrupts retrieval.
  for (const v of vectors) {
    if (v.length !== EMBED_DIM) {
      throw new Error(
        `Voyage returned ${v.length}-dim vectors but EMBED_DIM is ${EMBED_DIM}. ` +
          `Check VOYAGE_MODEL (${VOYAGE_MODEL}) and the schema's vector(N).`,
      );
    }
  }
  return vectors;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embed([text], "query");
  return v;
}

export function embedDocuments(texts: string[]): Promise<number[][]> {
  return embed(texts, "document");
}
