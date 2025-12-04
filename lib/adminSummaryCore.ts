// lib/adminSummaryCore.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminSummary = {
  ordersToday: number;
  revenueToday: number;
  activeOrders: number;
  avgPrepMinutesToday: number | null;
  vendorSalesToday: {
    vendorId: string;
    vendorName: string;
    total: number;
  }[];
  latestOrders: {
    id: string;
    code: string;
    tableNumber: string | null;
    status: string;
    totalAmount: number;
    createdAt: string;
  }[];
};

/**
 * Core summary builder. Can be used with supabaseAdmin (server)
 * OR supabaseClient (browser). No RLS tricks here – just pure logic.
 */
export async function buildAdminSummary(
  supabase: SupabaseClient<any, "public", any>,
  now: Date = new Date()
): Promise<AdminSummary> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // 1) Orders today
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, code, table_number, status, total_amount, created_at")
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: false });

  if (ordersError || !orders) {
    return {
      ordersToday: 0,
      revenueToday: 0,
      activeOrders: 0,
      avgPrepMinutesToday: null,
      vendorSalesToday: [],
      latestOrders: [],
    };
  }

  const ordersToday = orders.length;
  const revenueToday = orders.reduce(
    (sum, o) => sum + (o.total_amount ?? 0),
    0
  );

  const activeOrders = orders.filter((o) =>
    ["preparing", "ready", "issue"].includes(o.status as string)
  ).length;

  // 2) Vendor sales today
  const { data: items } = await supabase
    .from("order_items")
    .select("vendor_id, quantity, unit_price, order_id, created_at")
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  const vendorTotalsMap = new Map<string, number>();

  (items ?? []).forEach((row) => {
    const key = row.vendor_id as string;
    const lineTotal = (row.quantity ?? 0) * (row.unit_price ?? 0);
    vendorTotalsMap.set(key, (vendorTotalsMap.get(key) ?? 0) + lineTotal);
  });

  const vendorIds = [...vendorTotalsMap.keys()];

  let vendorNamesMap = new Map<string, string>();
  if (vendorIds.length > 0) {
    const { data: vendors } = await supabase
      .from("vendors")
      .select("id, name")
      .in("id", vendorIds);

    if (vendors) {
      vendorNamesMap = new Map(
        vendors.map((v) => [v.id as string, v.name as string])
      );
    }
  }

  const vendorSalesToday = vendorIds.map((vendorId) => ({
    vendorId,
    vendorName: vendorNamesMap.get(vendorId) ?? vendorId,
    total: vendorTotalsMap.get(vendorId) ?? 0,
  }));

  // 3) Average prep time (preparing -> ready)
  const { data: events } = await supabase
    .from("order_events")
    .select("order_id, event_type, created_at")
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  let avgPrepMinutesToday: number | null = null;

  if (events && events.length > 0) {
    const prepMap = new Map<string, { preparing?: Date; ready?: Date }>();

    events.forEach((e) => {
      const orderId = e.order_id as string;
      const created = new Date(e.created_at as string);
      const record = prepMap.get(orderId) ?? {};
      if (e.event_type === "preparing") record.preparing = created;
      if (e.event_type === "ready") record.ready = created;
      prepMap.set(orderId, record);
    });

    const durations: number[] = [];
    for (const { preparing, ready } of prepMap.values()) {
      if (preparing && ready) {
        durations.push((ready.getTime() - preparing.getTime()) / 60000);
      }
    }

    if (durations.length > 0) {
      avgPrepMinutesToday =
        durations.reduce((a, b) => a + b, 0) / durations.length;
    }
  }

  return {
    ordersToday,
    revenueToday,
    activeOrders,
    avgPrepMinutesToday,
    vendorSalesToday: vendorSalesToday.sort((a, b) => b.total - a.total),
    latestOrders: orders.slice(0, 12).map((o) => ({
      id: o.id as string,
      code: o.code as string,
      tableNumber: (o.table_number as string) ?? null,
      status: o.status as string,
      totalAmount: o.total_amount ?? 0,
      createdAt: o.created_at as string,
    })),
  };
}
