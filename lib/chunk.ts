/**
 * Markdown -> chunks. This is where most RAG quality is won or lost.
 *
 * Strategy: split each note by its markdown headings (not fixed character
 * counts), prepend a breadcrumb + subjects + yield to each chunk so retrieval
 * has context, and carry structured metadata from the frontmatter. Link-only
 * sections (Sources, Connects to, ...) are dropped as retrieval noise.
 */
import matter from "gray-matter";

export interface Chunk {
  content: string;
  source_path: string;
  source_url: string | null;
  breadcrumb: string;
  subjects: string[];
  section_no: number | null;
  yield: string | null;
  chunk_kind: "fact-list" | "concept";
}

const GUIDING_QUESTIONS_URL =
  "https://themes.scholarscup.org/#/themes/2026/guidingquestions";

/** Headings whose bodies are mostly wikilinks/citations, not answerable prose. */
const HEADING_DENYLIST = new Set([
  "sources",
  "links",
  "encyclopedia routes",
  "connects to",
  "related",
]);

const MAX_CHARS = 2200; // ~550 tokens; split larger sections on sub-headings
const MIN_CHARS = 40; // drop trivially short fragments

/** Strip Obsidian wikilinks and callout tags so embeddings read as plain prose. */
function cleanText(s: string): string {
  return s
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1") // [[Target|Alias]] -> Alias
    .replace(/\[\[([^\]]+)\]\]/g, "$1") // [[Target]] -> Target
    .replace(/\[!(\w+)\][-+]?/g, "") // callout tag [!tip]
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function deriveKind(
  data: Record<string, unknown>,
  section_no: number | null,
): "fact-list" | "concept" {
  const type = String(data.type ?? "").toLowerCase();
  if ((type === "work" || type === "case") && (data.year || data.creator)) {
    return "fact-list";
  }
  if (type === "thread") return "concept";
  // From the Theme Overview: which sections are fact-heavy vs discursive.
  const FACT_SECTIONS = new Set([4, 5, 9, 10, 11, 12]);
  const CONCEPT_SECTIONS = new Set([2, 3, 6, 8, 14]);
  if (section_no && FACT_SECTIONS.has(section_no)) return "fact-list";
  if (section_no && CONCEPT_SECTIONS.has(section_no)) return "concept";
  if (String(data.yield ?? "").toUpperCase().includes("FACT")) return "fact-list";
  return "concept";
}

function areaCrumb(relPath: string): string {
  const parts = relPath.split("/");
  if (parts[0] === "Encyclopedia" && parts.length > 2) {
    return `Encyclopedia › ${parts[1]}`;
  }
  return parts[0];
}

function sectionNo(
  data: Record<string, unknown>,
  fileStem: string,
): number | null {
  if (typeof data.section === "number") return data.section;
  if (Array.isArray(data.sections) && typeof data.sections[0] === "number") {
    return data.sections[0] as number;
  }
  const m = fileStem.match(/^(\d{1,2})\b/);
  return m ? Number(m[1]) : null;
}

/** Split a body into { heading, text } sections by H2, then oversized ones by H3. */
function splitSections(body: string): { heading: string | null; text: string }[] {
  const lines = body.split("\n");
  const out: { heading: string | null; text: string }[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) out.push({ heading, text });
    buf = [];
  };
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      flush();
      heading = h2[1].trim();
    } else if (/^#\s+/.test(line)) {
      // H1 title line — ignore
    } else {
      buf.push(line);
    }
  }
  flush();

  // Second pass: split oversized sections on H3.
  const result: { heading: string | null; text: string }[] = [];
  for (const sec of out) {
    if (sec.text.length <= MAX_CHARS) {
      result.push(sec);
      continue;
    }
    const subLines = sec.text.split("\n");
    let subHeading: string | null = null;
    let subBuf: string[] = [];
    const subFlush = () => {
      const text = subBuf.join("\n").trim();
      if (text) {
        result.push({
          heading: subHeading && sec.heading ? `${sec.heading} › ${subHeading}` : sec.heading,
          text,
        });
      }
      subBuf = [];
    };
    for (const line of subLines) {
      const h3 = line.match(/^###\s+(.*)$/);
      if (h3) {
        subFlush();
        subHeading = h3[1].trim();
      } else {
        subBuf.push(line);
      }
    }
    subFlush();
  }
  return result;
}

export function buildChunks(relPath: string, raw: string): Chunk[] {
  const { data, content } = matter(raw);
  const fileStem = relPath.split("/").pop()!.replace(/\.md$/i, "");
  const area = areaCrumb(relPath);
  const section_no = sectionNo(data, fileStem);
  const subjects = Array.isArray(data.subjects) ? data.subjects.map(String) : [];
  const yieldVal = data.yield != null ? String(data.yield) : null;
  const kind = deriveKind(data, section_no);

  const sections = splitSections(content);
  const chunks: Chunk[] = [];

  for (const sec of sections) {
    if (sec.heading && HEADING_DENYLIST.has(sec.heading.toLowerCase())) continue;
    const text = cleanText(sec.text);
    if (text.length < MIN_CHARS) continue;

    const breadcrumb = sec.heading
      ? `${area} › ${fileStem} › ${sec.heading}`
      : `${area} › ${fileStem}`;

    const header =
      breadcrumb +
      (subjects.length ? `\nSubjects: ${subjects.join(", ")}.` : "") +
      (yieldVal ? ` Yield: ${yieldVal}.` : "");

    chunks.push({
      content: `${header}\n\n${text}`,
      source_path: relPath,
      source_url: GUIDING_QUESTIONS_URL,
      breadcrumb,
      subjects,
      section_no,
      yield: yieldVal,
      chunk_kind: kind,
    });
  }
  return chunks;
}
