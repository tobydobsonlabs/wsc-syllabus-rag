import "./_env";
import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { retrieveChunks } from "../lib/rag";
import { buildPrompt } from "../lib/prompt";
import { generateAnswer } from "../lib/anthropic";
import { ANTHROPIC_MODEL, RELEVANCE_FLOOR } from "../lib/config";

/**
 * Faithfulness eval (LLM-as-judge). For each grounded answer, a judge model
 * breaks the answer into factual claims and checks each against ONLY the sources
 * the answer was built from. Reports the share of claims supported and how many
 * answers contain an unsupported claim.
 *
 * The judge defaults to the app's model; set JUDGE_MODEL to a stronger one
 * (e.g. claude-sonnet-5) for a more reliable grade.
 *   npm run eval:faithfulness
 */
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? ANTHROPIC_MODEL;

const JUDGE_SYSTEM = `You grade the faithfulness of a retrieval-augmented answer.
You are given numbered SOURCES and an ANSWER. Break the ANSWER into its distinct
factual claims, ignoring section headings (like "Short answer") and generic
framing. For each claim decide, using ONLY the SOURCES, whether it is supported.
Do not use outside knowledge. A claim that goes beyond the sources is unsupported.
Return ONLY minified JSON: {"claims": <int>, "supported": <int>, "unsupported": ["<short claim>", ...]}.`;

interface Case {
  question: string;
  type: string;
  expect?: string;
}
interface Grade {
  claims: number;
  supported: number;
  unsupported: string[];
}

const anthropic = new Anthropic();

function parseGrade(text: string): Grade | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const g = JSON.parse(m[0]) as Grade;
    if (typeof g.claims === "number" && typeof g.supported === "number") {
      return { claims: g.claims, supported: g.supported, unsupported: g.unsupported ?? [] };
    }
  } catch {
    /* fall through */
  }
  return null;
}

async function judge(sources: string, answer: string): Promise<Grade | null> {
  const res = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 800,
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content: `SOURCES:\n${sources}\n\nANSWER:\n${answer}` }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return parseGrade(text);
}

async function main() {
  const cases: Case[] = JSON.parse(await readFile("eval/golden.json", "utf8"));
  const answerCases = cases.filter((c) => c.type === "answer");

  console.log(`Judge model: ${JUDGE_MODEL}\n`);

  let totalClaims = 0;
  let totalSupported = 0;
  let graded = 0;
  let cleanAnswers = 0; // no unsupported claims

  for (const c of answerCases) {
    const { matches, topSimilarity } = await retrieveChunks(c.question);
    if (matches.length === 0 || topSimilarity < RELEVANCE_FLOOR) {
      console.log(`SKIP (not grounded)  ${c.question}`);
      continue;
    }
    const { system, user } = buildPrompt(c.question, matches);
    const gen = await generateAnswer(system, user);

    // Number the sources the same way buildPrompt/buildSources do.
    const numbered = matches
      .map((m, i) => `[${i + 1}] ${m.breadcrumb}\n${m.content}`)
      .join("\n\n");
    const g = await judge(numbered, gen.text);
    if (!g || g.claims === 0) {
      console.log(`SKIP (ungradable)    ${c.question}`);
      continue;
    }

    graded++;
    totalClaims += g.claims;
    totalSupported += g.supported;
    if (g.unsupported.length === 0) cleanAnswers++;

    const rate = g.supported / g.claims;
    console.log(
      `${rate === 1 ? "OK  " : "WARN"}  ${c.question}\n` +
        `        ${g.supported}/${g.claims} claims supported` +
        (g.unsupported.length ? `  — unsupported: ${g.unsupported.join("; ")}` : ""),
    );
  }

  console.log("\n=== FAITHFULNESS ===");
  console.log(`Answers graded:            ${graded}`);
  console.log(`Claim support rate:        ${totalClaims ? ((totalSupported / totalClaims) * 100).toFixed(1) : "0"}%  (${totalSupported}/${totalClaims})`);
  console.log(`Answers with no unsupported claim: ${cleanAnswers}/${graded}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
