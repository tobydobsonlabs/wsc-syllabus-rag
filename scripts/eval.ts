import "./_env";
import { readFile } from "node:fs/promises";
import { answerQuestion } from "../lib/rag";
import { RELEVANCE_FLOOR } from "../lib/config";

/**
 * Grounding eval. Two halves:
 *   - "answer" cases (named-works facts): the expected source must appear in the
 *     retrieved top-K (recall), and the answer must be grounded and cite a source.
 *   - "refuse" cases (the syllabus's own unpublished "open questions", plus
 *     off-topic): the app must refuse.
 * Prints a score. Re-run after any change to chunking, the floor, or the prompt.
 *   npm run eval
 */
interface Case {
  question: string;
  // answer: must retrieve the source, answer, and cite.
  // refuse: must refuse outright (off-corpus).
  // no-invent: the fact is genuinely unpublished (the syllabus's "open questions") —
  //   the app must acknowledge it's unavailable and NOT fabricate a figure.
  type: "answer" | "refuse" | "no-invent";
  expect?: string;
}

const UNAVAILABLE =
  /not published|unpublished|round[- ]specific|does ?n['’]?t appear|not available|not in the .*syllabus/i;

function hasCitation(answer: string): boolean {
  return /\[\d+\]/.test(answer);
}

async function main() {
  const cases: Case[] = JSON.parse(await readFile("eval/golden.json", "utf8"));

  let recallPass = 0;
  let answerPass = 0;
  let refusePass = 0;
  let noInventPass = 0;
  const answerCases = cases.filter((c) => c.type === "answer");
  const refuseCases = cases.filter((c) => c.type === "refuse");
  const noInventCases = cases.filter((c) => c.type === "no-invent");

  console.log(`Floor: ${RELEVANCE_FLOOR}\n`);

  for (const c of cases) {
    const r = await answerQuestion(c.question);
    if (c.type === "answer") {
      const recall = r.retrieved.some(
        (m) =>
          m.breadcrumb.includes(c.expect!) || m.source_path.includes(c.expect!),
      );
      const ok = recall && r.grounded && hasCitation(r.answer);
      if (recall) recallPass++;
      if (ok) answerPass++;
      const rank =
        r.retrieved.findIndex(
          (m) =>
            m.breadcrumb.includes(c.expect!) || m.source_path.includes(c.expect!),
        ) + 1;
      console.log(
        `${ok ? "PASS" : "FAIL"}  [answer] ${c.question}` +
          `\n        recall=${recall ? `yes(#${rank})` : "NO"} grounded=${r.grounded} cited=${hasCitation(r.answer)} top=${r.topSimilarity.toFixed(3)}`,
      );
    } else if (c.type === "refuse") {
      const ok = !r.grounded;
      if (ok) refusePass++;
      console.log(
        `${ok ? "PASS" : "FAIL"}  [refuse] ${c.question}` +
          `\n        refused=${!r.grounded} top=${r.topSimilarity.toFixed(3)}`,
      );
    } else {
      // no-invent: honest handling of a genuinely unpublished fact.
      const acknowledges = UNAVAILABLE.test(r.answer);
      if (acknowledges) noInventPass++;
      console.log(
        `${acknowledges ? "PASS" : "FAIL"}  [no-invent] ${c.question}` +
          `\n        acknowledges-unavailable=${acknowledges} top=${r.topSimilarity.toFixed(3)}`,
      );
    }
  }

  console.log("\n=== SCORE ===");
  console.log(`Retrieval recall:      ${recallPass}/${answerCases.length}`);
  console.log(`Answered + cited:      ${answerPass}/${answerCases.length}`);
  console.log(`Correct refusals:      ${refusePass}/${refuseCases.length}`);
  console.log(`Unpublished, no invent: ${noInventPass}/${noInventCases.length}`);
  const total = answerPass + refusePass + noInventPass;
  console.log(`Overall:               ${total}/${cases.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
