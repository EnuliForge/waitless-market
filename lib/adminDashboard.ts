// lib/adminDashboard.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const TAX_RATE = 0.16; // 16% VAT included in ticket totals

export type AdminSummary = {
  ordersToday: number;
  revenueToday: number; // Kwacha
  taxToday: number; // Kwacha portion of revenue
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

// targetDate: "YYYY-MM-DD" in local time, or undefined = today
export async function getAdminSummary(
  targetDate?: string | null
): Promise<AdminSummary> {
  // === 1) Day window ===
  let base = targetDate ? new Date(targetDate) : new Date();
  if (isNaN(base.getTime())) {
    // fallback to today if bad date
    base = new Date();
  }
  base.setHours(0, 0, 0, 0);

  const start = base;
  const end = new Date(base);
  end.setDate(end.getDate() + 1);

  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // === 2) Orders for that day only ===
  const { data: orders, error: ordersError } = await supabaseAdmin
    .from("orders")
    .select("id, order_code, status, total_cents, created_at, vendor_id")
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: false });

  if (ordersError || !orders) {
    console.error("getAdminSummary ordersError", ordersError);
    return {
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
  }

  const ordersToday = orders.length;

  // total_cents → Kwacha
  const revenueToday = orders.reduce((sum, o) => {
    const cents = (o as any).total_cents ?? 0;
    return sum + cents / 100;
  }, 0);

  // VAT portion (revenue is VAT-inclusive)
  const taxToday =
    revenueToday > 0 ? (revenueToday * TAX_RATE) / (1 + TAX_RATE) : 0;

  const activeOrders = orders.filter((o) =>
    ["preparing", "ready", "issue"].includes((o as any).status as string)
  ).length;

  // === 3) Vendor totals based on that day's orders ===
  const vendorTotals = new Map<string, number>(); // Kwacha
  for (const o of orders) {
    const row = o as any;
    const vendorId = row.vendor_id as string | null;
    if (!vendorId) continue;

    const cents = row.total_cents ?? 0;
    const kw = cents / 100;
    vendorTotals.set(vendorId, (vendorTotals.get(vendorId) ?? 0) + kw);
  }

  let vendorSalesToday: AdminSummary["vendorSalesToday"] = [];
  let topVendor: AdminSummary["topVendor"] = null;

  const vendorIds = [...vendorTotals.keys()];

  if (vendorIds.length > 0) {
    const { data: vendors, error: vendorsError } = await supabaseAdmin
      .from("vendors")
      .select("id, name")
      .in("id", vendorIds);

    if (vendorsError) {
      console.error("getAdminSummary vendorsError", vendorsError);
    }

    let vendorNames = new Map<string, string>();
    if (vendors) {
      vendorNames = new Map(
        vendors.map((v) => [
          (v as any).id as string,
          (v as any).name as string,
        ])
      );
    }

    vendorSalesToday = vendorIds
      .map((vendorId) => ({
        vendorId,
        vendorName: vendorNames.get(vendorId) ?? vendorId,
        total: vendorTotals.get(vendorId) ?? 0,
      }))
      .sort((a, b) => b.total - a.total);

    if (vendorSalesToday.length > 0) {
      topVendor = vendorSalesToday[0];
    }
  }

  // === 4) Most sold item for that day from order_items ===
  const orderIds = orders.map((o) => (o as any).id as string);
  let topItem: AdminSummary["topItem"] = null;

  if (orderIds.length > 0) {
    const { data: items, error: itemsError } = await supabaseAdmin
      .from("order_items")
      .select("order_id, name_snapshot, quantity")
      .in("order_id", orderIds);

    if (itemsError) {
      console.error("getAdminSummary itemsError (for topItem)", itemsError);
    } else if (items && items.length > 0) {
      const itemCounts = new Map<string, number>();

      items.forEach((row) => {
        const name = (row as any).name_snapshot as string | null;
        const qty = (row as any).quantity ?? 0;
        if (!name) return;
        itemCounts.set(name, (itemCounts.get(name) ?? 0) + qty);
      });

      let bestName: string | null = null;
      let bestQty = 0;

      for (const [name, qty] of itemCounts.entries()) {
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

  // === 5) Avg prep time – still null until we wire events ===
  const avgPrepMinutesToday: number | null = null;

  // === 6) Latest orders (for that day) – top 12 ===
  const latestOrders = orders.slice(0, 12).map((o) => {
    const row = o as any;
    return {
      id: row.id as string,
      code: (row.order_code as string) ?? "",
      tableNumber: null,
      status: row.status as string,
      totalAmount: (row.total_cents ?? 0) / 100,
      createdAt: row.created_at as string,
    };
  });

  return {
    ordersToday,
    revenueToday,
    taxToday,
    activeOrders,
    avgPrepMinutesToday,
    vendorSalesToday,
    topVendor,
    topItem,
    latestOrders,
  };
}
