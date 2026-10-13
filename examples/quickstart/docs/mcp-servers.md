# MCP Servers Management through nRouter

nRouter provides a unified data-plane and control-plane for managing Model Context Protocol (MCP) servers. Rather than distributing raw upstream server credentials to individual developer machines or applications, organizations manage MCP servers centrally through nRouter.

## MCP Hub (`/[org]/mcp-hub`)

The MCP Hub in the dashboard is the authoritative registry for all organization MCP servers:
- **Server Registration:** Add SSE or HTTP streaming MCP servers with name, upstream URL, and optional bearer authentication tokens.
- **Automated Test Probes:** Every MCP server can be probed on-demand via the dashboard or API using an automated `tools/list` probe to verify upstream liveness and schema validity.
- **Credential Stripping & Protection:** Upstream server secrets are encrypted at rest and never exposed back to client responses, browser devtools, or public logs.
- **Audit Logging:** Every server creation, update, test probe, and deletion is recorded in immutable audit logs.

## Gateway Reverse Proxy (`/mcp`)

nRouter exposes a secure, high-throughput reverse proxy for all registered MCP servers:
- **Endpoint:** `https://api.nrouter.ai/mcp/{server_id}` or `https://api.nrouter.ai/mcp/{server_name}`.
- **Authentication:** Clients authenticate with an nRouter virtual key (`Authorization: Bearer sk-nrouter-...`).
- **Tenant Isolation:** The proxy verifies tenant boundaries, rate limits, and credit reservations before forwarding any tool invocations.
- **Header Sanitization:** Upstream headers and client request headers are sanitized to eliminate credential leaks.

## Guardrails

Configure request and response protections from the dashboard's **Guardrails** page. nRouter supports Presidio PII detection/redaction, regex rules, keyword blocklists, prompt-injection detection, and custom webhook checks. Choose pre-call or post-call mode and an action: Block, Redact, Warn, or Log.

- Use **Templates** for common setups such as PII redaction and prompt-injection detection.
- Open a guardrail's **Test** tab to try sample input before applying it to live traffic.
- Use **Versions** to review changes and roll back if needed.
- View evaluations under **Guardrails → Logs**. Assign rules to individual keys under **Guardrails → Keys**; organization guardrails are managed on the main Guardrails page.
- Owners and admins can create, edit, delete, and roll back guardrails. Any organization member can view and test them.

For the full guide, see [nRouter Guardrails](https://nrouter.ai/docs/guides/guardrails). The **MCP Hub** manages MCP server connections; it is a separate dashboard area from **Guardrails**.

## Client Configuration (Claude Desktop & Cursor)

Connecting AI tools to company MCP servers through nRouter is simple and uniform. Configure `claude_desktop_config.json` or Cursor MCP settings:

```json
{
  "mcpServers": {
    "company-tools": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-fetch",
        "https://api.nrouter.ai/mcp/company-tools"
      ],
      "env": {
        "NROUTER_API_KEY": "sk-nrouter-your-key-here"
      }
    }
  }
}
```

Or for direct HTTP SSE clients:
- **URL:** `https://api.nrouter.ai/mcp/{server_name}`
- **Headers:** `{"Authorization": "Bearer sk-nrouter-..."}`

## Plan limits

Do not assume a fixed MCP server quota from the plan name. Check the current [nRouter pricing page](https://nrouter.ai/pricing) and the signed-in dashboard for the limits that apply to your organization.
