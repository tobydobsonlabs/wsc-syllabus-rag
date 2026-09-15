"use server";

import { headers } from "next/headers";
import { answerQuestion, type RagResult } from "@/lib/rag";
import { MAX_QUESTION_CHARS } from "@/lib/config";

export type AskResponse =
  | { ok: true; result: RagResult }
  | { ok: false; error: string };

// Simple per-IP limiter. Fine for a single instance / demo; swap for Upstash
// (env already scaffolded) when running multi-instance.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function ask(input: {
  question: string;
  subject: string | null;
}): Promise<AskResponse> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (rateLimited(ip)) {
    return { ok: false, error: "Too many questions in a short time. Please wait a minute." };
  }

  const question = (input.question ?? "").trim();
  if (!question) return { ok: false, error: "Type a question first." };
  if (question.length > MAX_QUESTION_CHARS) {
    return {
      ok: false,
      error: `Please keep questions under ${MAX_QUESTION_CHARS} characters.`,
    };
  }

  try {
    const result = await answerQuestion(question, input.subject);
    return { ok: true, result };
  } catch (e) {
    console.error("ask() failed:", e);
    return { ok: false, error: "Something went wrong answering that. Please try again." };
  }
}
