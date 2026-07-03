// Finary has no official API. This talks to the same private API the web app
// (app.finary.com) uses. Auth is Clerk: a long-lived httpOnly `__client` cookie
// mints short-lived (~60s) session JWTs, which authorize api.finary.com calls.
//
// The only secret you provide is that `__client` cookie value (see .env.example).

const CLERK_BASE = "https://clerk.finary.com";
const API_BASE = "https://api.finary.com";
const CLERK_QS = "__clerk_api_version=2025-11-10&_clerk_js_version=5.127.0";

// Clerk rotates the `__client` cookie via Set-Cookie on responses. We seed from
// env, then keep the freshest value in memory so a long-running process doesn't
// drift out of auth. (Not persisted — restart after a long gap → re-paste cookie.)
let clientCookie: string | undefined;

function requireClientCookie(): string {
  const c = clientCookie ?? process.env.FINARY_CLERK_CLIENT?.trim();
  if (!c) {
    throw new Error(
      "FINARY_CLERK_CLIENT is not set. Copy the `__client` cookie for clerk.finary.com " +
        "from your browser (DevTools → Application → Cookies) into your .env. See .env.example.",
    );
  }
  return c;
}

function clerkHeaders(): Record<string, string> {
  return {
    cookie: `__client=${requireClientCookie()}`,
    origin: "https://app.finary.com",
    "content-type": "application/x-www-form-urlencoded",
  };
}

/** Absorb a rotated `__client` cookie from a Clerk response, if present. */
function absorbRotation(res: Response): void {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const m = /^__client=([^;]+)/.exec(line);
    if (m && m[1] && m[1] !== "") clientCookie = m[1];
  }
}

/** Seconds-since-epoch expiry from a JWT `exp` claim (0 if unparseable). */
export function jwtExp(jwt: string): number {
  const part = jwt.split(".")[1];
  if (!part) return 0;
  try {
    const json = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof json.exp === "number" ? json.exp : 0;
  } catch {
    return 0;
  }
}

let sessionId: string | undefined;
let cachedToken: { jwt: string; expMs: number } | undefined;

async function getSessionId(): Promise<string> {
  if (sessionId) return sessionId;
  const res = await fetch(`${CLERK_BASE}/v1/client?${CLERK_QS}`, { headers: clerkHeaders() });
  absorbRotation(res);
  if (!res.ok) {
    throw new Error(`Clerk /client failed (${res.status}). The __client cookie is likely expired — refresh it.`);
  }
  const body = (await res.json()) as {
    response?: { last_active_session_id?: string; sessions?: { id: string }[] };
  };
  const id = body.response?.last_active_session_id ?? body.response?.sessions?.[0]?.id;
  if (!id) throw new Error("No active Finary/Clerk session found for this __client cookie.");
  sessionId = id;
  return id;
}

/** A valid Finary bearer token, minted+cached (re-minted ~5s before expiry). */
async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expMs) return cachedToken.jwt;
  const sid = await getSessionId();
  const res = await fetch(`${CLERK_BASE}/v1/client/sessions/${sid}/tokens?${CLERK_QS}`, {
    method: "POST",
    headers: clerkHeaders(),
  });
  absorbRotation(res);
  if (!res.ok) {
    sessionId = undefined; // force re-discovery next time (session may have rotated)
    throw new Error(`Clerk token mint failed (${res.status}). Refresh the __client cookie.`);
  }
  const { jwt } = (await res.json()) as { jwt?: string };
  if (!jwt) throw new Error("Clerk returned no jwt.");
  const exp = jwtExp(jwt);
  cachedToken = { jwt, expMs: exp ? exp * 1000 - 5000 : Date.now() + 45_000 };
  return jwt;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "x-client-api-version": "2",
      "x-finary-client-id": "webapp",
      "content-type": "application/json",
      ...(init?.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Finary API ${init?.method ?? "GET"} ${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// --- Account context (org + membership) -------------------------------------

let context: { orgId: string; membershipId: string } | undefined;

async function getContext(): Promise<{ orgId: string; membershipId: string }> {
  if (context) return context;
  if (process.env.FINARY_ORG_ID && process.env.FINARY_MEMBERSHIP_ID) {
    context = { orgId: process.env.FINARY_ORG_ID, membershipId: process.env.FINARY_MEMBERSHIP_ID };
    return context;
  }
  const [orgs, me] = await Promise.all([
    api<{ result: { id: string; members: { id: string; user: { email: string } }[] }[] }>(
      "/users/me/organizations",
    ),
    api<{ result: { email: string } }>("/users/me"),
  ]);
  const org = orgs.result[0];
  if (!org) throw new Error("No Finary organization found for this account.");
  const mine = org.members.find((m) => m.user?.email === me.result.email) ?? org.members[0];
  context = { orgId: org.id, membershipId: mine.id };
  return context;
}

function base(ctx: { orgId: string; membershipId: string }): string {
  return `/organizations/${ctx.orgId}/memberships/${ctx.membershipId}`;
}

// --- Domain shapes -----------------------------------------------------------

export type Transaction = {
  id: number;
  date: string;
  name: string;
  value: number;
  currency: string;
  marked: boolean; // "Pointer la transaction" — ticked/reconciled in Finary
  categoryId: number | null;
  category: string | null;
  account: string | null;
};

export type Category = {
  id: number;
  name: string;
  isSubcategory: boolean;
  isCustom: boolean;
  parentId: number | null;
  parentName: string | null;
};

// Raw API objects (only the fields we use).
type RawCategory = {
  id: number;
  name: string;
  is_custom: boolean;
  is_subcategory: boolean;
  main_category_id: number | null;
  subcategories?: RawCategory[];
};
type RawTransaction = {
  id: number;
  display_date: string;
  display_name: string;
  display_value: number;
  currency?: { code?: string };
  marked?: boolean;
  category?: { id: number; name: string } | null;
  subcategory?: { id: number; name: string } | null;
  account?: { display_name?: string } | null;
};

function normalizeTransaction(t: RawTransaction): Transaction {
  const cat = t.subcategory ?? t.category ?? null;
  return {
    id: t.id,
    date: t.display_date,
    name: t.display_name,
    value: t.display_value,
    currency: t.currency?.code ?? "EUR",
    marked: t.marked ?? false,
    categoryId: cat?.id ?? null,
    category: cat?.name ?? null,
    account: t.account?.display_name ?? null,
  };
}

/** Flatten Finary's nested categories into one list of assignable categories. */
export function flattenCategories(raw: RawCategory[]): Category[] {
  const out: Category[] = [];
  const walk = (nodes: RawCategory[], parent: RawCategory | null) => {
    for (const n of nodes) {
      out.push({
        id: n.id,
        name: n.name,
        isSubcategory: n.is_subcategory,
        isCustom: n.is_custom,
        parentId: parent?.id ?? n.main_category_id ?? null,
        parentName: parent?.name ?? null,
      });
      if (n.subcategories?.length) walk(n.subcategories, n);
    }
  };
  walk(raw, null);
  return out;
}

// --- Public operations -------------------------------------------------------

export async function listTransactions(opts: {
  startDate?: string;
  endDate?: string;
  page?: number;
  perPage?: number;
}): Promise<Transaction[]> {
  const ctx = await getContext();
  const qs = new URLSearchParams();
  if (opts.startDate) qs.set("start_date", opts.startDate);
  if (opts.endDate) qs.set("end_date", opts.endDate);
  qs.set("per_page", String(opts.perPage ?? 100));
  if (opts.page) qs.set("page", String(opts.page));
  const { result } = await api<{ result: RawTransaction[] }>(`${base(ctx)}/transactions?${qs}`);
  return result.map(normalizeTransaction);
}

export async function listCategories(): Promise<Category[]> {
  const ctx = await getContext();
  const { result } = await api<{ result: RawCategory[] }>(
    `${base(ctx)}/transaction_categories?included_in_analysis=true`,
  );
  return flattenCategories(result);
}

export async function setCategory(transactionId: number, categoryId: number): Promise<Transaction> {
  const ctx = await getContext();
  // By design: categorizing also ticks ("pointe") the transaction as reconciled.
  const { result } = await api<{ result: RawTransaction }>(`${base(ctx)}/transactions/${transactionId}`, {
    method: "PATCH",
    body: JSON.stringify({ category_id: categoryId, marked: true }),
  });
  return normalizeTransaction(result);
}
