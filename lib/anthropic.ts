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
