import "./_env";
import { readFile } from "node:fs/promises";
import { answerQuestion } from "../lib/rag";
import { RELEVANCE_FLOOR, MATCH_COUNT } from "../lib/config";

/**
 * Retrieval + answering eval. Three case types:
 *   - "answer": the expected source must be retrieved (recall / ranking) AND the
 *     answer must be grounded and cite a source.
 *   - "refuse": off-corpus questions the app must refuse.
 *   - "no-invent": facts the syllabus references but doesn't publish (fees, exact
 *     dates, round-specific counts) — the app must decline, not fabricate.
 *
 * Reports retrieval quality (recall@k, MRR, nDCG@5) plus answer/refusal rates,
 * so a change to chunking, the reranker, or the floor can be measured before/after.
 *   npm run eval
 */
interface Case {
  question: string;
  type: "answer" | "refuse" | "no-invent";
  expect?: string;
  /** Answer cases that describe a work/concept without naming it — where pure
   *  vector retrieval is stressed and a reranker/hybrid search should help most. */
  hard?: boolean;
}

const UNAVAILABLE =
  /not published|unpublished|round[- ]specific|does ?n['’]?t appear|not available|not in the .*syllabus/i;

const hasCitation = (answer: string): boolean => /\[\d+\]/.test(answer);

/** 1-based rank of the first retrieved chunk that matches `expect`, or 0 if none. */
function firstRelevantRank(
  retrieved: { breadcrumb: string; source_path: string }[],
  expect: string,
): number {
  const i = retrieved.findIndex(
    (m) => m.breadcrumb.includes(expect) || m.source_path.includes(expect),
  );
  return i === -1 ? 0 : i + 1;
}

const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run one case, retrying transient API timeouts so a single slow call doesn't
 *  abort the whole eval. */
async function askWithRetry(question: string, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      return await answerQuestion(question);
    } catch (e) {
      if (i === tries) throw e;
      await sleep(1500 * i);
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const cases: Case[] = JSON.parse(await readFile("eval/golden.json", "utf8"));
  const answerCases = cases.filter((c) => c.type === "answer");
  const refuseCases = cases.filter((c) => c.type === "refuse");
  const noInventCases = cases.filter((c) => c.type === "no-invent");

  // Retrieval metrics (answer cases only). Track all vs the hard subset.
  const ranks: number[] = []; // 0 = not retrieved in top-K
  const hardRanks: number[] = [];
  const groundedInputTokens: number[] = []; // prompt size per grounded answer
  const groundedCosts: number[] = [];
  let answerPass = 0;
  let refusePass = 0;
  let noInventPass = 0;

  console.log(`Floor: ${RELEVANCE_FLOOR}   Top-K: ${MATCH_COUNT}\n`);

  for (const c of cases) {
    const r = await askWithRetry(c.question);
    if (r.grounded) {
      groundedInputTokens.push(r.inputTokens);
      groundedCosts.push(r.costUsd);
    }

    if (c.type === "answer") {
      const rank = firstRelevantRank(r.retrieved, c.expect!);
      ranks.push(rank);
      if (c.hard) hardRanks.push(rank);
      const ok = rank > 0 && r.grounded && hasCitation(r.answer);
      if (ok) answerPass++;
      console.log(
        `${ok ? "PASS" : "FAIL"}  [answer] ${c.question}\n` +
          `        rank=${rank || "MISS"} grounded=${r.grounded} cited=${hasCitation(r.answer)} top=${r.topSimilarity.toFixed(3)}`,
      );
    } else if (c.type === "refuse") {
      const ok = !r.grounded;
      if (ok) refusePass++;
      console.log(
        `${ok ? "PASS" : "FAIL"}  [refuse] ${c.question}\n` +
          `        refused=${!r.grounded} top=${r.topSimilarity.toFixed(3)}`,
      );
    } else {
      const ok = UNAVAILABLE.test(r.answer);
      if (ok) noInventPass++;
      console.log(
        `${ok ? "PASS" : "FAIL"}  [no-invent] ${c.question}\n` +
          `        acknowledges-unavailable=${ok} top=${r.topSimilarity.toFixed(3)}`,
      );
    }
  }

  const report = (rs: number[]) => {
    const recallAt = (k: number) => mean(rs.map((r) => (r > 0 && r <= k ? 1 : 0)));
    return {
      r1: pct(recallAt(1)),
      r3: pct(recallAt(3)),
      r5: pct(recallAt(5)),
      mrr: mean(rs.map((r) => (r > 0 ? 1 / r : 0))).toFixed(3),
      ndcg: mean(rs.map((r) => (r > 0 && r <= 5 ? 1 / Math.log2(r + 1) : 0))).toFixed(3),
    };
  };
  const all = report(ranks);
  const hard = report(hardRanks);

  console.log("\n=== RETRIEVAL ===");
  console.log(`                 all(${ranks.length})   hard(${hardRanks.length})`);
  console.log(`Recall@1:        ${all.r1.padStart(6)}   ${hard.r1}`);
  console.log(`Recall@3:        ${all.r3.padStart(6)}   ${hard.r3}`);
  console.log(`Recall@5:        ${all.r5.padStart(6)}   ${hard.r5}`);
  console.log(`MRR:             ${all.mrr.padStart(6)}   ${hard.mrr}`);
  console.log(`nDCG@5:          ${all.ndcg.padStart(6)}   ${hard.ndcg}`);

  console.log("\n=== ANSWERING ===");
  console.log(`Answered + cited:       ${answerPass}/${answerCases.length}  (${pct(answerPass / answerCases.length)})`);
  console.log(`Correct refusals:       ${refusePass}/${refuseCases.length}  (${pct(refusePass / refuseCases.length)})`);
  console.log(`Unpublished, no invent: ${noInventPass}/${noInventCases.length}  (${pct(noInventPass / Math.max(1, noInventCases.length))})`);

  console.log("\n=== COST (grounded answers) ===");
  console.log(`Avg prompt tokens:      ${Math.round(mean(groundedInputTokens))}`);
  console.log(`Avg cost per answer:    $${mean(groundedCosts).toFixed(5)}`);

  const total = answerPass + refusePass + noInventPass;
  console.log(`\nOverall:                ${total}/${cases.length}  (${pct(total / cases.length)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
