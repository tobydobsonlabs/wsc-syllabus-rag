import { retrieveChunks, buildSources, estimateCost } from "@/lib/rag";
import { buildPrompt, REFUSAL_TEXT } from "@/lib/prompt";
import { streamAnswer } from "@/lib/anthropic";
import { RELEVANCE_FLOOR, MAX_QUESTION_CHARS } from "@/lib/config";
import { rateLimited, overSpendCap, addSpend } from "@/lib/guards";
import type { AskEvent } from "@/lib/types";

// The service-role Supabase client and the Anthropic SDK need the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streaming query endpoint. Emits newline-delimited JSON (AskEvent) so the UI
 * can render the answer as it is written: retrieve -> relevance floor
 * (retrieve-or-refuse) -> streamed grounded generation -> cited sources.
 */
export async function POST(req: Request): Promise<Response> {
  const ip =
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";

  let question = "";
  try {
    const body = (await req.json()) as { question?: unknown };
    question = typeof body.question === "string" ? body.question.trim() : "";
  } catch {
    question = "";
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AskEvent) =>
        controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));

      try {
        if (rateLimited(ip)) {
          send({ type: "error", error: "Too many questions in a short time. Please wait a minute." });
          return;
        }
        if (overSpendCap(ip)) {
          send({
            type: "error",
            error: "This demo's daily usage limit for your connection has been reached. Please try again tomorrow.",
          });
          return;
        }
        if (!question) {
          send({ type: "error", error: "Type a question first." });
          return;
        }
        if (question.length > MAX_QUESTION_CHARS) {
          send({ type: "error", error: `Please keep questions under ${MAX_QUESTION_CHARS} characters.` });
          return;
        }

        const q = question.slice(0, MAX_QUESTION_CHARS);
        const { matches, topSimilarity } = await retrieveChunks(q);

        // Retrieve-or-refuse: nothing close enough, so we do not answer.
        if (matches.length === 0 || topSimilarity < RELEVANCE_FLOOR) {
          send({ type: "refused", topSimilarity, floor: RELEVANCE_FLOOR });
          return;
        }

        const { system, user } = buildPrompt(q, matches);
        let answer = "";
        let inputTokens = 0;
        let outputTokens = 0;

        for await (const ev of streamAnswer(system, user)) {
          if (ev.type === "delta") {
            answer += ev.text;
            send({ type: "delta", text: ev.text });
          } else {
            answer = ev.generation.text;
            inputTokens = ev.generation.inputTokens;
            outputTokens = ev.generation.outputTokens;
          }
        }

        addSpend(ip, estimateCost(inputTokens, outputTokens));

        // The model may itself refuse if the sources don't actually answer it.
        if (answer.trim() === REFUSAL_TEXT) {
          send({ type: "refused", topSimilarity, floor: RELEVANCE_FLOOR });
          return;
        }

        send({
          type: "done",
          sources: buildSources(answer, matches),
          topSimilarity,
          floor: RELEVANCE_FLOOR,
        });
      } catch (e) {
        console.error("ask route failed:", e);
        try {
          send({ type: "error", error: "Something went wrong answering that. Please try again." });
        } catch {
          // controller already closed
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
