# finary-mcp

An unofficial [MCP](https://modelcontextprotocol.io/) server over [Finary](https://finary.com)'s
**cashflow** feature, built with [Skybridge](https://docs.skybridge.tech). Browse and
categorize your transactions from an AI assistant (Claude, ChatGPT).

> Finary has no official API. This talks to the same private API the web app uses.
> Personal use, your own account. No affiliation with Finary.

## Tools

| Tool | Kind | What it does |
|------|------|--------------|
| `list-transactions` | view | Transactions over a date range — visual list with income/expense totals and a ticked/not-ticked marker per row. |
| `list-categories` | tool | All categories & subcategories with their IDs. |
| `update-transaction` | tool | Assign a category, rename, and/or tick a transaction as reconciled ("Pointer la transaction"). Categorizing also ticks it by default. |

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in FINARY_CLERK_CLIENT (see .env.example for how)
pnpm run dev            # server at http://localhost:3000/mcp, DevTools at http://localhost:3000
```

Connect a client with `npm run dev:tunnel` and add `{tunnel-url}/mcp` as a custom connector.

### Add to Claude Code

Replace `YOUR-MCP-URL` with your deployment (or tunnel) host. The `Authorization` header is
only needed if you set `MCP_BASIC_AUTH=user:pass` on the server — the value is the base64 of
that same `user:pass`.

```bash
claude mcp add --transport http finary https://YOUR-MCP-URL/mcp \
  --header "Authorization: Basic $(printf '%s' 'USER:PASSWORD' | base64)"
```

Or in `.mcp.json` (project) / `~/.claude.json` (user):

```json
{
  "mcpServers": {
    "finary": {
      "type": "http",
      "url": "https://YOUR-MCP-URL/mcp",
      "headers": {
        "Authorization": "Basic <base64 of USER:PASSWORD>"
      }
    }
  }
}
```

Drop the `--header` flag / `headers` block if `MCP_BASIC_AUTH` is unset.

### Authentication

The only secret is your Finary Clerk `__client` cookie — the server uses it to mint the
short-lived tokens each API call needs. See [`.env.example`](.env.example) for how to copy
it. Optionally protect the `/mcp` endpoint with HTTP Basic Auth (`MCP_BASIC_AUTH=user:pass`).

## Design & API notes

See [`SPEC.md`](SPEC.md) for the auth flow, the reverse-engineered Finary endpoints, and the
data shapes.

## Deploy

`npm run deploy` (Alpic). Set env vars in the platform — never ship `.env`.

## License

MIT
