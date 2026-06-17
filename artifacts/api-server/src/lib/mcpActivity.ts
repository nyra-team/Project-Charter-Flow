// In-memory tracker of PMO MCP (service-token "act-as") write activity, for the
// Connectors status card. Resets on api-server restart — surfaced as "since
// service start". No DB/schema cost; a status indicator doesn't need durability.

type ActorStat = { code: string; name: string; count: number; last: string };

const byActor = new Map<string, ActorStat>();
let total = 0;
let lastActivity: { actor: string; name: string; method: string; path: string; at: string } | null = null;
const bootAt = new Date().toISOString();

/** Record one MCP-attributed write (called from requireAuth's service path). */
export function recordMcpWrite(code: string | null, name: string | null, method: string, path: string): void {
  total++;
  const at = new Date().toISOString();
  const display = name ?? code ?? "unknown";
  lastActivity = { actor: code ?? "?", name: display, method, path, at };
  const key = code ?? display;
  const cur = byActor.get(key) ?? { code: code ?? "?", name: display, count: 0, last: at };
  cur.count++;
  cur.last = at;
  cur.name = display;
  byActor.set(key, cur);
}

export function getMcpActivity() {
  return {
    bootAt,
    total,
    lastActivity,
    actors: [...byActor.values()].sort((a, b) => b.count - a.count),
  };
}
