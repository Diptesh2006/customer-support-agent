import { describe, it, expect, vi } from 'vitest';
import { formatMcpClientConfig, createMcpTools } from '../src/mcp.js';
import type { nRouter } from '@nrouter_ai/sdk';

describe('mcp module', () => {
  it('formats client config for Claude Desktop and Cursor', () => {
    const config = formatMcpClientConfig('my-server', 'sk-nrouter-sample');
    expect(config.claudeDesktop.mcpServers['my-server']).toBeDefined();
    expect(config.claudeDesktop.mcpServers['my-server']!.args).toContain('https://api.nrouter.ai/mcp/my-server');
    expect(config.claudeDesktop.mcpServers['my-server']!.env.NROUTER_API_KEY).toBe('sk-nrouter-sample');

    expect(config.cursor.url).toBe('https://api.nrouter.ai/mcp/my-server');
    expect(config.cursor.headers.Authorization).toBe('Bearer sk-nrouter-sample');
  });

  it('creates MCP agent tools that execute via SDK NRouterMCP', async () => {
    const fakeClient = {
      nr: {
        request: vi.fn().mockImplementation(async (opts: any) => {
          if (opts.path?.includes('/tools/call')) {
            return {
              status: 200,
              contentType: 'application/json',
              text: JSON.stringify({ result: { content: [{ type: 'text', text: 'call success' }] } }),
              headers: { get: () => null },
            };
          }
          // list
          return {
            status: 200,
            contentType: 'application/json',
            text: JSON.stringify({
              result: {
                tools: [
                  { name: 'query_db', description: 'Query database', inputSchema: {} },
                ],
              },
            }),
            headers: { get: () => null },
          };
        }),
      },
    } as unknown as nRouter;

    const tools = createMcpTools(fakeClient);
    expect(tools).toHaveLength(3);

    const listTool = tools.find(t => t.definition.function.name === 'mcp_list_tools');
    expect(listTool).toBeDefined();

    const listResult: any = await listTool!.execute({ serverId: 'db-server' }, {} as any);
    expect(listResult.status).toBe('ok');
    expect(listResult.count).toBe(1);
    expect(listResult.tools[0].name).toBe('query_db');

    const callTool = tools.find(t => t.definition.function.name === 'mcp_call_tool');
    expect(callTool).toBeDefined();

    const callResult: any = await callTool!.execute({ serverId: 'db-server', toolName: 'query_db' }, {} as any);
    expect(callResult.status).toBe('ok');

    const configTool = tools.find(t => t.definition.function.name === 'mcp_client_config');
    expect(configTool).toBeDefined();

    const configResult: any = await configTool!.execute({ serverName: 'analytics' }, {} as any);
    expect(configResult.status).toBe('ok');
    expect(configResult.config.cursor.url).toContain('/mcp/analytics');
  });

  it('handles MCP error responses gracefully without throwing', async () => {
    const fakeClient = {
      nr: {
        request: vi.fn().mockRejectedValue(new Error('Gateway 503 unavailable')),
      },
    } as unknown as nRouter;

    const tools = createMcpTools(fakeClient);
    const listTool = tools.find(t => t.definition.function.name === 'mcp_list_tools')!;
    const res: any = await listTool.execute({}, {} as any);
    expect(res.status).toBe('error');
    expect(res.message).toContain('Gateway 503');
  });
});
