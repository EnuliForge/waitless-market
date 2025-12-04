// lib/adminDashboard.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type AdminSummary = {
  ordersToday: number;
  revenueToday: number;      // kwacha
  taxToday: number;          // kwacha
  activeOrders: number;
  avgPrepMinutesToday: number | null;
  vendorSalesToday: {
    vendorId: string;
    vendorName: string;
    total: number;           // kwacha
  }[];
  topVendor: {
    vendorId: string;
    vendorName: string;
    total: number;           // kwacha
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
    totalAmount: number;     // kwacha
    createdAt: string;
  }[];
};

const DEFAULT_VAT_RATE = 16; // 16% VAT included in totals

function getDayBounds(date?: string): { start: string; end: string } {
  if (date) {
    const start = `${date}T00:00:00`;
    const end = `${date}T23:59:59.999`;
    return { start, end };
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const isoDate = `${y}-${m}-${d}`;
  return {
    start: `${isoDate}T00:00:00`,
    end: `${isoDate}T23:59:59.999`,
  };
}

export async function getAdminSummary(date?: string): Promise<AdminSummary> {
  const { start, end } = getDayBounds(date);

  // 1) Load all orders created on this day
  const { data: orders, error: ordersError } = await supabaseAdmin
    .from("orders")
    .select(
      `
      id,
      order_code,
      vendor_id,
      total_cents,
      tax_cents,
      tax_rate,
      status,
      created_at,
      ready_at
    `
    )
    .gte("created_at", start)
    .lte("created_at", end)
    .order("created_at", { ascending: false });

  if (ordersError) {
    console.error("getAdminSummary ordersError", ordersError);
    throw new Error("Failed to load orders for admin summary.");
  }

  const safeOrders = orders ?? [];

  // 2) Vendor names for those vendors
  const vendorIds = Array.from(
    new Set(safeOrders.map((o) => o.vendor_id).filter(Boolean))
  ) as string[];

  let vendorNameById = new Map<string, string>();

  if (vendorIds.length > 0) {
    const { data: vendors, error: vendorsError } = await supabaseAdmin
      .from("vendors")
      .select("id, name")
      .in("id", vendorIds);

    if (vendorsError) {
      console.error("getAdminSummary vendorsError", vendorsError);
    } else {
      vendorNameById = new Map(
        (vendors ?? []).map((v: any) => [v.id as string, v.name as string])
      );
    }
  }

  // 3) Revenue, "tax from DB" (if any), active orders, prep durations
  let totalCents = 0;
  let taxCentsFromDb = 0;
  let anyNonZeroTax = false;
  let activeOrders = 0;
  const prepDurationsMinutes: number[] = [];

  for (const o of safeOrders) {
    const t = o.total_cents ?? 0;
    const tax = o.tax_cents ?? 0;

    totalCents += t;
    taxCentsFromDb += tax;
    if (tax > 0) anyNonZeroTax = true;

    if (o.status !== "collected") {
      activeOrders += 1;
    }

    if (o.created_at && o.ready_at) {
      const created = new Date(o.created_at).getTime();
      const ready = new Date(o.ready_at).getTime();
      if (ready > created) {
        const diffMinutes = (ready - created) / (1000 * 60);
        prepDurationsMinutes.push(diffMinutes);
      }
    }
  }

  const ordersToday = safeOrders.length;
  const revenueToday = totalCents / 100;

  // If the DB actually has non-zero tax_cents, trust it.
  // Otherwise, compute tax as the 16% VAT portion of revenueToday.
  let taxToday: number;
  if (anyNonZeroTax && taxCentsFromDb > 0) {
    taxToday = taxCentsFromDb / 100;
  } else {
    const divisor = 1 + DEFAULT_VAT_RATE / 100; // 1.16
    const net = revenueToday / divisor;
    taxToday = revenueToday - net;
  }

  const avgPrepMinutesToday =
    prepDurationsMinutes.length > 0
      ? prepDurationsMinutes.reduce((a, b) => a + b, 0) /
        prepDurationsMinutes.length
      : null;

  // 4) Vendor sales aggregates (kwacha)
  const vendorSalesMap = new Map<
    string,
    { vendorId: string; vendorName: string; totalKw: number }
  >();

  for (const o of safeOrders) {
    const vid = o.vendor_id as string | null;
    if (!vid) continue;

    const existing = vendorSalesMap.get(vid);
    const name = vendorNameById.get(vid) ?? "Unknown vendor";
    const incKw = (o.total_cents ?? 0) / 100;

    if (existing) {
      existing.totalKw += incKw;
    } else {
      vendorSalesMap.set(vid, {
        vendorId: vid,
        vendorName: name,
        totalKw: incKw,
      });
    }
  }

  const vendorSalesToday = Array.from(vendorSalesMap.values()).sort(
    (a, b) => b.totalKw - a.totalKw
  );

  const topVendor =
    vendorSalesToday.length > 0
      ? {
          vendorId: vendorSalesToday[0].vendorId,
          vendorName: vendorSalesToday[0].vendorName,
          total: vendorSalesToday[0].totalKw,
        }
      : null;

  // 5) Top item by quantity
  let topItem: { name: string; quantity: number } | null = null;
  const orderIds = safeOrders.map((o) => o.id);
  if (orderIds.length > 0) {
    const { data: items, error: itemsError } = await supabaseAdmin
      .from("order_items")
      .select("order_id, name_snapshot, quantity")
      .in("order_id", orderIds);

    if (itemsError) {
      console.error("getAdminSummary itemsError", itemsError);
    } else {
      const itemTotals = new Map<string, number>();

      for (const it of items ?? []) {
        const name = it.name_snapshot || "Unknown item";
        const qty = it.quantity ?? 0;
        itemTotals.set(name, (itemTotals.get(name) ?? 0) + qty);
      }

      let bestName: string | null = null;
      let bestQty = 0;

      for (const [name, qty] of itemTotals.entries()) {
        if (qty > bestQty) {
          bestQty = qty;
          bestName = name;
        }
      }

      if (bestName) {
        topItem = { name: bestName, quantity: bestQty };
      }
    }
  }

  // 6) Latest orders list
  const latestOrders = safeOrders.slice(0, 40).map((o: any) => ({
    id: o.id as string,
    code: o.order_code as string,
    tableNumber: null as string | null, // no table_number in schema now
    status: o.status as string,
    totalAmount: (o.total_cents ?? 0) / 100,
    createdAt: o.created_at as string,
  }));

  return {
    ordersToday,
    revenueToday,
    taxToday,
    activeOrders,
    avgPrepMinutesToday,
    vendorSalesToday: vendorSalesToday.map((v) => ({
      vendorId: v.vendorId,
      vendorName: v.vendorName,
      total: v.totalKw,
    })),
    topVendor,
    topItem,
    latestOrders,
  };
}
