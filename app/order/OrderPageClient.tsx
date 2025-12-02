// app/order/OrderPageClient.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type OrderItem = {
  id: string;
  name_snapshot: string;
  quantity: number;
  notes: string | null;
};

type OrderRow = {
  id: string;
  order_code: string;
  status: "preparing" | "ready" | "collected";
  total_cents: number;
  vendors?: { name: string } | null;
  order_items: OrderItem[];
};

type SessionRow = {
  id: string;
  ticket_code: string;
  status: string;
  created_at: string;
  orders: OrderRow[];
};

type ApiResponse =
  | {
      success: true;
      kind: "session";
      session: SessionRow;
    }
  | {
      success: true;
      kind: "order";
      order: OrderRow;
    }
  | {
      success: false;
      error: string;
    };

function formatMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

// Same Option parsing logic as vendor dashboard
function parseItem(item: OrderItem) {
  const rawName = item.name_snapshot || "";
  const notes = item.notes || "";

  const optionMatch = notes.match(/Option:\s*([A-Za-z]+)/);
  const option = optionMatch ? optionMatch[1] : null;

  const baseName = rawName.replace(/\s*\(.*\)\s*$/, "");
  const displayName = option ? `${baseName} — ${option}` : baseName;

  let extraNotes = notes;
  if (option) {
    extraNotes = extraNotes.replace(/Option:\s*[A-Za-z]+\s*\|?\s*/i, "");
  }
  extraNotes = extraNotes.trim();

  return { displayName, extraNotes };
}

export default function OrderPageClient() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code") ?? "";

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);

  const loadStatus = async () => {
    if (!code) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/status/by-code?code=${code}`);
      const json: ApiResponse = await res.json();
      setData(json);
    } catch (e) {
      console.error(e);
      setData({
        success: false,
        error: "Unable to load status right now.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (code) {
      void loadStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (!code) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-bold">Order status</h1>
          <p className="text-sm text-gray-400">
            Scan the QR code on your receipt, or open the link from your ticket
            to see your order status.
          </p>
        </div>
      </div>
    );
  }

  const isError = data && !data.success;

  return (
    <div className="min-h-screen bg-black text-white p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <header className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Order status</h1>
            <p className="text-xs text-gray-400">
              Code: <span className="font-mono">{code}</span>
            </p>
          </div>
          <button
            onClick={loadStatus}
            disabled={loading}
            className="text-xs px-3 py-2 rounded border border-gray-600 hover:bg-gray-800 disabled:opacity-60"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </header>

        {/* Error state */}
        {isError && (
          <div className="border border-red-500 bg-red-950/40 text-red-200 text-sm px-3 py-2 rounded">
            {(data as any).error || "Order not found for this code."}
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <p className="text-sm text-gray-400">Loading status…</p>
        )}

        {/* Session (multi-vendor ticket) */}
        {data && data.success && data.kind === "session" && (
          <SessionView session={data.session} />
        )}

        {/* Single order fallback */}
        {data && data.success && data.kind === "order" && (
          <SingleOrderView order={data.order} />
        )}
      </div>
    </div>
  );
}

// --- Components ---

function SessionView({ session }: { session: SessionRow }) {
  const orders = session.orders ?? [];

  const overallTotal = orders.reduce(
    (sum, o) => sum + (o.total_cents || 0),
    0
  );

  const anyPreparing = orders.some((o) => o.status === "preparing");
  const anyReady = orders.some((o) => o.status === "ready");

  let overallLabel = "Completed";
  let overallColor = "bg-emerald-700";
  if (anyPreparing && anyReady) {
    overallLabel = "Some ready, some still preparing";
    overallColor = "bg-amber-600";
  } else if (anyPreparing) {
    overallLabel = "Preparing";
    overallColor = "bg-blue-700";
  } else if (anyReady) {
    overallLabel = "Ready for collection";
    overallColor = "bg-emerald-700";
  }

  return (
    <div className="space-y-4">
      {/* Overall ticket card */}
      <div className="border border-zinc-800 rounded-xl p-3 bg-zinc-900/70 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide">
              Ticket
            </div>
            <div className="text-lg font-semibold">
              {session.ticket_code}
            </div>
          </div>
          <div className={`px-3 py-1 rounded-full text-xs ${overallColor}`}>
            {overallLabel}
          </div>
        </div>

        <div className="flex justify-between items-center text-xs text-gray-300">
          <span>
            Vendors:{" "}
            <strong>
              {new Set(
                orders.map((o) => o.vendors?.name ?? "Unknown")
              ).size}
            </strong>
          </span>
          <span>
            Total:{" "}
            <strong>K {formatMoney(overallTotal)}</strong>
          </span>
        </div>
      </div>

      {/* Per-vendor orders */}
      <div className="space-y-3">
        {orders.map((order) => {
          const vendorName = order.vendors?.name ?? "Vendor";

          const badge =
            order.status === "preparing"
              ? { label: "Preparing", className: "bg-blue-700" }
              : order.status === "ready"
              ? { label: "Ready for collection", className: "bg-emerald-700" }
              : { label: "Collected", className: "bg-zinc-700" };

          return (
            <div
              key={order.id}
              className="border border-zinc-800 rounded-xl p-3 bg-zinc-900/80 space-y-2"
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-sm font-semibold">
                    {vendorName}
                  </div>
                  <div className="text-[11px] text-gray-400">
                    Vendor order:{" "}
                    <span className="font-mono">
                      {order.order_code}
                    </span>
                  </div>
                </div>
                <div
                  className={`px-3 py-1 rounded-full text-[11px] ${badge.className}`}
                >
                  {badge.label}
                </div>
              </div>

              <ul className="mt-1 space-y-1 text-xs">
                {order.order_items.map((item) => {
                  const { displayName, extraNotes } = parseItem(item);
                  return (
                    <li key={item.id} className="flex flex-col">
                      <span className="font-medium">
                        {item.quantity}× {displayName}
                      </span>
                      {extraNotes && (
                        <span className="text-[11px] text-gray-400">
                          {extraNotes}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              <div className="pt-1 border-t border-zinc-800 mt-1 flex justify-between text-xs text-gray-300">
                <span>Subtotal</span>
                <span className="font-semibold">
                  K {formatMoney(order.total_cents)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-gray-500 text-center mt-2">
        Please listen out for your ticket code and vendor name when collecting.
      </p>
    </div>
  );
}

function SingleOrderView({ order }: { order: OrderRow }) {
  const vendorName = order.vendors?.name ?? "Vendor";

  const badge =
    order.status === "preparing"
      ? { label: "Preparing", className: "bg-blue-700" }
      : order.status === "ready"
      ? { label: "Ready for collection", className: "bg-emerald-700" }
      : { label: "Collected", className: "bg-zinc-700" };

  return (
    <div className="space-y-4">
      <div className="border border-zinc-800 rounded-xl p-3 bg-zinc-900/80 space-y-2">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide">
              Vendor
            </div>
            <div className="text-lg font-semibold">{vendorName}</div>
            <div className="text-[11px] text-gray-400">
              Order code:{" "}
              <span className="font-mono">{order.order_code}</span>
            </div>
          </div>
          <div
            className={`px-3 py-1 rounded-full text-[11px] ${badge.className}`}
          >
            {badge.label}
          </div>
        </div>

        <ul className="mt-2 space-y-1 text-xs">
          {order.order_items.map((item) => {
            const { displayName, extraNotes } = parseItem(item);
            return (
              <li key={item.id} className="flex flex-col">
                <span className="font-medium">
                  {item.quantity}× {displayName}
                </span>
                {extraNotes && (
                  <span className="text-[11px] text-gray-400">
                    {extraNotes}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <div className="pt-1 border-t border-zinc-800 mt-1 flex justify-between text-xs text-gray-300">
          <span>Total</span>
          <span className="font-semibold">
            K {formatMoney(order.total_cents)}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-gray-500 text-center mt-2">
        Please listen out for your order code when collecting.
      </p>
    </div>
  );
}
