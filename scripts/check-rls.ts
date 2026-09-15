import "./_env";
import { createClient } from "@supabase/supabase-js";

/**
 * Probes the table with the PUBLIC (anon/publishable) key to check whether the
 * corpus is reachable via the auto-generated REST API. Before RLS is enabled it
 * returns rows (exposed); after `alter table chunks enable row level security`
 * with no policies, anon sees nothing.
 *   npm run check-rls
 */
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Need NEXT_PUBLIC_SUPABASE_URL and _ANON_KEY");

  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error, count } = await sb
    .from("chunks")
    .select("content", { count: "exact" })
    .limit(1);

  if (error) {
    console.log("anon read BLOCKED (good):", error.message);
    return;
  }
  const n = count ?? data?.length ?? 0;
  if (n > 0) {
    console.log(`EXPOSED: anon can read ${n} rows. Sample:`);
    console.log("  " + (data?.[0]?.content ?? "").slice(0, 70).replace(/\n/g, " ") + "...");
    console.log("  -> enable RLS on public.chunks");
  } else {
    console.log("anon sees 0 rows — corpus is not exposed (good).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
