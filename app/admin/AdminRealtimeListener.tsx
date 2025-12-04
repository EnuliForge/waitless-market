// app/admin/AdminRealtimeListener.tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient"; // ✅ reuse existing client

export default function AdminRealtimeListener() {
  const router = useRouter();
  const refreshTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce so a burst of DB events doesn’t spam refresh()
  const scheduleRefresh = () => {
    if (refreshTimeout.current) clearTimeout(refreshTimeout.current);
    refreshTimeout.current = setTimeout(() => {
      router.refresh();
    }, 300);
  };

  useEffect(() => {
    // ONE shared client, same as vendor/runner pages
    const channel = supabaseClient
      .channel("admin-dashboard")
      // 👉 use the same tables you care about in summaries
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => scheduleRefresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        () => scheduleRefresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_events" },
        () => scheduleRefresh()
      )
      .subscribe();

    return () => {
      if (refreshTimeout.current) clearTimeout(refreshTimeout.current);
      supabaseClient.removeChannel(channel);
    };
  }, [router]);

  return null; // no UI
}
