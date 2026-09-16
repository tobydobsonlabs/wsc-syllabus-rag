import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_MODEL } from "./config";
import { REFUSAL_TEXT } from "./prompt";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  return (client ??= new Anthropic());
}

export interface Generation {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** Generate a grounded answer. Short output; grounded RAG answers are terse. */
export async function generateAnswer(system: string, user: string): Promise<Generation> {
  const res = await getClient().messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });

  const usage = {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };

  // Safety net: if the model itself declines, surface the refusal, not empty text.
  if (res.stop_reason === "refusal") return { text: REFUSAL_TEXT, ...usage };

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return { text: text || REFUSAL_TEXT, ...usage };
}

/**
 * Streaming variant: yields text deltas as they arrive, then a final event with
 * the complete text and token usage. Used by the /api/ask route so the UI can
 * render the answer as it is written.
 */
export async function* streamAnswer(
  system: string,
  user: string,
): AsyncGenerator<
  { type: "delta"; text: string } | { type: "final"; generation: Generation }
> {
  const stream = getClient().messages.stream({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield { type: "delta", text: event.delta.text };
    }
  }

  const final = await stream.finalMessage();
  const usage = {
    inputTokens: final.usage.input_tokens,
    outputTokens: final.usage.output_tokens,
  };
  // Safety net: if the model itself declines, surface the refusal, not empty text.
  const text =
    final.stop_reason === "refusal"
      ? REFUSAL_TEXT
      : final.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim() || REFUSAL_TEXT;

  yield { type: "final", generation: { text, ...usage } };
}
