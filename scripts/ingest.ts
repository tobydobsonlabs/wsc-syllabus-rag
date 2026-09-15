import "./_env";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { buildChunks, type Chunk } from "../lib/chunk";
import { embedDocuments } from "../lib/voyage";
import { serviceClient } from "../lib/supabase";

/**
 * Local-only ingest. Never runs in production.
 *
 *   npm run ingest          -> content/sample  (safe default)
 *   npm run ingest:wsc      -> INGEST_SOURCE_DIR, syllabus folders only
 *
 * Excludes Students/ (minors) unconditionally.
 */

const WSC_INCLUDE = new Set([
  "Season 2026",
  "Encyclopedia",
  "Threads",
  "Reference",
  "Events",
]);
const EMBED_BATCH = 96;
const INSERT_BATCH = 500;

function resolveSource(): { dir: string; mode: "sample" | "wsc" } {
  const wsc = process.argv.includes("--wsc");
  if (wsc) {
    const dir = process.env.INGEST_SOURCE_DIR;
    if (!dir) throw new Error("--wsc requires INGEST_SOURCE_DIR in .env.local");
    return { dir, mode: "wsc" };
  }
  return { dir: path.resolve("content/sample"), mode: "sample" };
}

function included(relPosix: string, mode: "sample" | "wsc"): boolean {
  const top = relPosix.split("/")[0];
  if (relPosix.startsWith("Students/")) return false; // minors — never
  if (mode === "wsc") return WSC_INCLUDE.has(top);
  return true; // sample: everything
}

async function main() {
  const { dir, mode } = resolveSource();
  console.log(`Ingest source: ${dir} (mode: ${mode})`);

  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .filter((rel) => included(rel, mode));

  let scanned = 0;
  const chunks: Chunk[] = [];
  for (const rel of files) {
    scanned++;
    const raw = await readFile(path.join(dir, rel), "utf8");
    if (path.basename(rel).startsWith("_")) continue; // templates
    chunks.push(...buildChunks(rel, raw));
  }
  console.log(`Files included: ${files.length}. Chunks built: ${chunks.length}.`);
  if (chunks.length === 0) throw new Error("No chunks produced — check the source path.");

  // Embed in batches (documents).
  console.log("Embedding via Voyage...");
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await embedDocuments(batch.map((c) => c.content));
    batch.forEach((c, j) => ((c as Chunk & { embedding: number[] }).embedding = vectors[j]));
    process.stdout.write(`  ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length}\r`);
  }
  console.log("\nEmbedding done.");

  // Clear + reload (idempotent).
  const sb = serviceClient();
  const { error: delErr } = await sb.from("chunks").delete().gte("id", 0);
  if (delErr) throw new Error(`Clear failed: ${delErr.message}`);

  let inserted = 0;
  for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
    const rows = chunks.slice(i, i + INSERT_BATCH).map((c) => {
      const { ...row } = c as Chunk & { embedding: number[] };
      return row;
    });
    const { error, count } = await sb
      .from("chunks")
      .insert(rows, { count: "exact" });
    if (error) throw new Error(`Insert failed: ${error.message}`);
    inserted += count ?? rows.length;
  }

  const { count: finalCount } = await sb
    .from("chunks")
    .select("*", { count: "exact", head: true });

  console.log("---");
  console.log(`Chunks built:    ${chunks.length}`);
  console.log(`Rows inserted:   ${inserted}`);
  console.log(`Rows in table:   ${finalCount}`);
  if (chunks.length !== finalCount) {
    throw new Error("RECONCILE FAILED: chunks built != rows in table");
  }
  console.log("Reconcile OK.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
