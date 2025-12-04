// app/admin/page.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabaseClient";
import AdminReportsPanel from "./AdminReportsPanel";

type AdminSummary = {
  ordersToday: number;
  revenueToday: number;
  taxToday: number;
  activeOrders: number;
  avgPrepMinutesToday: number | null;
  vendorSalesToday: {
    vendorId: string;
    vendorName: string;
    total: number;
  }[];
  topVendor: {
    vendorId: string;
    vendorName: string;
    total: number;
  } | null;
  topItem: {
    name: string;
    quantity: number;
  } | null;
  latestOrders: {
    id: string;
    code: string;
    tableNumber: string | null;
    status: string;
    totalAmount: number;
    createdAt: string;
  }[];
};

function formatCurrency(amount: number) {
  return `K ${amount.toLocaleString("en-ZM", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Format avg prep time as "Xm Ys" or "Xh Ym"
function formatPrepTime(value: number | null): string {
  if (value == null) return "—";

  const totalSeconds = Math.round(value * 60); // value is in minutes
  const hours = Math.floor(totalSeconds / 3600);
  const remainingSecondsAfterHours = totalSeconds % 3600;
  const minutes = Math.floor(remainingSecondsAfterHours / 60);
  const seconds = remainingSecondsAfterHours % 60;

  if (hours >= 1) {
    const mm = minutes.toString().padStart(2, "0");
    return `${hours}h ${mm}m`;
  }

  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

// Red if avg prep >= 60 minutes (1 hour)
function isPrepSlow(value: number | null): boolean {
  return value != null && value >= 60;
}

export default function AdminPage() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch summary for TODAY
  const refreshSummary = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/admin/summary");
      const json = await res.json();

      if (!json.success) {
        setError(json.error ?? "Failed to load admin summary");
        return;
      }

      setSummary(json.summary as AdminSummary);
      setLoading(false);
    } catch (err) {
      console.error("refreshSummary error", err);
      setError("Unexpected error loading admin summary");
      setLoading(false);
    }
  }, []);

  // Debounced refresh so bursts of events don't spam the API
  const scheduleRefresh = useCallback(() => {
    if (refreshTimeout.current) clearTimeout(refreshTimeout.current);
    refreshTimeout.current = setTimeout(() => {
      void refreshSummary();
    }, 300);
  }, [refreshSummary]);

  // Initial load + realtime subscription for TODAY
  useEffect(() => {
    void refreshSummary();

    const channel = supabaseClient
      .channel("admin-dashboard")
      // Any change on orders
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => {
          scheduleRefresh();
        }
      )
      // Any change on order_items (affects top item / vendor totals)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        () => {
          scheduleRefresh();
        }
      )
      .subscribe();

    return () => {
      if (refreshTimeout.current) clearTimeout(refreshTimeout.current);
      supabaseClient.removeChannel(channel);
    };
  }, [refreshSummary, scheduleRefresh]);

  const data: AdminSummary = summary ?? {
    ordersToday: 0,
    revenueToday: 0,
    taxToday: 0,
    activeOrders: 0,
    avgPrepMinutesToday: null,
    vendorSalesToday: [],
    topVendor: null,
    topItem: null,
    latestOrders: [],
  };

  const prepIsSlow = isPrepSlow(data.avgPrepMinutesToday);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Market Square — Admin
            </h1>
            <p className="text-sm text-slate-400">
              Live overview of today&apos;s orders, vendor performance and
              reports.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:items-end text-xs text-slate-400">
            <div className="flex gap-2">
              <span>Today (live)</span>
              {loading && (
                <span className="text-[11px] text-slate-500">
                  Loading summary…
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => void refreshSummary()}
                className="rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs hover:bg-slate-800"
              >
                Refresh now
              </button>
              {/* Link to ledger page */}
              <Link
                href="/admin/ledger"
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1 text-xs font-medium hover:bg-slate-700"
              >
                View historical ledger →
              </Link>
            </div>
          </div>
        </header>

        {/* Errors / loading */}
        {error && (
          <div className="p-3 border border-red-500 text-red-300 rounded text-xs">
            {error}
          </div>
        )}
        {loading && !summary && (
          <p className="text-sm text-slate-500">Loading admin summary…</p>
        )}

        {/* Reports panel (for today) */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <AdminReportsPanel />
        </div>

        {/* Top stat cards */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Orders Today
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {data.ordersToday}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Revenue Today (incl. VAT)
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {formatCurrency(data.revenueToday)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Tax Portion Today
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {formatCurrency(data.taxToday)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Avg Prep Time
            </p>
            <p
              className={
                "mt-2 text-3xl font-semibold " +
                (prepIsSlow ? "text-red-400" : "")
              }
            >
              {formatPrepTime(data.avgPrepMinutesToday)}
            </p>
          </div>
        </section>

        {/* Highlights: top vendor + most sold item */}
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Top Vendor Today
            </p>
            {data.topVendor ? (
              <div className="mt-2">
                <p className="text-lg font-semibold">
                  {data.topVendor.vendorName}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {formatCurrency(data.topVendor.total)} in tickets
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                No vendor data yet today.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Most Sold Item Today
            </p>
            {data.topItem ? (
              <div className="mt-2">
                <p className="text-lg font-semibold">{data.topItem.name}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {data.topItem.quantity} portions sold
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                No item data yet today.
              </p>
            )}
          </div>
        </section>

        {/* Bottom section: vendor breakdown + latest orders */}
        <section className="grid gap-4 lg:grid-cols-[1.2fr_minmax(0,1fr)]">
          {/* Vendor sales list */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Vendor sales today</h2>
              <span className="text-xs text-slate-500">
                Top performers by revenue
              </span>
            </div>

            {data.vendorSalesToday.length === 0 ? (
              <p className="text-sm text-slate-500">
                No vendor sales recorded yet today.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.vendorSalesToday.map((v) => (
                  <li
                    key={v.vendorId}
                    className="flex items-center justify-between rounded-lg bg-slate-900/80 px-3 py-2 text-sm"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{v.vendorName}</span>
                      <span className="text-xs text-slate-500">
                        {v.vendorId}
                      </span>
                    </div>
                    <span className="font-semibold">
                      {formatCurrency(v.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Latest orders */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Latest orders</h2>
              <span className="text-xs text-slate-500">
                Last {data.latestOrders.length} tickets
              </span>
            </div>

            {data.latestOrders.length === 0 ? (
              <p className="text-sm text-slate-500">
                No orders placed yet today.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.latestOrders.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center justify-between rounded-lg bg-slate-900/80 px-3 py-2"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">
                        #{o.code}{" "}
                        {o.tableNumber && (
                          <span className="ml-1 text-xs text-slate-400">
                            · Table {o.tableNumber}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatTime(o.createdAt)}
                      </span>
                    </div>

                    <div className="flex flex-col items-end">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        {o.status}
                      </span>
                      <span className="font-semibold">
                        {formatCurrency(o.totalAmount)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
