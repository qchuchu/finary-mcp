# Finary MCP

A personal MCP server over Finary's **cashflow** feature. Finary has no official
API — this talks to the same private API the web app (`app.finary.com`) uses.

## Value proposition

From an AI assistant, over your own Finary account:
- Browse transactions for a date range (visual list).
- List categories (with IDs).
- (Re)categorize a transaction.

Single user (the account whose cookie is configured). Not multi-tenant.

## Authentication

**To Finary (Clerk):** Finary auth is handled by Clerk. A long-lived, httpOnly
`__client` cookie mints short-lived (~60s) session JWTs; those JWTs authorize
`api.finary.com` calls. The server:
1. Reads the `__client` cookie from `FINARY_CLERK_CLIENT` (see `.env.example`).
2. `GET clerk.finary.com/v1/client` → active session id.
3. `POST clerk.finary.com/v1/client/sessions/{sid}/tokens` → a JWT (cached until ~5s before its `exp`).
4. Absorbs any rotated `__client` from `Set-Cookie` so a long-running process stays authed.

The `__client` cookie is the only Finary secret. It lasts months; re-copy it if calls start 401ing.

**To this MCP server:** optional HTTP Basic Auth on `/mcp`, enabled by setting
`MCP_BASIC_AUTH=user:pass`. Off by default (fine for local dev / a private tunnel).
Turn it on before exposing the server publicly. Full OAuth is overkill for a
single-user personal server.

## UX Flows

List transactions:
1. Ask for transactions over a date range → visual list with amounts, dates, categories, totals.

Update a transaction (conversational):
1. (Optionally) list categories to find the target category id.
2. Update a transaction by id — categorize, rename, and/or tick it.

## Tools and Views

**View: list-transactions** — `readOnly`
- Input: `{ startDate?, endDate?, page?, perPage? }` (dates `YYYY-MM-DD`; default current month)
- Output: `{ transactions[], count, markedCount, totalIncome, totalExpenses }`
- Each transaction: `{ id, date, name, value, currency, marked, categoryId, category, account }`.
  `marked` = the "Pointer la transaction" toggle (French *pointer*: ticked/reconciled).
- View: inline list (top 8) with income/expense totals and a per-row ticked/not-ticked dot; expands to fullscreen for the full list.

**Tool: list-categories** — `readOnly`
- Input: `{}`
- Output: `{ categories[] }` — flattened main + subcategories, each `{ id, name, isSubcategory, isCustom, parentId, parentName }`.

**Tool: update-transaction** — writes, reversible
- Input: `{ transactionId: number, categoryId?: number, name?: string, marked?: boolean }` (at least one mutable field)
- Behavior: `name` renames (maps to `display_name`); categorizing defaults `marked` to true unless overridden.
- Output: `{ transaction }` — the updated transaction.

## Finary private API reference

Base: `https://api.finary.com`. Headers on every call:
`Authorization: Bearer <jwt>`, `x-client-api-version: 2`, `x-finary-client-id: webapp`.
Account context path: `/organizations/{orgId}/memberships/{membershipId}`
(auto-derived from `GET /users/me/organizations` + `GET /users/me`).

- `GET  {ctx}/transactions?start_date=&end_date=&per_page=&page=` → `{ result: Transaction[] }`
- `GET  {ctx}/transaction_categories?included_in_analysis=true` → `{ result: Category[] }` (nested subcategories)
- `PUT {ctx}/transactions/{id}` body `{ "custom_subcategory_id"?, "display_name"?, "marked"? }` → `{ result: Transaction }`
  - `custom_subcategory_id` assigns the category — accepts a **main-category or subcategory** id (35 = "unknown"/uncategorized). This is the field the web app uses.
  - `display_name` renames; `marked` ticks. One PUT can carry all three.
  - ⚠️ `PATCH` and `category_id` are silently ignored for category — must be `PUT` + `custom_subcategory_id`.

A transaction's assigned category is `subcategory` (falls back to `category`).
`category_id` accepts either a main-category or subcategory id. The `marked`
boolean is the "Pointer la transaction" toggle (ticked/reconciled).

## Environment

See `.env.example`. `FINARY_CLERK_CLIENT` (required), `MCP_BASIC_AUTH` (optional),
`FINARY_ORG_ID` / `FINARY_MEMBERSHIP_ID` (optional overrides).

## Run

- Local: `npm run dev` → server at `http://localhost:3000/mcp`, DevTools at `http://localhost:3000`.
- Connect a client: `npm run dev:tunnel` (Alpic tunnel), add the `{url}/mcp` as a custom connector.
- Deploy: `npm run deploy` (Alpic). Set env vars in the Alpic project — do NOT ship `.env`.
