import "./_env";
import { serviceClient } from "../lib/supabase";
import { EMBED_DIM } from "../lib/config";

/**
 * Verifies the Supabase project is reachable and the schema is applied:
 * inserts a throwaway vector row, calls match_chunks(), then cleans up.
 *   npm run check-db
 */
async function main() {
  const sb = serviceClient();

  const fake = Array.from({ length: EMBED_DIM }, () => 0);
  fake[0] = 1;

  const { data: ins, error: e1 } = await sb
    .from("chunks")
    .insert({
      content: "__healthcheck__",
      source_path: "__healthcheck__",
      breadcrumb: "__healthcheck__",
      embedding: fake,
    })
    .select("id")
    .single();
  if (e1) throw new Error(`Insert failed (is the schema applied?): ${e1.message}`);

  const { data: matches, error: e2 } = await sb.rpc("match_chunks", {
    query_embedding: fake,
    match_count: 1,
  });
  if (e2) throw new Error(`match_chunks RPC failed: ${e2.message}`);

  await sb.from("chunks").delete().eq("id", ins!.id);

  const { count } = await sb
    .from("chunks")
    .select("*", { count: "exact", head: true });

  console.log("Supabase OK.");
  console.log(`  insert + match_chunks + delete all succeeded (dim ${EMBED_DIM}).`);
  console.log(`  match_chunks returned ${matches?.length ?? 0} row(s).`);
  console.log(`  rows currently in chunks: ${count}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
