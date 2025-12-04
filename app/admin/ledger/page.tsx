// app/admin/ledger/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminReportsPanel from "../AdminReportsPanel";

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

function formatPrepTime(value: number | null): string {
  if (value == null) return "—";

  const totalSeconds = Math.round(value * 60);
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

function isPrepSlow(value: number | null): boolean {
  return value != null && value >= 60;
}

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function AdminLedgerPage() {
  const [date, setDate] = useState<string>(todayYmd());
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async (targetDate: string) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(
        `/api/admin/summary?date=${encodeURIComponent(targetDate)}`
      );
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? "Failed to load ledger summary");
        setSummary(null);
        return;
      }
      setSummary(json.summary as AdminSummary);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Unexpected error");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // initial + whenever date changes
  useEffect(() => {
    void loadSummary(date);
  }, [date, loadSummary]);

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
    <main className="min-h-screen bg-[#1A1A1A] text-[#E5E5E5]">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {/* Header with date selector + back to live admin */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Market Square — Ledger
            </h1>
            <p className="text-sm text-[#9A9A9A]">
              Historical daily view of sales, tax, and vendor performance.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:items-end text-xs text-[#9A9A9A]">
            <div className="flex items-center gap-2">
              <label htmlFor="ledger-date" className="text-xs">
                Date
              </label>
              <input
                id="ledger-date"
                type="date"
                max={todayYmd()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-md border border-[#4D4D4D] bg-[#101010] px-2 py-1 text-xs"
              />
            </div>
            <div className="flex gap-2">
              {loading && (
                <span className="text-[11px] text-[#8A8A8A]">
                  Loading summary…
                </span>
              )}
              <Link
                href="/admin"
                className="rounded-md border border-[#5A5A5A] bg-[#333333] px-3 py-1 text-xs font-medium hover:bg-[#444444]"
              >
                ← Back to live admin
              </Link>
            </div>
          </div>
        </header>

        {/* Errors */}
        {error && (
          <div className="p-3 border border-red-500 text-red-300 rounded text-xs">
            {error}
          </div>
        )}

        {/* Reports panel for this date */}
        <div className="rounded-xl border border-[#3A3A3A] bg-[#252525] p-4">
          <AdminReportsPanel date={date} />
        </div>

        {/* Top stat cards */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[#3A3A3A] bg-[#242424] p-4">
            <p className="text-xs uppercase tracking-wide text-[#9A9A9A]">
              Orders ({date})
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {data.ordersToday}
            </p>
          </div>

          <div className="rounded-xl border border-[#3A3A3A] bg-[#242424] p-4">
            <p className="text-xs uppercase tracking-wide text-[#9A9A9A]">
              Revenue (incl. VAT)
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {formatCurrency(data.revenueToday)}
            </p>
          </div>

          <div className="rounded-xl border border-[#3A3A3A] bg-[#242424] p-4">
            <p className="text-xs uppercase tracking-wide text-[#9A9A9A]">
              Tax Portion
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {formatCurrency(data.taxToday)}
            </p>
          </div>

          <div className="rounded-xl border border-[#3A3A3A] bg-[#242424] p-4">
            <p className="text-xs uppercase tracking-wide text-[#9A9A9A]">
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
          <div className="rounded-xl border border-[#3A3A3A] bg-[#242424] p-4">
            <p className="text-xs uppercase tracking-wide text-[#9A9A9A]">
              Top Vendor
            </p>
            {data.topVendor ? (
              <div className="mt-2">
                <p className="text-lg font-semibold">
                  {data.topVendor.vendorName}
                </p>
                <p className="text-xs text-[#9A9A9A] mt-1">
                  {formatCurrency(data.topVendor.total)} in tickets
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-[#8A8A8A]">
                No vendor data for this day.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-[#3A3A3A] bg-[#242424] p-4">
            <p className="text-xs uppercase tracking-wide text-[#9A9A9A]">
              Most Sold Item
            </p>
            {data.topItem ? (
              <div className="mt-2">
                <p className="text-lg font-semibold">{data.topItem.name}</p>
                <p className="text-xs text-[#9A9A9A] mt-1">
                  {data.topItem.quantity} portions
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-[#8A8A8A]">
                No item data for this day.
              </p>
            )}
          </div>
        </section>

        {/* Bottom section: vendor breakdown + orders list */}
        <section className="grid gap-4 lg:grid-cols-[1.2fr_minmax(0,1fr)]">
          {/* Vendor sales list */}
          <div className="rounded-xl border border-[#3A3A3A] bg-[#242424] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Vendor sales</h2>
              <span className="text-xs text-[#8A8A8A]">
                Ranking for {date}
              </span>
            </div>

            {data.vendorSalesToday.length === 0 ? (
              <p className="text-sm text-[#8A8A8A]">
                No vendor sales recorded for this day.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.vendorSalesToday.map((v) => (
                  <li
                    key={v.vendorId}
                    className="flex items-center justify-between rounded-lg bg-[#202020] px-3 py-2 text-sm"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{v.vendorName}</span>
                      <span className="text-xs text-[#8A8A8A]">
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

          {/* Orders list for that day */}
          <div className="rounded-xl border border-[#3A3A3A] bg-[#242424] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Orders for the day</h2>
              <span className="text-xs text-[#8A8A8A]">
                Last {data.latestOrders.length} tickets
              </span>
            </div>

            {data.latestOrders.length === 0 ? (
              <p className="text-sm text-[#8A8A8A]">
                No orders placed on this day.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.latestOrders.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center justify-between rounded-lg bg-[#202020] px-3 py-2"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">
                        #{o.code}{" "}
                        {o.tableNumber && (
                          <span className="ml-1 text-xs text-[#9A9A9A]">
                            · Table {o.tableNumber}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-[#8A8A8A]">
                        {formatTime(o.createdAt)}
                      </span>
                    </div>

                    <div className="flex flex-col items-end">
                      <span className="text-xs uppercase tracking-wide text-[#9A9A9A]">
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
