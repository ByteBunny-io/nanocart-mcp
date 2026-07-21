import { Readable } from 'node:stream';
import { handleMcpRequest } from '../dist/http.js';

const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dbg', version: '1' } } });
const req = new Readable({ read() {} });
req.push(body); req.push(null);
req.method = 'POST';
req.url = '/mcp?store=test-tier-store';
req.headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer sc_live_dummy' };

const res = new Proxy({}, {
  get(_, prop) {
    if (prop === 'headersSent') return false;
    return (...args) => {
      console.error('RES CALL:', String(prop), JSON.stringify(args).slice(0, 200));
      if (prop === 'writeHead') return res;
      return true;
    };
  },
});

try {
  await handleMcpRequest(req, res, JSON.parse(body));
  console.error('handleMcpRequest returned');
} catch (e) {
  console.error('THREW:', e.stack);
}
setTimeout(() => process.exit(0), 1500);
