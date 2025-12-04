// app/admin/AdminLedgerPanel.tsx
"use client";

import { useState } from "react";

type AdminSummary = {
  ordersToday: number;
  revenueToday: number;
  taxToday: number;
  topVendor: {
    vendorId: string;
    vendorName: string;
    total: number;
  } | null;
  topItem: {
    name: string;
    quantity: number;
  } | null;
};

function formatCurrency(amount: number) {
  return `K ${amount.toLocaleString("en-ZM", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function AdminLedgerPanel() {
  const [date, setDate] = useState(todayYmd());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AdminSummary | null>(null);

  async function load() {
    try {
      setError(null);
      setLoading(true);
      setSummary(null);

      const res = await fetch(`/api/admin/summary?date=${date}`);
      const json = await res.json();

      if (!json.success) {
        setError(json.error ?? "Failed to load ledger for that day.");
        return;
      }

      const s = json.summary as AdminSummary;
      setSummary(s);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Historical ledger</h2>
          <p className="text-xs text-slate-400">
            Pick a date to see that day&apos;s totals, tax, and top performers.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400" htmlFor="ledger-date">
              Date
            </label>
            <input
              id="ledger-date"
              type="date"
              value={date}
              max={todayYmd()}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
            />
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load ledger"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 border border-red-500/60 bg-red-950/30 rounded px-2 py-1">
          {error}
        </div>
      )}

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
            <p className="uppercase tracking-wide text-slate-400">
              Orders
            </p>
            <p className="mt-1 text-xl font-semibold">
              {summary.ordersToday}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
            <p className="uppercase tracking-wide text-slate-400">
              Revenue (incl. VAT)
            </p>
            <p className="mt-1 text-xl font-semibold">
              {formatCurrency(summary.revenueToday)}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
            <p className="uppercase tracking-wide text-slate-400">
              Tax portion
            </p>
            <p className="mt-1 text-xl font-semibold">
              {formatCurrency(summary.taxToday)}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
            <p className="uppercase tracking-wide text-slate-400">
              Top vendor
            </p>
            {summary.topVendor ? (
              <div className="mt-1">
                <p className="font-semibold text-sm">
                  {summary.topVendor.vendorName}
                </p>
                <p className="text-[11px] text-slate-400">
                  {formatCurrency(summary.topVendor.total)}
                </p>
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">
                No vendors that day.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 sm:col-span-2 lg:col-span-4">
            <p className="uppercase tracking-wide text-slate-400">
              Most sold item
            </p>
            {summary.topItem ? (
              <p className="mt-1 text-sm font-semibold">
                {summary.topItem.name}{" "}
                <span className="text-[11px] text-slate-400">
                  ({summary.topItem.quantity} portions)
                </span>
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">
                No items sold that day.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
