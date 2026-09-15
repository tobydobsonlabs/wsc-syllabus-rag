import "./_env";
import { serviceClient } from "../lib/supabase";

/** Post-ingest safety + shape check: no Students/ rows, and the area spread. */
async function main() {
  const sb = serviceClient();

  const { count: total } = await sb
    .from("chunks")
    .select("*", { count: "exact", head: true });

  const { count: students } = await sb
    .from("chunks")
    .select("*", { count: "exact", head: true })
    .ilike("source_path", "Students/%");

  const { data: rows } = await sb.from("chunks").select("source_path").limit(1000);
  const areas: Record<string, number> = {};
  for (const r of rows ?? []) {
    const a = (r.source_path as string).split("/")[0];
    areas[a] = (areas[a] ?? 0) + 1;
  }

  console.log("total chunks:", total);
  console.log("Students/ rows (MUST be 0):", students ?? 0);
  console.log("areas (first 1000 rows):", areas);
  if ((students ?? 0) > 0) {
    throw new Error("SAFETY FAIL: Students/ content is in the index");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
