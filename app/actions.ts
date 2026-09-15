"use server";

import { headers } from "next/headers";
import { answerQuestion, type RagResult } from "@/lib/rag";
import { MAX_QUESTION_CHARS, USER_SPEND_CAP_USD } from "@/lib/config";

export type AskResponse =
  | { ok: true; result: RagResult }
  | { ok: false; error: string };

// Best-effort per-IP guards. In-memory, so they reset on a cold start / redeploy;
// the real backstop is the account-level cap in the API dashboards. Swap for
// Upstash (env already scaffolded) for durable, multi-instance limits.
const RATE_WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const hits = new Map<string, number[]>();
const spend = new Map<string, { usd: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

function overSpendCap(ip: string): boolean {
  const now = Date.now();
  const e = spend.get(ip);
  if (!e || now > e.resetAt) {
    spend.set(ip, { usd: 0, resetAt: now + DAY_MS });
    return false;
  }
  return e.usd >= USER_SPEND_CAP_USD;
}

function addSpend(ip: string, usd: number): void {
  const e = spend.get(ip) ?? { usd: 0, resetAt: Date.now() + DAY_MS };
  e.usd += usd;
  spend.set(ip, e);
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
  if (overSpendCap(ip)) {
    return {
      ok: false,
      error: "This demo's daily usage limit for your connection has been reached. Please try again tomorrow.",
    };
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
    addSpend(ip, result.costUsd);
    return { ok: true, result };
  } catch (e) {
    console.error("ask() failed:", e);
    return { ok: false, error: "Something went wrong answering that. Please try again." };
  }
}
