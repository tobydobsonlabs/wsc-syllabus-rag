import "./_env";
import { answerQuestion } from "../lib/rag";
import { RELEVANCE_FLOOR } from "../lib/config";

/**
 * Terminal query path (milestone 4/5 verification):
 *   npm run query -- "What does the Special Area cover about memory?"
 */
async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: npm run query -- "your question"');
    process.exit(1);
  }

  const r = await answerQuestion(question);

  console.log(`\nQ: ${question}`);
  console.log(`Top similarity: ${r.topSimilarity.toFixed(3)}  (floor ${RELEVANCE_FLOOR})`);
  console.log(`Grounded: ${r.grounded}\n`);
  console.log(r.answer);
  if (r.sources.length) {
    console.log("\nSources:");
    for (const s of r.sources) {
      console.log(
        `  [${s.n}] ${s.breadcrumb}  (${s.chunk_kind}, ${s.similarity.toFixed(3)})`,
      );
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
