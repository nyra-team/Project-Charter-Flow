/**
 * Generic HTTP MCP server tester.
 *
 * Speaks the Model Context Protocol JSON-RPC initialize handshake over a
 * single POST to the server's MCP endpoint, then reads back the protocol
 * version + server info that comes back in the response. This is the same
 * call any MCP client makes as its first message, so a successful
 * handshake means the credential pasted by the admin works end-to-end.
 *
 * Auth flavors supported via `authStyle`:
 *   - "none"   — no auth header
 *   - "bearer" — Authorization: Bearer <authToken>
 *   - "header" — <authHeaderName>: <authToken>  (e.g. for x-api-key style)
 */

export interface McpHttpConfig {
  endpoint: string;          // e.g. https://mcp.example.com/mcp
  authStyle?: "none" | "bearer" | "header";
  authHeaderName?: string;   // only used when authStyle === "header"
  authToken?: string;        // secret
}

export interface McpHttpInfo {
  protocolVersion: string;
  serverName: string | null;
  serverVersion: string | null;
}

function buildHeaders(cfg: McpHttpConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const style = cfg.authStyle ?? "none";
  if (style === "bearer" && cfg.authToken) {
    headers.Authorization = `Bearer ${cfg.authToken}`;
  } else if (style === "header" && cfg.authHeaderName && cfg.authToken) {
    headers[cfg.authHeaderName] = cfg.authToken;
  }
  return headers;
}

export async function mcpHttpTestConnection(cfg: McpHttpConfig): Promise<McpHttpInfo> {
  if (!cfg.endpoint) throw new Error("endpoint is required");
  let res: Response;
  try {
    res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: buildHeaders(cfg),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "pmo-connector-test", version: "0.1.0" },
        },
      }),
    });
  } catch (err) {
    throw new Error(`Network error reaching ${cfg.endpoint}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MCP server returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  // MCP can stream over SSE or return plain JSON; for the initialize call,
  // most servers respond with a single JSON object even when SSE is offered.
  const text = await res.text();
  // Pull out the JSON-RPC envelope; if the server sent SSE-style frames,
  // grab the first `data:` line.
  let payload: { result?: { protocolVersion?: string; serverInfo?: { name?: string; version?: string } }; error?: { message?: string } };
  try {
    const dataLine = text.split(/\r?\n/).find(l => l.startsWith("data:"));
    const jsonStr = dataLine ? dataLine.slice(5).trim() : text;
    payload = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Could not parse MCP response: ${text.slice(0, 200)}`);
  }
  if (payload.error) {
    throw new Error(`MCP initialize failed: ${payload.error.message ?? "unknown error"}`);
  }
  const result = payload.result;
  if (!result) throw new Error("MCP response missing `result`");
  return {
    protocolVersion: result.protocolVersion ?? "unknown",
    serverName: result.serverInfo?.name ?? null,
    serverVersion: result.serverInfo?.version ?? null,
  };
}
