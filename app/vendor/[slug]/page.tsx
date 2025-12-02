"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

type Vendor = {
  id: string;
  name: string;
  slug: string;
};

type OrderItem = {
  id: string;
  name_snapshot: string;
  quantity: number;
  notes: string | null;
};

type Order = {
  id: string;
  order_code: string;
  status: "preparing" | "ready" | "collected";
  created_at: string;
  total_cents: number;
  order_items: OrderItem[];
};

export default function VendorPage() {
  const params = useParams<{ slug: string }>();
  const slugRaw = params?.slug;
  const slug =
    typeof slugRaw === "string"
      ? slugRaw
      : Array.isArray(slugRaw)
      ? slugRaw[0]
      : "";

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ====== SOUND HANDLING ======
  const dingRef = useRef<HTMLAudioElement | null>(null);
  const [audioReady, setAudioReady] = useState(false);

  // Load audio once
  useEffect(() => {
    dingRef.current = new Audio("/sounds/new-order.mp3");
    dingRef.current.load();
  }, []);

  // Unlock audio after first user interaction (click/touch)
  useEffect(() => {
    const unlock = () => {
      if (!dingRef.current) return;

      const audio = dingRef.current;
      const previousVolume = audio.volume;

      audio.volume = 0;
      audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = previousVolume;
          setAudioReady(true);
          // console.log("🔊 Audio unlocked");
        })
        .catch(() => {
          // user may have global sound blocked; ignore
        });

      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
    };

    document.addEventListener("click", unlock);
    document.addEventListener("touchstart", unlock);

    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
    };
  }, []);

  const playDing = useCallback(() => {
    if (!audioReady || !dingRef.current) return;
    try {
      dingRef.current.currentTime = 0;
      void dingRef.current.play().catch(() => {
        // ignore one-off play errors
      });
    } catch (e) {
      console.warn("Unable to play sound", e);
    }
  }, [audioReady]);

  // ====== DATA LOADING ======

  // Load vendor + initial orders
  useEffect(() => {
    if (!slug) return;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const resVendor = await fetch(`/api/vendors/by-slug?slug=${slug}`);
        const jsonVendor = await resVendor.json();

        if (!jsonVendor.success) {
          setError(jsonVendor.error ?? "Vendor not found");
          setLoading(false);
          return;
        }

        const v: Vendor = jsonVendor.vendor;
        setVendor(v);

        const resOrders = await fetch(
          `/api/orders/vendor-active?vendorId=${v.id}`
        );
        const jsonOrders = await resOrders.json();

        if (!jsonOrders.success) {
          setError(jsonOrders.error ?? "Failed to load orders");
        } else {
          setOrders(jsonOrders.orders);
        }
      } catch (err) {
        console.error(err);
        setError("Unexpected error loading vendor");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [slug]);

  // refresh helper (used by buttons + realtime)
  const refreshOrders = useCallback(async () => {
    if (!vendor) return;
    try {
      const res = await fetch(
        `/api/orders/vendor-active?vendorId=${vendor.id}`
      );
      const json = await res.json();
      if (json.success) setOrders(json.orders);
    } catch (e) {
      console.error(e);
    }
  }, [vendor]);

  // Realtime: listen for NEW orders for this vendor and ding + refresh
  useEffect(() => {
    if (!vendor) return;

    const channel = supabaseClient
      .channel(`orders-vendor-${vendor.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: `vendor_id=eq.${vendor.id}`,
        },
        () => {
          playDing();
          void refreshOrders();
        }
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [vendor, playDing, refreshOrders]);

  // ====== STATUS UPDATE ======

  const handleStatusChange = async (
    orderId: string,
    nextStatus: "ready" | "collected"
  ) => {
    if (!vendor) return;

    setUpdatingId(orderId);
    setError(null);

    try {
      const res = await fetch("/api/orders/update-status", {
        method: "POST",
        body: JSON.stringify({
          orderId,
          toStatus: nextStatus,
          actor: "vendor",
        }),
      });

      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? "Failed to update order");
      } else {
        await refreshOrders();
      }
    } catch (err) {
      console.error(err);
      setError("Unexpected error updating order");
    } finally {
      setUpdatingId(null);
    }
  };

  // ====== RENDER HELPERS ======

  if (!slug) {
    return (
      <div className="p-6 text-white">
        <h1 className="text-2xl font-bold">Loading…</h1>
      </div>
    );
  }

  if (loading && !vendor) {
    return (
      <div className="p-6 text-white">
        <h1 className="text-2xl font-bold">Loading vendor…</h1>
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="p-6 text-white">
        <h1 className="text-2xl font-bold">Vendor not found</h1>
        {error && <p className="mt-2 text-red-400">{error}</p>}
      </div>
    );
  }

  const preparing = orders.filter((o) => o.status === "preparing");
  const ready = orders.filter((o) => o.status === "ready");

  // Format item display (Name — Option) + extra notes
  const formatItem = (item: OrderItem) => {
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
  };

  // ====== UI ======

  return (
    <div className="p-6 space-y-8 text-white">
      {/* HEADER */}
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{vendor.name} — Orders</h1>
          <p className="text-sm text-gray-400">Preparing & Ready</p>
          {!audioReady && (
            <p className="text-xs text-gray-500 mt-1">
              🔊 Tap or click once to enable new-order sound.
            </p>
          )}
        </div>
        <button
          onClick={refreshOrders}
          className="border border-gray-500 rounded px-3 py-1 text-sm"
        >
          Refresh
        </button>
      </header>

      {error && (
        <div className="p-3 border border-red-500 text-red-300 rounded">
          {error}
        </div>
      )}

      {/* PREPARING */}
      <section>
        <h2 className="text-xl font-semibold mb-3">Preparing</h2>

        {preparing.length === 0 && (
          <p className="text-gray-500 text-sm">No preparing orders.</p>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {preparing.map((order) => (
            <div
              key={order.id}
              className="border border-gray-700 rounded-lg p-4 bg-black/60"
            >
              <div className="flex justify-between">
                <div className="font-semibold text-xl">{order.order_code}</div>
                <div className="text-gray-400 text-sm">
                  K {(order.total_cents / 100).toFixed(2)}
                </div>
              </div>

              <ul className="mt-3 mb-4 space-y-2 text-sm">
                {order.order_items.map((item) => {
                  const { displayName, extraNotes } = formatItem(item);
                  return (
                    <li key={item.id}>
                      <div className="font-medium">
                        {item.quantity}× {displayName}
                      </div>
                      {extraNotes && (
                        <div className="text-gray-400 text-xs">
                          {extraNotes}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              <button
                disabled={updatingId === order.id}
                onClick={() => handleStatusChange(order.id, "ready")}
                className="w-full py-2 rounded bg-green-600 hover:bg-green-700 text-sm"
              >
                {updatingId === order.id
                  ? "Updating…"
                  : "Mark as READY for collection"}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* READY FOR COLLECTION */}
      <section>
        <h2 className="text-xl font-semibold mb-3">Ready for Collection</h2>

        {ready.length === 0 && (
          <p className="text-gray-500 text-sm">No ready orders.</p>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ready.map((order) => (
            <div
              key={order.id}
              className="border border-gray-700 rounded-lg p-4 bg-black/60"
            >
              <div className="flex justify-between">
                <div className="font-semibold text-xl">{order.order_code}</div>
                <div className="text-gray-400 text-sm">
                  K {(order.total_cents / 100).toFixed(2)}
                </div>
              </div>

              <ul className="mt-3 mb-4 space-y-2 text-sm">
                {order.order_items.map((item) => {
                  const { displayName, extraNotes } = formatItem(item);
                  return (
                    <li key={item.id}>
                      <div className="font-medium">
                        {item.quantity}× {displayName}
                      </div>
                      {extraNotes && (
                        <div className="text-gray-400 text-xs">
                          {extraNotes}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              <button
                disabled={updatingId === order.id}
                onClick={() => handleStatusChange(order.id, "collected")}
                className="w-full py-2 rounded bg-blue-700 hover:bg-blue-800 text-sm"
              >
                {updatingId === order.id ? "Updating…" : "Mark as COLLECTED"}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
