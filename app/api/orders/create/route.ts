import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type OrderStatus = "preparing" | "ready" | "collected";

type IncomingItem = {
  menuItemId: string;
  quantity: number;
  notes?: string;
};

type IncomingBody = {
  vendorId: string;
  paymentMethod?: string;
  taxRate?: number;
  items: IncomingItem[];
  sessionId?: string | null;
};

interface DbMenuItem {
  id: string;
  name: string;
  price_cents: number;
  is_active: boolean;
  is_available: boolean;
}

interface DbVendor {
  id: string;
  is_active: boolean;
}

interface DbSession {
  id: string;
  ticket_code: string;
}

// --- Helpers ---

function generateSimpleCode(prefix: string): string {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${random}`;
}

async function ensureSession(
  sessionId?: string | null
): Promise<DbSession> {
  if (sessionId) {
    const { data, error } = await supabaseAdmin
      .from("order_sessions")
      .select("id, ticket_code")
      .eq("id", sessionId)
      .single();

    if (error || !data) {
      console.error("ensureSession load error", error);
      throw new Error("Session not found.");
    }

    return data as DbSession;
  }

  // Create new session
  const ticket_code = generateSimpleCode("WL");

  const { data, error } = await supabaseAdmin
    .from("order_sessions")
    .insert({ ticket_code, status: "open" })
    .select("id, ticket_code")
    .single();

  if (error || !data) {
    console.error("ensureSession create error", error);
    throw new Error("Failed to create order session.");
  }

  return data as DbSession;
}

function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === "preparing" && to === "ready") return true;
  if (from === "ready" && to === "collected") return true;
  return false;
}

// --- Route handler ---

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as IncomingBody;
    const { vendorId, paymentMethod, taxRate, items, sessionId } = body;

    if (!vendorId || !items || items.length === 0) {
      return NextResponse.json(
        { success: false, error: "Missing vendor or items" },
        { status: 400 }
      );
    }

    // 0) Ensure session (ticket)
    const session = await ensureSession(sessionId ?? null);

    // 1) Validate vendor
    const { data: vendor, error: vendorError } = await supabaseAdmin
      .from("vendors")
      .select("id, is_active")
      .eq("id", vendorId)
      .single();

    if (vendorError || !vendor) {
      console.error("vendor error", vendorError);
      return NextResponse.json(
        { success: false, error: "Vendor not found." },
        { status: 400 }
      );
    }

    if (!(vendor as DbVendor).is_active) {
      return NextResponse.json(
        { success: false, error: "Vendor is not active." },
        { status: 400 }
      );
    }

    // 2) Fetch menu items
    const menuItemIds = items.map((i) => i.menuItemId);

    const { data: menuData, error: menuError } = await supabaseAdmin
      .from("menu_items")
      .select("id, name, price_cents, is_active, is_available")
      .in("id", menuItemIds);

    if (menuError) {
      console.error("menu error", menuError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch menu items." },
        { status: 500 }
      );
    }

    const menuItems = (menuData ?? []) as DbMenuItem[];

    if (menuItems.length !== menuItemIds.length) {
      return NextResponse.json(
        { success: false, error: "Some menu items could not be found." },
        { status: 400 }
      );
    }

    // Validate 86 / active
    for (const item of menuItems) {
      if (!item.is_active || !item.is_available) {
        return NextResponse.json(
          {
            success: false,
            error: `Item '${item.name}' is not available.`,
          },
          { status: 400 }
        );
      }
    }

    // 3) Calculate totals
    let totalCents = 0;

    const orderItemsToInsert = items.map((line) => {
      const menu = menuItems.find((m) => m.id === line.menuItemId)!;
      const lineTotal = menu.price_cents * line.quantity;
      totalCents += lineTotal;

      return {
        name_snapshot: menu.name,
        unit_price_cents: menu.price_cents,
        quantity: line.quantity,
        notes: line.notes ?? null,
      };
    });

    const appliedTaxRate = taxRate ?? 0;
    const netCents =
      appliedTaxRate > 0
        ? Math.round(totalCents / (1 + appliedTaxRate / 100))
        : totalCents;
    const taxCents = totalCents - netCents;

    // 4) Create order
    const orderCode = generateSimpleCode("WL");

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        order_code: orderCode,
        session_id: session.id,
        vendor_id: vendorId,
        total_cents: totalCents,
        net_cents: netCents,
        tax_cents: taxCents,
        tax_rate: appliedTaxRate,
        payment_method: paymentMethod ?? null,
        status: "preparing" as OrderStatus,
      })
      .select("id, order_code, vendor_id, total_cents")
      .single();

    if (orderError || !order) {
      console.error("order insert error", orderError);
      return NextResponse.json(
        { success: false, error: "Failed to create order." },
        { status: 500 }
      );
    }

    // 5) Insert order_items — **NO menu_item_id here**
    const orderItemsPayload = orderItemsToInsert.map((oi) => ({
      ...oi,
      order_id: order.id,
    }));

    const { error: itemsError } = await supabaseAdmin
      .from("order_items")
      .insert(orderItemsPayload);

    if (itemsError) {
      console.error("order_items insert error", itemsError);
      return NextResponse.json(
        { success: false, error: "Failed to create order items." },
        { status: 500 }
      );
    }

    // 6) Log initial event (preparing)
    const { error: eventError } = await supabaseAdmin
      .from("order_events")
      .insert({
        order_id: order.id,
        from_status: null,
        to_status: "preparing",
        actor: "cashier",
      });

    if (eventError) {
      console.error("order_events insert error", eventError);
      // Not fatal
    }

    // 7) Respond in shape cashier UI expects
    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        order_code: order.order_code,
        vendor_id: order.vendor_id,
        total_cents: order.total_cents,
      },
      session: {
        id: session.id,
        ticket_code: session.ticket_code,
      },
    });
  } catch (e) {
    console.error("orders/create error", e);
    return NextResponse.json(
      { success: false, error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
