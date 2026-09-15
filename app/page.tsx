"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ask, type AskResponse } from "./actions";

const SUBJECTS = [
  "Sci & Tech",
  "Social Studies",
  "History",
  "Art & Music",
  "Literature & Media",
  "Special Area",
];

// UI labels use short forms; retrieval filters on the full subject names.
const SUBJECT_FILTER: Record<string, string> = {
  "Sci & Tech": "Science & Technology",
  "Social Studies": "Social Studies",
  History: "History",
  "Art & Music": "Art & Music",
  "Literature & Media": "Literature & Media",
  "Special Area": "Special Area",
};

const EXAMPLES = [
  "What does the Special Area cover about memory?",
  "Which sections have the heaviest named-works lists?",
  "What is the keystone section this year?",
];

/** Render answer text, turning [n] into citation chips that jump to the source. */
function renderAnswer(text: string): ReactNode[] {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) {
      return (
        <a key={i} className="cite" href={`#s${m[1]}`}>
          {m[1]}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function kindLabel(kind: "fact-list" | "concept"): string {
  return kind === "fact-list" ? "Named works" : "Concept";
}

export default function Home() {
  const [question, setQuestion] = useState(EXAMPLES[0]);
  const [subject, setSubject] = useState<string | null>(null);
  const [asked, setAsked] = useState("");
  const [pending, setPending] = useState(false);
  const [resp, setResp] = useState<AskResponse | null>(null);
  const [themeLabel, setThemeLabel] = useState("Dark");

  useEffect(() => {
    setThemeLabel(isDark() ? "Light" : "Dark");
  }, []);

  function isDark() {
    const a = document.documentElement.getAttribute("data-theme");
    return a ? a === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function toggleTheme() {
    const next = isDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    setThemeLabel(next === "dark" ? "Light" : "Dark");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || pending) return;
    setAsked(q);
    setPending(true);
    setResp(null);
    try {
      const r = await ask({ question: q, subject: subject ? SUBJECT_FILTER[subject] : null });
      setResp(r);
    } catch {
      setResp({ ok: false, error: "Something went wrong. Please try again." });
    } finally {
      setPending(false);
    }
  }

  const result = resp?.ok ? resp.result : null;
  const grounded = result?.grounded ?? false;

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <span className="name">
            <span className="mark">?</span> Guiding Questions Assistant
          </span>
          <span className="tag">WSC 2026 syllabus · grounded answers with sources</span>
        </div>
        <button
          className="theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle colour theme"
        >
          {themeLabel}
        </button>
      </header>

      <p className="purpose">
        Ask about anything in this year&apos;s Guiding Questions and get a short answer tied to the
        exact section it came from. If the syllabus doesn&apos;t cover it, the assistant says so
        rather than guessing.
      </p>

      <div className="scope" role="group" aria-label="Limit to a subject area">
        <span className="lbl">Subject</span>
        <button
          className="pill"
          aria-pressed={subject === null}
          onClick={() => setSubject(null)}
        >
          All
        </button>
        {SUBJECTS.map((s) => (
          <button
            key={s}
            className="pill"
            aria-pressed={subject === s}
            onClick={() => setSubject(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <form className="ask" onSubmit={submit} autoComplete="off">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" />
        </svg>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-label="Ask about the 2026 syllabus"
          placeholder="Ask about the 2026 syllabus..."
        />
        <button type="submit" disabled={pending || !question.trim()}>
          {pending ? "Asking..." : "Ask"}
        </button>
      </form>

      <div className="examples">
        <span className="lbl">Try asking</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} className="ex" type="button" onClick={() => setQuestion(ex)}>
            {ex}
          </button>
        ))}
      </div>

      {pending && (
        <section className="result" aria-busy="true">
          <div className="r-head">
            <span className="status load">
              <span className="dot" /> Searching the syllabus notes
            </span>
          </div>
          <p className="q-echo">{asked}</p>
          <div className="sk sk-line" style={{ width: "94%" }} />
          <div className="sk sk-line" style={{ width: "99%" }} />
          <div className="sk sk-line" style={{ width: "88%" }} />
          <div className="sk sk-line" style={{ width: "62%" }} />
          <div className="sk sk-src" />
          <div className="sk sk-src" />
        </section>
      )}

      {!pending && resp && !resp.ok && (
        <section className="result">
          <p className="error">{resp.error}</p>
        </section>
      )}

      {!pending && result && grounded && (
        <section className="result">
          <div className="r-head">
            <span className="status ok">
              <span className="dot" /> Grounded
            </span>
            <span className="count">
              {result.sources.length} source{result.sources.length === 1 ? "" : "s"} cited
            </span>
          </div>
          <p className="q-echo">{asked}</p>
          <div className="answer">{renderAnswer(result.answer)}</div>

          {result.sources.length > 0 && (
            <div className="sources">
              <h2>Sources</h2>
              {result.sources.map((s) => (
                <article className="src" id={`s${s.n}`} key={s.n}>
                  <span className="n">{s.n}</span>
                  <div className="body">
                    <div className="brc">{s.breadcrumb}</div>
                    <div className="meta">
                      {s.subjects.map((subj) => (
                        <span className="badge subj" key={subj}>
                          {subj}
                        </span>
                      ))}
                      <span className="badge kind">{kindLabel(s.chunk_kind)}</span>
                    </div>
                    {s.source_url && (
                      <a
                        className="open"
                        href={s.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open source
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M7 17 17 7M9 7h8v8" />
                        </svg>
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {!pending && result && !grounded && (
        <section className="result">
          <div className="r-head">
            <span className="status no">
              <span className="dot" /> Not in the 2026 syllabus
            </span>
          </div>
          <p className="q-echo">{asked}</p>
          <div className="refuse-card">
            <p className="why">
              Nothing in the syllabus notes matched closely enough to answer from, so the assistant
              stops here rather than guessing. For anything outside the Guiding Questions, check the
              official pages at{" "}
              <a href="https://scholarscup.org" target="_blank" rel="noopener noreferrer">
                scholarscup.org
              </a>
              .
            </p>
            {result.topSimilarity < result.floor ? (
              <p className="note">
                Closest note scored <b>{result.topSimilarity.toFixed(2)}</b>, below the{" "}
                <b>{result.floor.toFixed(2)}</b> match threshold the assistant needs to answer.
              </p>
            ) : (
              <p className="note">
                The closest notes were retrieved but didn&apos;t actually cover this question, so
                the assistant declined rather than stretch them.
              </p>
            )}
          </div>
        </section>
      )}

      <footer>
        <span>
          Answers cite the source notes, and the assistant refuses when the syllabus doesn&apos;t
          cover the question.
        </span>
        <span>
          <a
            href="https://themes.scholarscup.org/#/themes/2026/guidingquestions"
            target="_blank"
            rel="noopener noreferrer"
          >
            Source of record
          </a>
        </span>
      </footer>
    </div>
  );
}
