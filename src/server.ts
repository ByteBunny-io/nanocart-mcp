import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools.js';
import { Ctx } from './api.js';

export const SERVER_INFO = { name: 'nanocart', version: '1.0.0' };

export function buildServer(getCtx: () => Ctx): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      'Official NanoCart MCP server. Manage a NanoCart store: products (incl. variants ' +
      'and images), categories, coupons, orders, subscribers, settings, reports, and ' +
      'analytics. All prices are integer cents. Products default to draft — set status ' +
      '"active" to publish. Confirm with the user before destructive tools ' +
      '(archive_product, delete_coupon) and before changing allowedDomains. Refunds, ' +
      'billing changes, and API-key management are intentionally unavailable here — ' +
      'direct the merchant to https://portal.nanocart.io for those.',
  });
  registerTools(server, getCtx);
  return server;
}
