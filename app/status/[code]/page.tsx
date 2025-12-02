// app/status/[code]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

const supabase = supabaseClient;

// ---------- Types shaped to /api/status/by-code ----------

type OrderItem = {
  id: string;
  name_snapshot: string;
  quantity: number;
  notes: string | null;
  unit_price_cents?: number | null;
};

type Order = {
  id: string;
  order_code: string;
  status: string;
  total_cents: number;
  vendor_id: string;
  vendors: { name: string } | null;
  order_items: OrderItem[];
};

type Session = {
  id: string;
  ticket_code: string;
  status: string;
  created_at: string;
  orders: Order[];
};

type StatusData =
  | { kind: "session"; session: Session }
  | { kind: "order"; order: Order };

type StatusApiResponse =
  | {
      success: true;
      kind: "session";
      session: Session;
    }
  | {
      success: true;
      kind: "order";
      order: Order;
    };

// ---------- Helpers for status display / styling ----------

function getStatusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === "ready") return "Ready for collection";
  if (s === "closed") return "Collected";
  if (s === "preparing") return "Preparing";
  if (s === "issue") return "Issue flagged";
  // Fallback, e.g. "new"
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getStatusClasses(status: string) {
  const s = status.toLowerCase();
  if (s === "ready") {
    return {
      badge:
        "bg-emerald-100 text-emerald-800 border-emerald-300 font-semibold",
      card: "border-emerald-300 bg-emerald-50 shadow-md shadow-emerald-100",
    };
  }
  if (s === "preparing" || s === "new" || s === "pending") {
    return {
      badge: "bg-amber-100 text-amber-800 border-amber-300",
      card: "border-amber-200 bg-amber-50",
    };
  }
  if (s === "closed") {
    return {
      badge: "bg-slate-100 text-slate-700 border-slate-300",
      card: "border-slate-200 bg-slate-50",
    };
  }
  if (s === "issue") {
    return {
      badge: "bg-red-100 text-red-800 border-red-300",
      card: "border-red-200 bg-red-50",
    };
  }
  // default
  return {
    badge: "bg-slate-100 text-slate-700 border-slate-300",
    card: "border-slate-200 bg-white",
  };
}

// ---------- Hook: load status + subscribe to realtime ----------

function useStatusByCode(code: string | null) {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!code) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/status/by-code?code=${encodeURIComponent(code)}`,
        { cache: "no-store" }
      );

      const json = (await res.json()) as
        | StatusApiResponse
        | { success: false; error?: string };

      if (!res.ok || !("success" in json) || !json.success) {
        throw new Error((json as any).error || "Failed to load status");
      }

      if (json.kind === "session") {
        setData({ kind: "session", session: json.session });
      } else {
        setData({ kind: "order", order: json.order });
      }
    } catch (err: any) {
      console.error("useStatusByCode fetch error", err);
      setError(err.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [code]);

  // Initial fetch & refetch when code changes
  useEffect(() => {
    if (!code) return;
    fetchStatus();
  }, [code, fetchStatus]);

  // Build the realtime filter string for orders
  const orderFilter = useMemo(() => {
    if (!data) return "";

    if (data.kind === "session") {
      const ids = data.session.orders.map((o) => o.id);
      if (!ids.length) return "";
      const quoted = ids.map((id) => `"${id}"`).join(",");
      // e.g. id=in.("uuid1","uuid2",...)
      return `id=in.(${quoted})`;
    } else {
      // Single order: e.g. id=eq.uuid
      return `id=eq.${data.order.id}`;
    }
  }, [data]);

  // Realtime subscription: any relevant order UPDATE → refetch
  useEffect(() => {
    if (!code || !data || !orderFilter) return;

    const channelName =
      data.kind === "session"
        ? `status-ticket-${data.session.ticket_code}`
        : `status-order-${data.order.order_code}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: orderFilter,
        },
        () => {
          // Any order update → refresh via your API
          fetchStatus();
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] ${channelName} status:`, status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [code, data, orderFilter, fetchStatus]);

  return { data, loading, error };
}

// ---------- Ready modal ----------

type ReadyModalProps = {
  open: boolean;
  onClose: () => void;
};

function ReadyModal({ open, onClose }: ReadyModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl shadow-emerald-200 border border-emerald-300 p-4 space-y-2">
        <h2 className="text-lg font-bold text-emerald-800">
          Your order is ready for collection
        </h2>
        <p className="text-sm text-slate-700">
          Please head to the collection point when your ticket number is
          called. Enjoy!
        </p>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold py-2"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

// ---------- Page component ----------

export default function StatusPage() {
  const params = useParams<{ code: string }>();
  const code = params?.code ?? null;

  const { data, loading, error } = useStatusByCode(code);

  const [hasShownReady, setHasShownReady] = useState(false);
  const [showReadyModal, setShowReadyModal] = useState(false);

  // Detect when any order becomes ready
  const hasAnyReady = useMemo(() => {
    if (!data) return false;
    if (data.kind === "session") {
      return data.session.orders.some(
        (o) => o.status && o.status.toLowerCase() === "ready"
      );
    }
    return data.order.status.toLowerCase() === "ready";
  }, [data]);

  useEffect(() => {
    if (hasAnyReady && !hasShownReady) {
      setShowReadyModal(true);
      setHasShownReady(true);
    }
  }, [hasAnyReady, hasShownReady]);

  if (!code) {
    return (
      <div className="p-4">
        <h1 className="text-lg font-semibold mb-2">Track your order</h1>
        <p className="text-sm text-gray-600">
          Missing ticket or order code. Please scan the QR again or use the
          code on your receipt.
        </p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="p-4">
        <p className="text-sm text-gray-700">Loading your order…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-red-600">Error: {error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4">
        <p className="text-sm text-gray-700">
          No ticket or order found for this code. Please double-check with the
          cashier.
        </p>
      </div>
    );
  }

  // ----- Session (multi-vendor ticket) view -----
  if (data.kind === "session") {
    const session = data.session;

    const orderStatuses = session.orders.map((o) => o.status.toLowerCase());
    const hasIssue = orderStatuses.includes("issue");
    const allClosed = orderStatuses.every((s) => s === "closed");
    const anyReady = orderStatuses.includes("ready");

    let overallStatusLabel = "Received";
    if (hasIssue) overallStatusLabel = "Issue flagged";
    else if (allClosed) overallStatusLabel = "Completed";
    else if (anyReady) overallStatusLabel = "Parts of your order are ready";
    else overallStatusLabel = "Preparing";

    const createdAt = new Date(session.created_at);
    const timeStr = createdAt.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-lg p-4 space-y-4">
          {/* Ticket header */}
          <header className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Tracking ticket
            </p>
            <h1 className="text-2xl font-semibold">
              <span className="font-mono bg-slate-900 text-white px-2 py-1 rounded">
                {session.ticket_code}
              </span>
            </h1>
            <p className="text-xs text-slate-500">
              Started at {timeStr} •{" "}
              <span className="font-medium">{overallStatusLabel}</span>
            </p>
          </header>

          {/* Simple step indicator */}
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            {["Received", "Preparing", "Ready", "Collected"].map((step) => {
              const active =
                (step === "Received" && !anyReady && !allClosed) ||
                (step === "Preparing" && !anyReady && !allClosed) ||
                (step === "Ready" && anyReady && !allClosed) ||
                (step === "Collected" && allClosed);

              return (
                <div
                  key={step}
                  className="flex-1 flex items-center justify-center gap-1"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      active ? "bg-emerald-500" : "bg-slate-300"
                    }`}
                  />
                  <span
                    className={active ? "text-emerald-700" : "text-slate-400"}
                  >
                    {step}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Orders list */}
          <section className="space-y-3">
            {session.orders.map((order) => {
              const statusLabel = getStatusLabel(order.status);
              const { badge, card } = getStatusClasses(order.status);

              return (
                <article
                  key={order.id}
                  className={`border rounded-lg p-3 space-y-2 bg-white ${card}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">
                        {order.vendors?.name ?? "Order"}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Order code:{" "}
                        <span className="font-mono">{order.order_code}</span>
                      </div>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${badge}`}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  <ul className="text-sm text-slate-800 list-disc pl-4">
                    {order.order_items.map((item) => (
                      <li key={item.id}>
                        {item.quantity}× {item.name_snapshot}
                        {item.notes ? (
                          <span className="text-slate-500">
                            {" "}
                            — {item.notes}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </section>

          <p className="text-[11px] text-center text-slate-400">
            This screen updates automatically as the kitchen and bar work on
            your order.
          </p>
        </div>

        <ReadyModal
          open={showReadyModal}
          onClose={() => setShowReadyModal(false)}
        />
      </div>
    );
  }

  // ----- Single-order view -----
  const order = data.order;
  const statusLabel = getStatusLabel(order.status);
  const { badge, card } = getStatusClasses(order.status);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-lg p-4 space-y-4">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Tracking order
          </p>
          <h1 className="text-2xl font-semibold">
            <span className="font-mono bg-slate-900 text-white px-2 py-1 rounded">
              {order.order_code}
            </span>
          </h1>
          <p className="text-xs text-slate-500">
            {order.vendors?.name ?? "Your order"} •{" "}
            <span className="font-medium">{statusLabel}</span>
          </p>
        </header>

        <article
          className={`border rounded-lg p-3 space-y-2 bg-white ${card}`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">
              {order.vendors?.name ?? "Order"}
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full border ${badge}`}
            >
              {statusLabel}
            </span>
          </div>

          <ul className="text-sm text-slate-800 list-disc pl-4">
            {order.order_items.map((item) => (
              <li key={item.id}>
                {item.quantity}× {item.name_snapshot}
                {item.notes ? (
                  <span className="text-slate-500"> — {item.notes}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </article>

        <p className="text-[11px] text-center text-slate-400">
          This page will update as the team works on your order.
        </p>
      </div>

      <ReadyModal
        open={showReadyModal}
        onClose={() => setShowReadyModal(false)}
      />
    </div>
  );
}
