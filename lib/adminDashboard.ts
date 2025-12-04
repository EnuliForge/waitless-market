// lib/adminDashboard.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type AdminSummary = {
  ordersToday: number;
  revenueToday: number; // Kwacha
  taxToday: number; // Kwacha
  activeOrders: number;
  avgPrepMinutesToday: number | null;
  vendorSalesToday: {
    vendorId: string;
    vendorName: string;
    total: number; // Kwacha
  }[];
  topVendor: {
    vendorId: string;
    vendorName: string;
    total: number; // Kwacha
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
    totalAmount: number; // Kwacha
    createdAt: string;
  }[];
};

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function getAdminSummary(
  date?: string
): Promise<AdminSummary> {
  const targetDate = date ?? todayYmd();

  // We’ll use created_at as the day bucket
  const dayStart = `${targetDate}T00:00:00`;
  const dayEnd = `${targetDate}T23:59:59.999`;

  // 1) Pull all orders for that day
  const {
    data: orders,
    error: ordersError,
  } = await supabaseAdmin
    .from("orders")
    .select(
      `
      id,
      order_code,
      status,
      vendor_id,
      total_cents,
      net_cents,
      tax_cents,
      tax_rate,
      created_at,
      preparing_at,
      ready_at,
      collected_at,
      vendors ( name )
    `
    )
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd);

  if (ordersError) {
    console.error("getAdminSummary ordersError", ordersError);
  }

  const safeOrders = orders ?? [];

  // 2) Basic counts/sums
  const ordersToday = safeOrders.length;

  let revenueCents = 0;
  let taxCents = 0;
  let activeOrders = 0;

  // Map for vendor totals
  const vendorTotals: Map<
    string,
    { vendorName: string; totalCents: number }
  > = new Map();

  for (const o of safeOrders as any[]) {
    const total_cents = o.total_cents ?? 0;
    const tax_cents = o.tax_cents ?? 0;
    const status = o.status as string;
    const vendorId = o.vendor_id as string;
    const vendorName =
      (o.vendors && o.vendors.name) || "Unknown vendor";

    revenueCents += total_cents;
    taxCents += tax_cents;

    if (status === "preparing" || status === "ready") {
      activeOrders += 1;
    }

    const existing = vendorTotals.get(vendorId);
    if (existing) {
      existing.totalCents += total_cents;
    } else {
      vendorTotals.set(vendorId, {
        vendorName,
        totalCents: total_cents,
      });
    }
  }

  // 3) Avg prep time (minutes) using preparing_at → ready_at
  const prepDurationsMinutes: number[] = [];

  for (const o of safeOrders as any[]) {
    const prep = o.preparing_at as string | null;
    const ready = o.ready_at as string | null;

    if (!prep || !ready) continue;

    const prepMs = new Date(prep).getTime();
    const readyMs = new Date(ready).getTime();
    const diffMs = readyMs - prepMs;
    if (!Number.isFinite(diffMs) || diffMs <= 0) continue;

    const diffMinutes = diffMs / 60000;
    prepDurationsMinutes.push(diffMinutes);
  }

  let avgPrepMinutesToday: number | null = null;
  if (prepDurationsMinutes.length > 0) {
    const sum = prepDurationsMinutes.reduce((a, b) => a + b, 0);
    avgPrepMinutesToday = sum / prepDurationsMinutes.length;
  }

  // 4) Vendor sales list
  const vendorSalesToday = Array.from(vendorTotals.entries())
    .map(([vendorId, info]) => ({
      vendorId,
      vendorName: info.vendorName,
      total: info.totalCents / 100,
    }))
    .sort((a, b) => b.total - a.total);

  const topVendor =
    vendorSalesToday.length > 0 ? vendorSalesToday[0] : null;

  // 5) Most sold item (simple version: group by name_snapshot)
  let topItem: { name: string; quantity: number } | null = null;
  try {
    const {
      data: itemRows,
      error: itemsError,
    } = await supabaseAdmin
      .from("order_items")
      .select(
        `
        name_snapshot,
        quantity,
        orders!inner (
          created_at
        )
      `
      )
      .gte("orders.created_at", dayStart)
      .lte("orders.created_at", dayEnd);

    if (itemsError) {
      console.error("getAdminSummary itemsError", itemsError);
    } else {
      const counts: Map<string, number> = new Map();

      for (const row of (itemRows ?? []) as any[]) {
        const name = row.name_snapshot as string;
        const qty = row.quantity ?? 0;
        if (!name) continue;

        const existing = counts.get(name) ?? 0;
        counts.set(name, existing + qty);
      }

      let bestName: string | null = null;
      let bestQty = 0;
      for (const [name, qty] of counts.entries()) {
        if (qty > bestQty) {
          bestQty = qty;
          bestName = name;
        }
      }

      if (bestName && bestQty > 0) {
        topItem = { name: bestName, quantity: bestQty };
      }
    }
  } catch (e) {
    console.error("getAdminSummary topItem error", e);
  }

  // 6) Latest orders (for right-hand list)
  const latestOrders = (safeOrders as any[])
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
    )
    .slice(0, 30)
    .map((o) => ({
      id: o.id as string,
      code: o.order_code as string,
      tableNumber: null as string | null, // no table schema wired yet
      status: o.status as string,
      totalAmount: (o.total_cents ?? 0) / 100,
      createdAt: o.created_at as string,
    }));

  return {
    ordersToday,
    revenueToday: revenueCents / 100,
    taxToday: taxCents / 100,
    activeOrders,
    avgPrepMinutesToday,
    vendorSalesToday,
    topVendor,
    topItem,
    latestOrders,
  };
}
