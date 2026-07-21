import { handler } from '../dist/lambda.js';

// surface hidden SDK errors
process.on('unhandledRejection', e => console.error('UNHANDLED:', e?.stack || e));

const event = {
  rawPath: '/mcp',
  rawQueryString: 'store=test-tier-store',
  requestContext: { http: { method: 'POST' } },
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: 'Bearer sc_live_dummy',
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dbg', version: '1' } } }),
  isBase64Encoded: false,
};

// hook into Error creation to catch the TypeError origin
const OrigTE = globalThis.TypeError;
globalThis.TypeError = class extends OrigTE {
  constructor(...a) { super(...a); if (String(a[0]).includes('length')) console.error('TYPEERROR STACK:', this.stack); }
};

console.log(JSON.stringify(await handler(event), null, 2).slice(0, 800));
