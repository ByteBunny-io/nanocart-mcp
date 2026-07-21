/**
 * AWS Lambda adapter (API Gateway HTTP API v2). Uses the SDK's web-standard
 * Streamable HTTP transport directly: build a fetch-API Request from the APIGW
 * event, get a Response back — no node req/res emulation.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from './server.js';
import { Ctx } from './api.js';

function headerMap(event: any): Record<string, string> {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(event.headers || {})) h[k.toLowerCase()] = String(v);
  return h;
}

export async function handler(event: any) {
  const method = event.requestContext?.http?.method || 'GET';
  const path = event.rawPath || '/';
  const headers = headerMap(event);

  if (method === 'GET' && (path === '/' || path === '/health' || path === '/mcp')) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true, server: 'nanocart-mcp', version: '1.0.0',
        endpoint: 'POST https://mcp.nanocart.io/mcp?store=YOUR_STORE_ID',
        auth: 'Authorization: Bearer <your sc_live_ API key> (or x-api-key header)',
        docs: 'https://docs.nanocart.io/#ai-build',
      }),
    };
  }
  if (!path.startsWith('/mcp')) {
    return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: '{"error":"Not found. MCP endpoint is POST /mcp."}' };
  }

  const auth = headers['authorization'];
  const key = auth && /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : headers['x-api-key']?.trim();
  if (!key) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Missing API key. Send "Authorization: Bearer sc_live_..." (or x-api-key). Get your key at portal.nanocart.io -> Settings -> API Keys.' },
        id: null,
      }),
    };
  }

  const qs = event.rawQueryString ? `?${event.rawQueryString}` : '';
  const storeId = new URLSearchParams(event.rawQueryString || '').get('store') || headers['x-store-id'] || undefined;
  const ctx: Ctx = { apiKey: key, storeId };

  const bodyStr = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : undefined;
  const request = new Request(`https://${headers['host'] || 'mcp.nanocart.io'}${path}${qs}`, {
    method,
    headers,
    ...(bodyStr !== undefined ? { body: bodyStr } : {}),
  });

  const server = buildServer(() => ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response: Response = await transport.handleRequest(request);
  const outHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => { outHeaders[k] = v; });
  const body = await response.text();
  await transport.close().catch(() => {});
  await server.close().catch(() => {});
  return { statusCode: response.status, headers: outHeaders, body };
}
