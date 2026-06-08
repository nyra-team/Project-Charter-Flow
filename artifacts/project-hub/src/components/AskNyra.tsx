import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles, X, Send, ChevronDown, Database, AlertCircle, RotateCcw, ArrowUp } from "lucide-react";
import { api } from "../lib/extra-api";
import { useAiStatus } from "./ai-button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Ask NYRA — floating conversational analyst for the Project Hub.
// Mirrors the CXO dashboard's NYRA: agentic text-to-SQL over the live PMO
// portfolio (POST /api/ai/ask), with a collapsible "view query & data" trace.
// ---------------------------------------------------------------------------

type QueryRun = {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  error?: string;
};
type ChatMsg = { role: "user" | "assistant"; content: string; queries?: QueryRun[] };

/** Fired by the sidebar "Ask NYRA" nav item to open the chat panel. */
export const ASK_NYRA_OPEN_EVENT = "ask-nyra:open";
export function openAskNyra() {
  window.dispatchEvent(new Event(ASK_NYRA_OPEN_EVENT));
}

const GREETING: ChatMsg = {
  role: "assistant",
  content:
    "Hi — I'm **NYRA**, your Project Hub analyst. I query the live portfolio and answer with real numbers.\n\nTry: *“Which projects are amber or red?”*, *“How many tasks are overdue, by project?”*, or *“Show milestones due this month.”*",
};

const SUGGESTIONS = [
  "Projects at risk (amber/red)",
  "Overdue tasks by project",
  "Portfolio status breakdown",
  "Milestones due this month",
];

export function AskNyra() {
  const status = useAiStatus();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  // Opened from the sidebar nav item (Layout dispatches `ask-nyra:open`).
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(ASK_NYRA_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASK_NYRA_OPEN_EVENT, onOpen);
  }, []);

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const next: ChatMsg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await api.post<{ reply: string; queries?: QueryRun[] }>("/api/ai/ask", {
        messages: next
          .filter((m) => m !== GREETING)
          .map((m) => ({ role: m.role, content: m.content })),
        context: { path: window.location.pathname },
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.reply || "(no response)", queries: res.queries },
      ]);
    } catch (e: unknown) {
      const msg =
        (e as Error & { body?: { error?: string } })?.body?.error ??
        (e as Error)?.message ??
        "NYRA request failed";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ ${msg}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  // Nothing to render until opened from the nav; also stays inert when AI
  // isn't configured (the nav item hides itself in that case too).
  if (!open || (status && !status.configured)) return null;

  const resetChat = () => setMessages([GREETING]);
  const showSuggestions = messages.length <= 1 && !busy;

  return (
    <div
      className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-[60] flex h-[680px] max-h-[calc(100dvh-2rem)] w-[420px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[22px] border border-border/60 bg-card/95 backdrop-blur-xl shadow-[0_24px_70px_-15px_rgba(0,0,0,0.45)] ring-1 ring-black/5 animate-in fade-in slide-in-from-bottom-4 zoom-in-95 duration-300 ease-out"
    >
      {/* Header — gradient banner */}
      <div className="relative shrink-0 overflow-hidden bg-[linear-gradient(120deg,hsl(var(--primary)),#0ea5e9_50%,#6366f1)] px-4 py-3.5 text-white">
        <span aria-hidden className="pointer-events-none absolute -right-6 -top-10 h-28 w-28 rounded-full bg-white/15 blur-2xl" />
        <span aria-hidden className="pointer-events-none absolute -left-4 bottom-0 h-16 w-16 rounded-full bg-white/10 blur-xl" />
        <div className="relative flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30 backdrop-blur-sm">
              <Sparkles className="h-4 w-4" />
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-400" />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-1.5 text-[15px] font-bold tracking-tight">NYRA</div>
              <div className="-mt-0.5 text-[11px] font-medium text-white/75">Project Hub Analyst · live data</div>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={resetChat}
              title="New conversation"
              aria-label="New conversation"
              className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto scrollbar-thin bg-gradient-to-b from-muted/20 to-transparent px-4 py-4">
        {messages.map((m, i) => (
          <ChatBubble key={i} msg={m} />
        ))}
        {busy && <TypingIndicator />}
        {showSuggestions && (
          <div className="space-y-1.5 pt-1">
            <div className="px-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              Suggested
            </div>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="group flex items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-left text-[12.5px] font-medium text-foreground/80 hover:border-primary/40 hover:bg-primary/5 hover:text-foreground transition-all"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary/70 group-hover:text-primary" />
                  <span className="flex-1">{s}</span>
                  <ArrowUp className="h-3.5 w-3.5 rotate-45 text-muted-foreground/0 group-hover:text-primary/70 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border/60 bg-card/80 px-3 pb-2.5 pt-2.5">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-background px-3 py-2 shadow-sm transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Ask about projects, tasks, risks…"
            className="max-h-28 flex-1 resize-none bg-transparent py-1 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(120deg,hsl(var(--primary)),#0ea5e9)] text-white shadow-md shadow-primary/25 transition hover:brightness-110 disabled:opacity-30 disabled:shadow-none"
            aria-label="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1.5 px-1 text-center text-[10px] text-muted-foreground">
          NYRA reads live portfolio data · verify critical figures
        </p>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2">
      <NyraAvatar />
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm border border-border/60 bg-card px-3 py-2.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60" />
      </div>
    </div>
  );
}

function NyraAvatar() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(120deg,hsl(var(--primary)),#6366f1)] text-white shadow-sm">
      <Sparkles className="h-3.5 w-3.5" />
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMsg }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[linear-gradient(120deg,hsl(var(--primary)),#0ea5e9)] px-3.5 py-2 text-[13px] leading-relaxed text-white shadow-sm shadow-primary/20">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <NyraAvatar />
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-border/60 bg-card px-3.5 py-2.5 shadow-sm">
        <Markdown content={msg.content} />
        {msg.queries && msg.queries.length > 0 && <QueryTrace queries={msg.queries} />}
      </div>
    </div>
  );
}

function QueryTrace({ queries }: { queries: QueryRun[] }) {
  const [show, setShow] = useState(false);
  return (
    <div className="mt-0.5">
      <button
        onClick={() => setShow((s) => !s)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <Database className="h-3 w-3" />
        {queries.length} quer{queries.length === 1 ? "y" : "ies"} run
        <ChevronDown className={cn("h-3 w-3 transition-transform", show && "rotate-180")} />
      </button>
      {show && (
        <div className="mt-1.5 space-y-2">
          {queries.map((q, i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-border bg-muted/40">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words px-2.5 py-2 text-[10.5px] leading-snug text-foreground/80 font-mono">
                {q.sql}
              </pre>
              {q.error ? (
                <div className="flex items-start gap-1.5 border-t border-border bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-600">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  {q.error}
                </div>
              ) : (
                <div className="border-t border-border px-2.5 py-1 text-[10.5px] text-muted-foreground">
                  {q.rowCount} row{q.rowCount === 1 ? "" : "s"}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimal GFM-subset markdown renderer (bold/italic/code/links + headings,
// lists, blockquotes, fenced code, and pipe tables). Self-contained so we
// don't pull react-markdown into this catalog workspace.
// ---------------------------------------------------------------------------
function Markdown({ content }: { content: string }) {
  return (
    <div className="text-[13px] leading-relaxed text-foreground [overflow-wrap:anywhere]">
      {renderBlocks(content)}
    </div>
  );
}

function renderBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines
    if (!line.trim()) { i++; continue; }

    // Fenced code
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      out.push(
        <pre key={key++} className="my-2 overflow-x-auto rounded-lg bg-foreground/90 p-2.5 text-[11px] leading-snug text-background font-mono">
          {buf.join("\n")}
        </pre>,
      );
      continue;
    }

    // Heading
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = h[1].length;
      const cls = lvl === 1 ? "text-[15px]" : lvl === 2 ? "text-[14px]" : "text-[13px]";
      out.push(
        <p key={key++} className={cn("mt-2.5 mb-1 font-semibold text-foreground first:mt-0", cls)}>
          {renderInline(h[2])}
        </p>,
      );
      i++;
      continue;
    }

    // Table (header row + separator)
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(
        <div key={key++} className="my-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-[12px] leading-snug">
            <thead className="bg-muted/60">
              <tr>
                {header.map((c, ci) => (
                  <th key={ci} className="border-b border-border px-2 py-1.5 text-left align-top font-semibold text-foreground/80">
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="even:bg-muted/30">
                  {r.map((c, ci) => (
                    <td key={ci} className="border-b border-border/60 px-2 py-1.5 align-top">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(
        <blockquote key={key++} className="my-2 border-l-2 border-border pl-2.5 text-foreground/70">
          {renderInline(buf.join(" "))}
        </blockquote>,
      );
      continue;
    }

    // Lists (consecutive ordered or unordered items)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      const ListTag = ordered ? "ol" : "ul";
      out.push(
        <ListTag key={key++} className={cn("my-1.5 space-y-1 pl-5", ordered ? "list-decimal" : "list-disc", "marker:text-muted-foreground")}>
          {items.map((it, ii) => (
            <li key={ii} className="leading-snug">{renderInline(it)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    // Paragraph (gather until blank line / block start)
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s|>\s?|```|\s*([-*]|\d+\.)\s+)/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-"))
    ) {
      buf.push(lines[i++]);
    }
    out.push(
      <p key={key++} className="my-1.5 first:mt-0 last:mb-0">{renderInline(buf.join(" "))}</p>,
    );
  }
  return out;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

// Inline: **bold**, *italic*, `code`, [text](url)
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) nodes.push(<strong key={key++} className="font-semibold text-foreground">{m[2]}</strong>);
    else if (m[3] !== undefined) nodes.push(<em key={key++} className="italic">{m[3]}</em>);
    else if (m[4] !== undefined) nodes.push(<code key={key++} className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono">{m[4]}</code>);
    else if (m[5] !== undefined) nodes.push(<a key={key++} href={m[6]} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{m[5]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
