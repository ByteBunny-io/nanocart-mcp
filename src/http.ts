/**
 * Stateless Streamable-HTTP entry — runs standalone (node dist/http.js) and is the
 * core the Lambda adapter wraps. Auth: Authorization: Bearer sc_live_... or x-api-key.
 */
import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './server.js';
import { Ctx } from './api.js';

export function extractKey(headers: Record<string, string | string[] | undefined>): string | null {
  const h = (n: string) => {
    const v = headers[n] ?? headers[n.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const auth = h('authorization');
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  const xk = h('x-api-key');
  return xk ? String(xk).trim() : null;
}

export function extractStoreId(req: any): string | undefined {
  try {
    const u = new URL(req.url || '/', 'http://x');
    const q = u.searchParams.get('store');
    if (q) return q;
  } catch { /* ignore */ }
  const h = req.headers?.['x-store-id'];
  return h ? String(Array.isArray(h) ? h[0] : h) : undefined;
}

export async function handleMcpRequest(req: any, res: any, parsedBody?: unknown) {
  const key = extractKey(req.headers || {});
  if (!key) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Missing API key. Send "Authorization: Bearer sc_live_..." (or x-api-key). Get your key at portal.nanocart.io -> Settings -> API Keys.' },
      id: null,
    }));
    return;
  }
  const ctx: Ctx = { apiKey: key, storeId: extractStoreId(req) };
  const server = buildServer(() => ctx);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}

const PORT = Number(process.env.PORT || 0);
if (PORT) {
  createServer(async (req, res) => {
    const url = req.url || '/';
    if (req.method === 'GET' && (url === '/' || url === '/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, server: 'nanocart-mcp', endpoint: '/mcp', docs: 'https://docs.nanocart.io/#ai-build' }));
      return;
    }
    if (url.startsWith('/mcp')) {
      try { await handleMcpRequest(req, res); } catch (e) {
        if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); }
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. MCP endpoint is POST /mcp.' }));
  }).listen(PORT, () => console.error(`nanocart-mcp: http listening on :${PORT}/mcp`));
}
