// core/orders.ts
import { supabaseAdmin } from "../lib/supabaseAdmin";
import type {
  CreateOrderInput,
  CreatedOrderResult,
  OrderStatus,
} from "./types";

// --- Internal helpers & types ---

type UpdateOrderStatusInput = {
  orderId?: string;
  orderCode?: string;
  toStatus: OrderStatus;
  actor: "vendor" | "cashier" | "system";
};

interface DbMenuItem {
  id: string;
  name: string;
  price_cents: number;
  is_active: boolean;
  is_available: boolean;
}

interface DbOrderMinimal {
  id: string;
  status: OrderStatus;
}

type SessionStatus = "open" | "paid" | "closed" | "cancelled";

interface DbOrderSession {
  id: string;
  ticket_code: string;
  status: SessionStatus;
  created_at: string;
}

// Simple order / ticket code generator, e.g. WL-4821
function generateSimpleCode(prefix: string = "WL"): string {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${random}`;
}

function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === "preparing" && to === "ready") return true;
  if (from === "ready" && to === "collected") return true;
  return false;
}

/**
 * Ensure we have a valid session (ticket):
 * - If sessionId is provided, load and return that session.
 * - If not, create a new session with a fresh ticket_code.
 */
async function ensureSession(
  sessionId?: string | null
): Promise<DbOrderSession> {
  if (sessionId) {
    const { data, error } = await supabaseAdmin
      .from("order_sessions")
      .select("id, ticket_code, status, created_at")
      .eq("id", sessionId)
      .single();

    if (error || !data) {
      console.error(error);
      throw new Error("Session not found.");
    }

    return data as DbOrderSession;
  }

  // Create a new session with a generated ticket code
  const ticket_code = generateSimpleCode("WL");

  const { data, error } = await supabaseAdmin
    .from("order_sessions")
    .insert({
      ticket_code,
      status: "open",
    })
    .select("id, ticket_code, status, created_at")
    .single();

  if (error || !data) {
    console.error(error);
    throw new Error("Failed to create order session.");
  }

  return data as DbOrderSession;
}

// --- Core engine functions ---

/**
 * Create a new order:
 * - Validates vendor
 * - Validates menu items & 86 state
 * - Calculates totals + optional tax split
 * - Ensures there is an order_session (ticket) and links to it
 * - Inserts into orders, order_items, order_events
 *
 * If input.sessionId is provided (extended shape), the order will be
 * attached to that existing session. Otherwise, a new session is created.
 */
export async function createOrder(
  input: CreateOrderInput
): Promise<CreatedOrderResult> {
  if (!input.items.length) {
    throw new Error("Order must contain at least one item.");
  }

  // Allow for an extended input that optionally includes sessionId
  const inputWithSession = input as CreateOrderInput & {
    sessionId?: string | null;
  };
  const requestedSessionId = inputWithSession.sessionId ?? null;

  // 0) Ensure we have a valid session (ticket) to attach this order to
  const session = await ensureSession(requestedSessionId);

  // 1) Fetch vendor to ensure it exists and is active
  const { data: vendor, error: vendorError } = await supabaseAdmin
    .from("vendors")
    .select("id, is_active")
    .eq("id", input.vendorId)
    .single();

  if (vendorError || !vendor) {
    console.error(vendorError);
    throw new Error("Vendor not found.");
  }

  if (!vendor.is_active) {
    throw new Error("Vendor is not active.");
  }

  // 2) Fetch menu items to get names, prices, availability
  const menuItemIds = input.items.map((i) => i.menuItemId);

  const { data: menuData, error: menuError } = await supabaseAdmin
    .from("menu_items")
    .select("id, name, price_cents, is_active, is_available")
    .in("id", menuItemIds);

  if (menuError) {
    console.error(menuError);
    throw new Error("Failed to fetch menu items.");
  }

  const menuItems = (menuData ?? []) as DbMenuItem[];

  if (menuItems.length !== menuItemIds.length) {
    throw new Error("Some menu items could not be found.");
  }

  // Validate all items are active & available (not 86'ed)
  for (const item of menuItems) {
    if (!item.is_active || !item.is_available) {
      throw new Error(`Item '${item.name}' is not available.`);
    }
  }

  // 3) Calculate totals
  let totalCents = 0;

  const orderItemsToInsert = input.items.map((line) => {
    const menuItem = menuItems.find((m) => m.id === line.menuItemId)!;
    const lineTotal = menuItem.price_cents * line.quantity;
    totalCents += lineTotal;

    return {
      name_snapshot: menuItem.name,
      unit_price_cents: menuItem.price_cents,
      quantity: line.quantity,
      notes: line.notes ?? null,
    };
  });

  const taxRate = input.taxRate ?? 0;
  const netCents =
    taxRate > 0 ? Math.round(totalCents / (1 + taxRate / 100)) : totalCents;
  const taxCents = totalCents - netCents;

  // 4) Generate a simple order code (per-vendor)
  const orderCode = generateSimpleCode("MS");

  // 5) Insert into orders (linked to session)
  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .insert({
      order_code: orderCode,
      vendor_id: input.vendorId,
      session_id: session.id,
      total_cents: totalCents,
      net_cents: netCents,
      tax_cents: taxCents,
      tax_rate: taxRate,
      payment_method: input.paymentMethod,
      status: "preparing" as OrderStatus,
    })
    .select("id, order_code, vendor_id, total_cents, session_id")
    .single();

  if (orderError || !order) {
    console.error(orderError);
    throw new Error("Failed to create order.");
  }

  // 6) Insert order_items
  const orderItemsPayload = orderItemsToInsert.map((oi) => ({
    ...oi,
    order_id: order.id,
  }));

  const { error: itemsError } = await supabaseAdmin
    .from("order_items")
    .insert(orderItemsPayload);

  if (itemsError) {
    console.error(itemsError);
    throw new Error("Failed to create order items.");
  }

  // 7) Insert initial event (preparing)
  const { error: eventError } = await supabaseAdmin
    .from("order_events")
    .insert({
      order_id: order.id,
      from_status: null,
      to_status: "preparing",
      actor: "cashier",
    });

  if (eventError) {
    console.error(eventError);
    // Not fatal for the order itself; just log.
  }

  // We keep the original result shape, but also add some extra fields that
  // the API can use (vendor + totals + session & ticketCode).
  return {
    orderId: order.id,
    orderCode: order.order_code,
    // extras (runtime-useful, TS will accept them at use sites)
    vendorId: order.vendor_id,
    totalCents: order.total_cents,
    sessionId: order.session_id,
    ticketCode: session.ticket_code,
  } as CreatedOrderResult & {
    vendorId: string;
    totalCents: number;
    sessionId: string;
    ticketCode: string;
  };
}

/**
 * Update order status with proper state machine:
 * preparing → ready → collected
 */
export async function updateOrderStatus(input: UpdateOrderStatusInput) {
  if (!input.orderId && !input.orderCode) {
    throw new Error("orderId or orderCode is required.");
  }

  // 1) Load current order
  const query = supabaseAdmin.from("orders").select("id, status").limit(1);

  const { data, error } = input.orderId
    ? await query.eq("id", input.orderId)
    : await query.eq("order_code", input.orderCode!);

  if (error || !data || !data[0]) {
    console.error(error);
    throw new Error("Order not found.");
  }

  const current = data[0] as DbOrderMinimal;

  if (current.status === input.toStatus) {
    // Nothing to do
    return current;
  }

  if (!canTransition(current.status, input.toStatus)) {
    throw new Error(
      `Invalid status transition ${current.status} → ${input.toStatus}`
    );
  }

  // 2) Update orders.status
  const { error: updateError } = await supabaseAdmin
    .from("orders")
    .update({ status: input.toStatus })
    .eq("id", current.id);

  if (updateError) {
    console.error(updateError);
    throw new Error("Failed to update order status.");
  }

  // 3) Log event
  const { error: eventError } = await supabaseAdmin
    .from("order_events")
    .insert({
      order_id: current.id,
      from_status: current.status,
      to_status: input.toStatus,
      actor: input.actor,
    });

  if (eventError) {
    console.error(eventError);
  }

  return { id: current.id, status: input.toStatus };
}

/**
 * Get a single order by its human order code (legacy status page / QR).
 * Returns:
 * - order
 * - vendor name
 * - items
 *
 * NOTE: For multi-vendor tickets, prefer getSessionByTicketCode() below.
 */
export async function getOrderByCode(orderCode: string) {
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(
      `
      id,
      order_code,
      status,
      total_cents,
      vendor_id,
      vendors ( name ),
      order_items (
        id,
        name_snapshot,
        unit_price_cents,
        quantity,
        notes
      )
    `
    )
    .eq("order_code", orderCode)
    .single();

  if (error || !order) {
    console.error(error);
    throw new Error("Order not found.");
  }

  return order;
}

/**
 * Get a full session (ticket) by its ticket_code:
 * - session
 * - all vendor orders under it
 * - each order's vendor name + items
 */
export async function getSessionByTicketCode(ticketCode: string) {
  const { data, error } = await supabaseAdmin
    .from("order_sessions")
    .select(
      `
      id,
      ticket_code,
      status,
      created_at,
      orders (
        id,
        order_code,
        status,
        total_cents,
        vendor_id,
        vendors ( name ),
        order_items (
          id,
          name_snapshot,
          unit_price_cents,
          quantity,
          notes
        )
      )
    `
    )
    .eq("ticket_code", ticketCode)
    .single();

  if (error || !data) {
    console.error(error);
    throw new Error("Session / ticket not found.");
  }

  return data;
}

/**
 * List all active (non-collected) orders for a vendor,
 * ordered oldest → newest. For vendor dashboard.
 */
export async function listVendorActiveOrders(vendorId: string) {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      `
      id,
      order_code,
      status,
      created_at,
      total_cents,
      order_items (
        id,
        name_snapshot,
        quantity,
        notes
      )
    `
    )
    .eq("vendor_id", vendorId)
    .in("status", ["preparing", "ready"])
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    throw new Error("Failed to load vendor orders.");
  }

  return data ?? [];
}

/**
 * List all orders for a given day (cashier recon / overview).
 * dateStr should be in 'YYYY-MM-DD' format.
 */
export async function listCashierOrdersForDay(dateStr: string) {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      `
      id,
      order_code,
      vendor_id,
      vendors ( name ),
      total_cents,
      payment_method,
      status,
      paid_at
    `
    )
    .gte("paid_at", `${dateStr}T00:00:00`)
    .lte("paid_at", `${dateStr}T23:59:59`)
    .order("paid_at", { ascending: true });

  if (error) {
    console.error(error);
    throw new Error("Failed to load orders for day.");
  }

  return data ?? [];
}
