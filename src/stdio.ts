import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';
import { Ctx } from './api.js';

const apiKey = process.env.NANOCART_API_KEY || '';
const storeId = process.env.NANOCART_STORE_ID || '';
if (!apiKey || !storeId) {
  console.error(
    'nanocart-mcp: NANOCART_API_KEY and NANOCART_STORE_ID are both required.\n' +
    'Find them at https://portal.nanocart.io -> Settings (API Keys + Store Information), then set\n' +
    '  NANOCART_API_KEY=sc_live_...\n' +
    '  NANOCART_STORE_ID=your-store-id\n' +
    'in the environment of your MCP client config.'
  );
  process.exit(1);
}
const ctx: Ctx = { apiKey, storeId };

const server = buildServer(() => ctx);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('nanocart-mcp: connected (stdio). Store: ' + ctx.storeId);
