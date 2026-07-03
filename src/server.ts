import { timingSafeEqual } from "node:crypto";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import { listCategories, listTransactions, setCategory } from "./finary.js";

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
// deno-lint-ignore no-explicit-any
function basicAuth(req: any, res: any, next: () => void) {
	const expected = process.env.MCP_BASIC_AUTH;
	if (!expected) return next();
	const [scheme, encoded] = String(req.headers?.authorization ?? "").split(" ");
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
		async ({ startDate, endDate, page, perPage }) => {
			const transactions = await listTransactions({
				startDate,
				endDate,
				page,
				perPage,
			});
			const income = transactions
				.filter((t) => t.value > 0)
				.reduce((s, t) => s + t.value, 0);
			const expenses = transactions
				.filter((t) => t.value < 0)
				.reduce((s, t) => s + t.value, 0);
			const markedCount = transactions.filter((t) => t.marked).length;
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
				},
				content: [
					{
						type: "text",
						text:
							`${transactions.length} transactions${range}. In: ${income.toFixed(2)}, out: ${expenses.toFixed(2)}. ` +
							`${markedCount} ticked (pointées), ${transactions.length - markedCount} not.`,
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
				"categorize-transaction. Subcategories are the usual assignment target.",
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
			name: "categorize-transaction",
			description:
				"Assign a category to a transaction (from list-categories) and tick it as reconciled " +
				'("Pointer la transaction"). Reversible — just re-assign to change the category.',
			inputSchema: {
				transactionId: z.number().int().describe("Transaction id"),
				categoryId: z
					.number()
					.int()
					.describe("Category id from list-categories"),
			},
			annotations: {
				readOnlyHint: false,
				openWorldHint: false,
				destructiveHint: false,
			},
		},
		async ({ transactionId, categoryId }) => {
			const tx = await setCategory(transactionId, categoryId);
			return {
				structuredContent: { transaction: tx },
				content: [
					{
						type: "text",
						text: `"${tx.name}" is now categorized as ${tx.category ?? "uncategorized"} and ticked${tx.marked ? "" : " (tick not applied)"}.`,
					},
				],
			};
		},
	);

export default await server.run();

export type AppType = typeof server;
