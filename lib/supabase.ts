/**
 * Server-side Supabase client using the service-role key. NEVER import this
 * into a client component — the service key bypasses RLS and must stay on the
 * server (ingest script + server actions only).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** One retrieved chunk, matching the columns returned by match_chunks(). */
export interface MatchedChunk {
  id: number;
  content: string;
  source_path: string;
  source_url: string | null;
  breadcrumb: string;
  subjects: string[];
  section_no: number | null;
  yield: string | null;
  chunk_kind: "fact-list" | "concept";
  similarity: number;
}
