import "../index.css";
import { useToolInfo } from "../helpers.js";
import { useDisplayMode, useLayout } from "skybridge/web";

type Tx = {
  id: number;
  date: string;
  name: string;
  value: number;
  currency: string;
  marked: boolean;
  category: string | null;
  account: string | null;
};

const fmt = (value: number, currency: string) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "EUR" }).format(value);

export default function ListTransactions() {
  const { output, isPending } = useToolInfo<"list-transactions">();
  const [displayMode, setDisplayMode] = useDisplayMode();
  const { theme } = useLayout();
  const dark = theme === "dark";

  const c = {
    fg: dark ? "#e7e7e7" : "#1a1a1a",
    sub: dark ? "#9a9a9a" : "#6b6b6b",
    line: dark ? "#2c2c2c" : "#ececec",
    card: dark ? "#161616" : "#ffffff",
    pos: dark ? "#4ade80" : "#16a34a",
    neg: dark ? "#f87171" : "#dc2626",
  };

  if (isPending) return <div style={{ padding: 16, color: c.sub }}>Loading transactions…</div>;

  const txs: Tx[] = output?.transactions ?? [];
  const isFull = displayMode === "fullscreen";
  const shown = isFull ? txs : txs.slice(0, 8);
  const markedCount = txs.filter((t) => t.marked).length;

  return (
    <div
      data-llm={`Showing ${txs.length} transactions, ${markedCount} ticked/pointées and ${txs.length - markedCount} not. Income ${output?.totalIncome}, expenses ${output?.totalExpenses}.`}
      style={{ background: c.card, color: c.fg, padding: 16, borderRadius: 12, fontSize: 14 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <span>
          <strong style={{ fontSize: 16 }}>{txs.length} transactions</strong>
          <span style={{ color: c.sub, fontSize: 12, marginLeft: 8 }}>{markedCount} ticked</span>
        </span>
        <span style={{ color: c.sub }}>
          <span style={{ color: c.pos }}>+{fmt(output?.totalIncome ?? 0, txs[0]?.currency ?? "EUR")}</span>
          {"  "}
          <span style={{ color: c.neg }}>{fmt(output?.totalExpenses ?? 0, txs[0]?.currency ?? "EUR")}</span>
        </span>
      </div>

      {txs.length === 0 && <div style={{ color: c.sub }}>No transactions in this range.</div>}

      <div>
        {shown.map((t) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              padding: "8px 0",
              borderTop: `1px solid ${c.line}`,
            }}
          >
            <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
              <span
                title={t.marked ? "Pointée (ticked)" : "Non pointée"}
                aria-label={t.marked ? "ticked" : "not ticked"}
                style={{
                  marginTop: 5,
                  flexShrink: 0,
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: t.marked ? c.pos : "transparent",
                  border: `1.5px solid ${t.marked ? c.pos : c.sub}`,
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</div>
                <div style={{ color: c.sub, fontSize: 12 }}>
                  {t.date}
                  {t.category ? ` · ${t.category}` : ""}
                  {t.account ? ` · ${t.account}` : ""}
                </div>
              </div>
            </div>
            <div style={{ whiteSpace: "nowrap", color: t.value < 0 ? c.neg : c.pos, fontWeight: 600 }}>
              {fmt(t.value, t.currency)}
            </div>
          </div>
        ))}
      </div>

      {!isFull && txs.length > shown.length && (
        <button
          onClick={() => setDisplayMode("fullscreen")}
          style={{
            marginTop: 12,
            width: "100%",
            padding: "8px 0",
            background: "transparent",
            color: c.fg,
            border: `1px solid ${c.line}`,
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          View all {txs.length}
        </button>
      )}
      {isFull && (
        <button
          onClick={() => setDisplayMode("inline")}
          style={{
            marginTop: 12,
            padding: "8px 16px",
            background: "transparent",
            color: c.fg,
            border: `1px solid ${c.line}`,
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Collapse
        </button>
      )}
    </div>
  );
}
