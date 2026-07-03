import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import { listCategories, listTransactions, updateTransactions } from "./finary.js";

// Load .env locally. In production (Alpic) there's no file — env comes from the platform.
try {
	process.loadEnvFile();
} catch {
	/* no .env file — fine */
}

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Optional HTTP Basic Auth guarding /mcp. Unset → open (fine for local/tunnel use).
// Set MCP_BASIC_AUTH="user:pass" to require credentials when deployed publicly.
function basicAuth(req: IncomingMessage, res: ServerResponse, next: () => void) {
	const expected = process.env.MCP_BASIC_AUTH;
	if (!expected) return next();
	const [scheme, encoded] = String(req.headers.authorization ?? "").split(" ");
	if (
		scheme === "Basic" &&
		encoded &&
		safeEqual(Buffer.from(encoded, "base64").toString(), expected)
	) {
		return next();
	}
	res.statusCode = 401;
	res.setHeader("WWW-Authenticate", 'Basic realm="finary-mcp"');
	res.end("Unauthorized");
}

const server = new McpServer(
	{ name: "finary-mcp", version: "0.0.1" },
	{ capabilities: {} },
)
	.use("/mcp", basicAuth)
	.registerTool(
		{
			name: "list-transactions",
			description:
				"List Finary cashflow transactions over a date range. Dates are YYYY-MM-DD; " +
				"defaults to the current month when omitted.",
			inputSchema: {
				startDate: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/)
					.optional()
					.describe("Start date, YYYY-MM-DD"),
				endDate: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/)
					.optional()
					.describe("End date, YYYY-MM-DD"),
				page: z
					.number()
					.int()
					.positive()
					.optional()
					.describe("Page number for pagination"),
				perPage: z
					.number()
					.int()
					.positive()
					.max(500)
					.optional()
					.describe("Items per page (default 100)"),
				marked: z
					.boolean()
					.optional()
					.describe(
						"Filter by reconciled status: false = only unticked (à pointer), true = only ticked. Omit for all.",
					),
			},
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
				destructiveHint: false,
			},
			view: {
				component: "list-transactions",
				description: "Transactions list",
			},
		},
		async ({ startDate, endDate, page, perPage, marked }) => {
			const p = page ?? 1;
			const pp = perPage ?? 100;
			const transactions = await listTransactions({
				startDate,
				endDate,
				page: p,
				perPage: pp,
				marked,
			});
			const income = transactions
				.filter((t) => t.value > 0)
				.reduce((s, t) => s + t.value, 0);
			const expenses = transactions
				.filter((t) => t.value < 0)
				.reduce((s, t) => s + t.value, 0);
			const markedCount = transactions.filter((t) => t.marked).length;
			// Finary returns no pagination metadata, so infer: a full page likely has more.
			const hasMore = transactions.length === pp;
			const range =
				startDate || endDate
					? ` from ${startDate ?? "…"} to ${endDate ?? "…"}`
					: "";
			return {
				structuredContent: {
					transactions,
					count: transactions.length,
					markedCount, // "pointées" / ticked-reconciled
					totalIncome: Math.round(income * 100) / 100,
					totalExpenses: Math.round(expenses * 100) / 100,
					page: p,
					perPage: pp,
					hasMore,
					nextPage: hasMore ? p + 1 : null,
				},
				content: [
					{
						type: "text",
						text:
							`${transactions.length} transactions${range} (page ${p}). ` +
							`In: ${income.toFixed(2)}, out: ${expenses.toFixed(2)}; ${markedCount} ticked. ` +
							(hasMore
								? `A full page came back — more may exist; call again with page ${p + 1} (same dates & perPage). Totals above are for this page only.`
								: "Last page."),
					},
				],
			};
		},
	)
	.registerTool(
		{
			name: "list-categories",
			description:
				"List Finary transaction categories and subcategories with their IDs. Use an ID with " +
				"update-transactions. Subcategories are the usual assignment target.",
			inputSchema: {},
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
				destructiveHint: false,
			},
		},
		async () => {
			const categories = await listCategories();
			return {
				structuredContent: { categories },
				content: [{ type: "text", text: `${categories.length} categories.` }],
			};
		},
	)
	.registerTool(
		{
			name: "update-transactions",
			description:
				"Update one or more transactions in a single call: assign a category (from " +
				'list-categories), rename, and/or tick as reconciled ("Pointer la transaction"). ' +
				"Categorizing also ticks by default. Each item needs at least one field to change. " +
				"Requests run in batches of 10; one failing item doesn't stop the others. Reversible.",
			inputSchema: {
				updates: z
					.array(
						z.object({
							transactionId: z.number().int().describe("Transaction id"),
							categoryId: z
								.number()
								.int()
								.optional()
								.describe("Category id from list-categories"),
							name: z
								.string()
								.min(1)
								.optional()
								.describe("New display name (renames the transaction)"),
							marked: z
								.boolean()
								.optional()
								.describe("Tick/untick as reconciled; defaults to true when categorizing"),
						}),
					)
					.min(1)
					.max(200)
					.describe("Transactions to update (1–200)"),
			},
			annotations: {
				readOnlyHint: false,
				openWorldHint: false,
				destructiveHint: false,
			},
		},
		async ({ updates }) => {
			const bad = updates.findIndex(
				(u) => u.categoryId === undefined && u.name === undefined && u.marked === undefined,
			);
			if (bad !== -1) {
				throw new Error(
					`Update at index ${bad} (transaction ${updates[bad].transactionId}) has nothing to change — provide categoryId, name, or marked.`,
				);
			}
			// By design: categorizing also ticks the transaction, unless the caller overrides.
			const resolved = updates.map((u) => ({
				...u,
				marked: u.marked ?? (u.categoryId !== undefined ? true : undefined),
			}));
			const results = await updateTransactions(resolved);
			const ok = results.filter((r) => r.ok);
			const failed = results.filter((r) => !r.ok);
			return {
				structuredContent: {
					results: results.map((r) => ({
						transactionId: r.transactionId,
						ok: r.ok,
						name: r.transaction?.name ?? null,
						category: r.transaction?.category ?? null,
						marked: r.transaction?.marked ?? null,
						error: r.error ?? null,
					})),
					okCount: ok.length,
					failCount: failed.length,
				},
				content: [
					{
						type: "text",
						text:
							`Updated ${ok.length}/${results.length} transaction(s).` +
							(failed.length
								? ` ${failed.length} failed: ${failed.map((f) => f.transactionId).join(", ")}.`
								: ""),
					},
				],
			};
		},
	);

export default await server.run();

export type AppType = typeof server;
