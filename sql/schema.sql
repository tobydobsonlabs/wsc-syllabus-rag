-- WSC Syllabus RAG — Supabase schema
-- Vector dimension (1024) is voyage-3.5-lite. If you change VOYAGE_MODEL, change
-- every vector(1024) below to the new model's dimension and re-ingest.

create extension if not exists vector;

create table if not exists chunks (
  id          bigint generated always as identity primary key,
  content     text not null,          -- chunk text (breadcrumb + subjects + yield prepended)
  source_path text not null,          -- e.g. "Season 2026/03 More To Do Than Can Ever Be Listed.md"
  source_url  text,                   -- single Guiding Questions URL (SPA has no per-section anchors)
  breadcrumb  text not null,          -- "Season 2026 > 03 More To Do Than Can Ever Be Listed > What it is"
  subjects    text[] not null default '{}',
  section_no  int,                    -- 1..15, null for evergreen/reference/encyclopedia notes
  yield       text,                   -- frontmatter yield, if present
  chunk_kind  text not null default 'concept',  -- 'fact-list' | 'concept'
  embedding   vector(1024) not null,
  unique (source_path, breadcrumb)    -- idempotent upsert key
);

-- Approximate nearest-neighbour index (cosine). For a corpus this small, exact
-- search is also fine; see DECISIONS.md.
create index if not exists chunks_embedding_idx
  on chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create index if not exists chunks_subjects_idx on chunks using gin (subjects);

-- Row Level Security. The app connects only with the service_role key, which
-- BYPASSES RLS, so we enable RLS with NO policies: that denies all anon /
-- publishable-key access via the auto-generated REST API, keeping the corpus
-- (including copyright-sensitive text) off the public internet. The app,
-- ingest, and match_chunks all keep working because they use the service role.
alter table chunks enable row level security;

-- Retrieval RPC. subject_filter is optional (null = search everything). The UI
-- no longer exposes a subject filter, but the parameter is kept so the deployed
-- function signature stays stable; the app always calls it with null.
create or replace function match_chunks(
  query_embedding vector(1024),
  match_count int,
  subject_filter text default null
)
returns table (
  id bigint,
  content text,
  source_path text,
  source_url text,
  breadcrumb text,
  subjects text[],
  section_no int,
  yield text,
  chunk_kind text,
  similarity float
)
language sql stable as $$
  select id, content, source_path, source_url, breadcrumb, subjects, section_no, yield, chunk_kind,
         1 - (embedding <=> query_embedding) as similarity
  from chunks
  where subject_filter is null or subject_filter = any(subjects)
  order by embedding <=> query_embedding
  limit match_count;
$$;
