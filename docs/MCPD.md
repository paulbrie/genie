# MCP Browser Server (genie-browser)

The genie-browser MCP gives VPS agents the ability to interact with a real browser running on the user's local machine. It exposes tools like clicking, typing, navigating, and reading page content via the Model Context Protocol.

## Architecture

```
VPS (Claude agent)
  │
  │  HTTP request to http://127.0.0.1:9877/mcp
  │
  ▼
Reverse SSH tunnel (port 9877)
  │
  │  Forwarded back to local machine
  │
  ▼
Local MCP HTTP server (random port, 127.0.0.1)
  │
  │  WebSocket message
  │
  ▼
Chrome extension (executes DOM actions in the browser)
  │
  │  Result flows back up the chain
  │
  ▼
VPS agent receives result
```

## Components

### 1. MCP Browser Server (`packages/manager/src/vps/mcp-browser-server.ts`)

A local HTTP server implementing JSON-RPC 2.0 over HTTP. Binds to `127.0.0.1` on a random port. Translates MCP tool calls into DOM actions dispatched to the Chrome extension.

**Available tools:**

| Tool | Description | Parameters |
|------|-------------|------------|
| `browser_get_snapshot` | Get accessibility tree of current page | — |
| `browser_click` | Click an element | `selector` |
| `browser_type` | Type text into an input | `selector`, `value` |
| `browser_select` | Select dropdown option | `selector`, `value` |
| `browser_scroll` | Scroll page or element | `selector?`, `direction`, `amount?` |
| `browser_read_text` | Read text content | `selector` |
| `browser_read_attr` | Read HTML attribute | `selector`, `attribute` |
| `browser_navigate` | Navigate to URL | `url` |
| `browser_wait_for` | Wait for element to appear | `selector`, `timeout?` |

### 2. MCP Tunnel (`packages/manager/src/vps/mcp-tunnel.ts`)

Creates a reverse SSH tunnel from the VPS back to the local MCP server. The VPS binds port 9877, and all connections to that port are forwarded through SSH to the local MCP HTTP server.

### 3. Persistent Tunnel Manager (`packages/manager/src/ws-server.ts`)

When the Chrome extension connects, `setupPersistentMcpTunnel` is called. It:
1. Finds a project with a VPS
2. Opens an SSH connection
3. Starts the local MCP server bound to the extension's WebSocket
4. Sets up the reverse tunnel on port 9877
5. Merges the `genie-browser` entry into the VPS `.mcp.json`

One tunnel is maintained per user. Reconnecting the extension tears down and recreates the tunnel.

## Deployment

During VPS deployment (`packages/manager/src/vps/deploy-service.ts`), a `.mcp.json` is automatically written to `/opt/project/` with the genie-browser entry:

```json
{
  "mcpServers": {
    "genie-browser": {
      "type": "http",
      "url": "http://127.0.0.1:9877/mcp"
    }
  }
}
```

This happens for every deploy (both DigitalOcean auto-provision and manual SSH deploy), so the VPS is pre-configured before the tunnel is even established. Once the Chrome extension connects and the tunnel is live, the agent can immediately use browser tools.

## Data Flow

1. **Deploy** — `.mcp.json` written to VPS with `genie-browser` pointing to `127.0.0.1:9877`
2. **Extension connects** — Manager starts local MCP server, opens reverse SSH tunnel on port 9877
3. **Agent calls tool** — HTTP POST to `http://127.0.0.1:9877/mcp` with JSON-RPC payload
4. **Tunnel forwards** — Request travels through SSH to the local MCP server
5. **Extension executes** — MCP server dispatches DOM action to Chrome extension via WebSocket
6. **Result returns** — Extension sends result back through the same chain
