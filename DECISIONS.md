# Decisions

Why this is built the way it is, and what I'd change at scale.

## The product is the refusal

The World Scholar's Cup knowledge base I coach from has one hard rule: never state a competition
fact that isn't from an official source. A fabricated rule doesn't sit in a document — it gets
taught to a student and fails in a competition hall. So the design goal was not "answer questions"
but "answer only what the syllabus supports, and refuse the rest." Everything below serves that.

Refusal is enforced in **two independent layers**:

1. **A similarity floor** (`RELEVANCE_FLOOR`, default 0.30) — a cheap pre-filter: if nothing is
   even close, don't spend a model call.
2. **A grounding instruction** — the model is told to use *only* the numbered sources and to reply
   with a fixed refusal sentence otherwise. This is the primary guard.

The eval shows why both exist and why the model-side layer matters most: an off-topic question
("What is the capital of France?") retrieved a top chunk at 0.46 — comfortably above the floor,
because with a few hundred chunks cosine scores bunch up — and was still correctly refused by the
model. A floor high enough to catch that alone would also reject valid but lower-similarity
questions. So the floor stays low and the model does the real work.

## Voyage over OpenAI embeddings, and asymmetric over symmetric

Embeddings are Voyage AI (`voyage-3.5-lite`, 1024-dim) rather than OpenAI, because I already run
Voyage + Anthropic in another project and reused those keys — one fewer vendor, and it keeps the
running cost near zero. The one deliberate change from that other project: it embeds everything as
`document`; here the **question embeds as `query` and chunks as `document`**. Voyage's two modes
produce vectors tuned for that retrieval direction, which is the recommended setup for
document-vs-question RAG. The embedding model and dimension must match between ingest and query, so
both read from one config and the client asserts the returned dimension.

## Supabase pgvector over a dedicated vector DB (Pinecone, etc.)

One corpus, a few hundred chunks, one page. A managed vector database is operational overhead and a
second bill for a problem Postgres already solves: `pgvector` gives cosine search in one SQL
function (`match_chunks`), the data and the vectors live in the same place, and the free tier costs
nothing. Retrieval is a single RPC. At a different scale the answer changes (see below).

## Two-stage retrieval: a reranker, and *not* hybrid search

Retrieval is wide-then-narrow: vector search pulls the top 20 candidates, then a Voyage
cross-encoder reranker (`rerank-2.5-lite`) scores the question against each candidate together and
keeps the top 3 for the prompt. This is the decision I'm most careful about, because the eval
changed my mind about it.

The honest result first: **bi-encoder recall was already at ceiling.** On 683 distinctive chunks,
vector search alone hit 100% recall@3 — even on a "hard" eval subset that describes a work without
naming it. A reranker cannot improve recall that is already 100%, and this is exactly the trap a
portfolio project falls into: adding a fashionable component and claiming a lift that isn't there.

So the reranker earns its place a different way — **precision and cost.** Vector search's top-6
mixed short sub-heading fragments in with the full entries; the reranker promotes the fullest, most
relevant passages, which let me cut the prompt from 6 chunks to 3. Measured before/after: recall@1
95.5% → 97.7%, MRR 0.977 → 0.989, faithfulness flat (98.6% → 98.2%), and **average prompt tokens
down 39% and cost per answer down 27%** at equal answer quality.

I deliberately did **not** add hybrid (keyword + vector) search, even though it's the obvious next
RAG component. Hybrid earns its keep when lexical exact-match beats embeddings — long-tail names,
codes, rare tokens in a large noisy corpus. Here the corpus is small and every entry is a
distinctive title or concept, and the eval already shows exact-title lookups retrieving at rank 1.
Adding a BM25 index and fusion would be complexity the data doesn't justify. The eval is what makes
that a decision rather than a guess: it says where the headroom is, and here it isn't in retrieval.

## Section-based chunking, with metadata

Chunks are split on markdown **headings**, not fixed character counts, because the source notes are
already well-structured (each concept or guiding question is a section). Each chunk carries a
breadcrumb, the subjects, and a `chunk_kind` derived from the frontmatter and the theme's own
structure — `fact-list` for named-works notes and the fact-heavy sections, `concept` for the
discursive ones. The breadcrumb and subjects are prepended to the text before embedding, which
measurably improves retrieval, and `chunk_kind` lets the prompt ask for a terse cited answer on
facts and a short synthesis on concepts. Link-only sections (Sources, Connects to) are dropped as
retrieval noise.

## Copyright and minors

Two hard constraints shaped the repo boundary:

- The real notes quote third-party material (poems, lyrics, named works). So the corpus is **never
  committed** — `content/` is gitignored, only a synthetic sample ships, and the system prompt
  forbids reproducing quoted passages verbatim (answers cite titles and metadata instead).
- The knowledge base also contains notes about **minors**. Ingest hard-excludes the `Students/`
  folder unconditionally, and a post-ingest check ([`scripts/verify-corpus.ts`](./scripts/verify-corpus.ts))
  fails if a single `Students/` row reaches the index.

## Generation model

`claude-haiku-4-5` — grounded answers over a handful of retrieved chunks are short and don't need a
frontier model, and the goal was a near-£0 running cost with a capped spend. One environment
variable swaps it to `claude-sonnet-5` for more nuance on synthesis-heavy questions.

## Guardrails beyond refusal

Per-IP rate limiting and an input-length cap live in the streaming API route (the free wins against
a runaway bill), and hard monthly spend caps are set in the Anthropic and Voyage dashboards. The
rate limiter is in-memory, which is correct for a single instance; the env is already scaffolded
for Upstash if this ever runs multi-instance.

## Streaming over a route handler

Answers stream token by token so the reader sees the *Short answer* first instead of waiting for the
whole five-part response. Next.js server actions return once and can't stream, so generation moved
to a route handler (`app/api/ask`) that emits newline-delimited JSON events (`delta` / `done` /
`refused` / `error`); the page applies each event as it arrives and shows sources on the final one.
The retrieve-or-refuse logic runs *before* the stream opens, so a refusal never streams a partial
answer.

## Known limits / what I'd do differently

- **Question phrasing matters.** Well-posed factual and definitional questions answer reliably;
  vaguer meta questions ("what's the keystone section?") retrieve loosely and get refused. Honest,
  but coverage of navigational queries is the next quality lever — likely a small set of curated
  "map" chunks plus light query expansion.
- **The floor is evidence-tuned, not tuned to death.** It's a pre-filter, not the guard; I resisted
  raising it to pass a single case at the cost of real questions.
- **The next quality lever is faithfulness, not retrieval.** The faithfulness eval catches the real
  failure mode here: on a handful of answers the model adds a true fact that *isn't in the retrieved
  sources* (e.g. a poet's Nobel year), which is exactly the outside-knowledge leak the grounding
  rule forbids. Tightening that — and the one `no-invent` case that answered instead of declining —
  is where I'd spend effort, because retrieval is already saturated.
- **The eval is the safety net for everything above.** It reports recall@k / MRR / nDCG, a
  faithfulness grade, refusal accuracy, and cost per answer, over a golden set that includes a hard
  "describe-it-without-naming-it" subset. It's what turned "add a reranker" from a guess into a
  measured 27% cost cut at equal quality, and what told me *not* to add hybrid search. At real scale
  it's also the first thing I'd grow, before touching `ivfflat`/`hnsw` tuning, exact-search limits,
  dedup, or a dedicated vector store.
