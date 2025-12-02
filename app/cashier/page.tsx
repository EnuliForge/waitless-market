// app/cashier/page.tsx
"use client";

import { useEffect, useState } from "react";

const VAT_RATE = 0.16; // 16% VAT included in prices

type Vendor = {
  id: string;
  name: string;
  slug: string;
};

type MenuItem = {
  id: string;
  name: string;
  description?: string | null;
  price_cents: number;
};

type CartItem = {
  vendorId: string;
  vendorName: string;
  menuItemId: string;
  name: string;
  quantity: number;
  notes: string;
  price_cents: number;
};

type SessionInfo = {
  id: string;
  ticketCode: string;
};

type SessionOrderSummary = {
  orderId: string;
  orderCode: string;
  vendorId: string;
  vendorName: string;
  totalCents: number;
};

type CreateOrderResponse = {
  success: boolean;
  error?: string;
  order?: {
    id: string;
    order_code: string;
    vendor_id: string;
    total_cents: number;
  };
  session?: {
    id: string;
    ticket_code: string;
  };
};

type PrintTicketData = {
  ticketCode: string;
  orders: SessionOrderSummary[];
};

export default function CashierPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GLOBAL basket (across all vendors)
  const [cart, setCart] = useState<CartItem[]>([]);

  // Payment + session
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [currentSession, setCurrentSession] = useState<SessionInfo | null>(null);
  const [sessionOrders, setSessionOrders] = useState<SessionOrderSummary[]>([]);

  // Option modal
  const [optionModalOpen, setOptionModalOpen] = useState(false);
  const [optionTargetItem, setOptionTargetItem] = useState<MenuItem | null>(
    null
  );

  // Print ticket modal
  const [printTicket, setPrintTicket] = useState<PrintTicketData | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  const findVendorName = (vendorId: string) =>
    vendors.find((v) => v.id === vendorId)?.name ?? "Unknown";

  const cartTotalCents = cart.reduce(
    (sum, item) => sum + item.quantity * item.price_cents,
    0
  );

  const formatMoney = (cents: number) => (cents / 100).toFixed(2);

  // --- Load vendors ---

  useEffect(() => {
    async function loadVendors() {
      try {
        setLoadingVendors(true);
        setError(null);
        const res = await fetch("/api/vendors/list");
        const json = await res.json();

        if (!json.success) {
          setError(json.error ?? "Failed to load vendors");
          return;
        }

        const vs: Vendor[] = json.vendors ?? json.data ?? [];
        setVendors(vs);

        // Start with no vendor open; user taps to open
        setSelectedVendorId(null);
      } catch (e) {
        console.error(e);
        setError("Unexpected error loading vendors");
      } finally {
        setLoadingVendors(false);
      }
    }

    loadVendors();
  }, []);

  // --- Load menu for selected vendor (only when expanded) ---

  useEffect(() => {
    if (!selectedVendorId) {
      setMenuItems([]);
      return;
    }

    async function loadMenu() {
      try {
        setLoadingMenu(true);
        setError(null);
        const res = await fetch(
          `/api/menu/vendor?vendorId=${encodeURIComponent(selectedVendorId)}`
        );
        const json = await res.json();

        if (!json.success) {
          setError(json.error ?? "Failed to load menu");
          setMenuItems([]);
          return;
        }

        const items: MenuItem[] = json.items ?? json.menu ?? json.data ?? [];
        setMenuItems(items);
      } catch (e) {
        console.error(e);
        setError("Unexpected error loading menu");
        setMenuItems([]);
      } finally {
        setLoadingMenu(false);
      }
    }

    loadMenu();
  }, [selectedVendorId]);

  // --- Ticket controls ---

  const handleStartNewTicket = () => {
    setCurrentSession(null);
    setSessionOrders([]);
    setCart([]);
    setPaymentMethod("cash");
    setError(null);
    setPrintTicket(null);
    setPrintOpen(false);
  };

  // --- Item / option logic ---

  const shouldPromptForOption = (item: MenuItem) => {
    const name = item.name.toLowerCase();
    // Heuristic for Noodz-style items that need an option
    return (
      name.includes("balsamic") ||
      name.includes("paprika") ||
      name.includes("korean") ||
      name.includes("stir fry")
    );
  };

  const addMenuItemToCart = (item: MenuItem) => {
    if (!selectedVendorId) return;
    const vendorName = findVendorName(selectedVendorId);

    if (shouldPromptForOption(item)) {
      setOptionTargetItem(item);
      setOptionModalOpen(true);
      return;
    }

    // Default add (no option)
    setCart((prev) => {
      // We treat each vendor+item+notes combination as a line; for now, no notes => can merge
      const existing = prev.find(
        (c) =>
          c.menuItemId === item.id &&
          c.vendorId === selectedVendorId &&
          c.notes === ""
      );
      if (existing) {
        return prev.map((c) =>
          c === existing ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [
        ...prev,
        {
          vendorId: selectedVendorId,
          vendorName,
          menuItemId: item.id,
          name: item.name,
          quantity: 1,
          notes: "",
          price_cents: item.price_cents,
        },
      ];
    });
  };

  const handleOptionSelect = (option: string) => {
    if (!optionTargetItem || !selectedVendorId) {
      setOptionModalOpen(false);
      setOptionTargetItem(null);
      return;
    }

    const item = optionTargetItem;
    const vendorName = findVendorName(selectedVendorId);

    setCart((prev) => [
      ...prev,
      {
        vendorId: selectedVendorId,
        vendorName,
        menuItemId: item.id,
        name: item.name,
        quantity: 1,
        // We keep the "Option: X" pattern so the vendor view still parses nicely
        notes: `Option: ${option}`,
        price_cents: item.price_cents,
      },
    ]);

    setOptionTargetItem(null);
    setOptionModalOpen(false);
  };

  const changeCartQuantity = (index: number, delta: number) => {
    setCart((prev) => {
      const next = [...prev];
      const item = next[index];
      if (!item) return prev;

      const newQty = item.quantity + delta;
      if (newQty <= 0) {
        next.splice(index, 1);
      } else {
        next[index] = { ...item, quantity: newQty };
      }
      return next;
    });
  };

  const updateCartNotes = (index: number, notes: string) => {
    setCart((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = { ...next[index], notes };
      return next;
    });
  };

  // --- Submit whole ticket (fan-out by vendor) ---

  const handleSubmitTicket = async () => {
    if (cart.length === 0) {
      setError("Basket is empty.");
      return;
    }

    try {
      setError(null);

      // Group cart items by vendor
      const byVendor = new Map<string, CartItem[]>();
      for (const item of cart) {
        if (!byVendor.has(item.vendorId)) {
          byVendor.set(item.vendorId, []);
        }
        byVendor.get(item.vendorId)!.push(item);
      }

      let sessionId = currentSession?.id ?? null;
      let ticketCode = currentSession?.ticketCode ?? null;

      const newSessionOrders: SessionOrderSummary[] = [];

      // Call /api/orders/create once per vendor
      for (const [vendorId, items] of byVendor.entries()) {
        const payload = {
          vendorId,
          paymentMethod,
          // optional taxRate left undefined for now
          items: items.map((c) => ({
            menuItemId: c.menuItemId,
            quantity: c.quantity,
            notes: c.notes || undefined,
          })),
          sessionId, // may be null for the first vendor -> backend creates session
        };

        const res = await fetch("/api/orders/create", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        const json: CreateOrderResponse = await res.json();

        if (!json.success || !json.order) {
          console.error("order create failed", json);
          setError(json.error ?? "Failed to create one of the vendor orders.");
          return;
        }

        // Capture / update session for subsequent vendors
        if (json.session?.id && json.session.ticket_code) {
          sessionId = json.session.id;
          ticketCode = json.session.ticket_code;
        }

        newSessionOrders.push({
          orderId: json.order.id,
          orderCode: json.order.order_code,
          vendorId: json.order.vendor_id,
          vendorName: findVendorName(json.order.vendor_id),
          totalCents: json.order.total_cents,
        });
      }

      // Update session state
      if (sessionId && ticketCode) {
        setCurrentSession({
          id: sessionId,
          ticketCode,
        });

        // Prepare print ticket for this submit
        setPrintTicket({
          ticketCode,
          orders: newSessionOrders,
        });
        setPrintOpen(true);
      }

      setSessionOrders((prev) => [...prev, ...newSessionOrders]);

      // Clear basket for next ticket (but keep session visible for printing)
      setCart([]);
    } catch (e) {
      console.error(e);
      setError("Unexpected error submitting ticket.");
    }
  };

  // --- UI ---

  if (loadingVendors && vendors.length === 0) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-xl font-semibold">Loading cashier…</p>
      </div>
    );
  }

  // Group cart for display by vendor
  const cartByVendor = cart.reduce<Record<string, CartItem[]>>((acc, item) => {
    if (!acc[item.vendorId]) acc[item.vendorId] = [];
    acc[item.vendorId].push(item);
    return acc;
  }, {});

  // Precompute totals for print ticket (safe even if null)
  const grossCentsForPrint =
    printTicket?.orders.reduce((sum, o) => sum + o.totalCents, 0) ?? 0;
  const netCentsForPrint = Math.round(
    grossCentsForPrint / (1 + VAT_RATE)
  );
  const vatCentsForPrint = grossCentsForPrint - netCentsForPrint;

  return (
    <div className="min-h-screen bg-black text-white p-4 space-y-4">
      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Waitless Cashier</h1>
          <p className="text-xs text-gray-400">
            Market Square — one ticket, multiple vendors
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {currentSession ? (
            <div className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-xs">
              <div className="uppercase tracking-wide text-gray-400">
                Active ticket
              </div>
              <div className="text-lg font-semibold">
                {currentSession.ticketCode}
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-500">
              No active ticket yet. Submitting this basket will start one.
            </div>
          )}

          <button
            onClick={handleStartNewTicket}
            className="text-xs px-3 py-2 rounded border border-gray-600 hover:bg-gray-800"
          >
            Start new ticket
          </button>
        </div>
      </header>

      {error && (
        <div className="border border-red-500 bg-red-950/40 text-red-200 text-sm px-3 py-2 rounded">
          {error}
        </div>
      )}

      {/* MAIN LAYOUT */}
      <div className="grid md:grid-cols-[2fr,1.5fr] gap-4">
        {/* LEFT: Vendors + Menu */}
        <div className="space-y-3">
          {/* Vendor tabs (toggle open/closed) */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {vendors.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  setSelectedVendorId((prev) => (prev === v.id ? null : v.id));
                  setError(null);
                }}
                className={`px-3 py-2 rounded-full text-sm whitespace-nowrap border
                  ${
                    v.id === selectedVendorId
                      ? "bg-white text-black border-white"
                      : "bg-zinc-900 text-gray-200 border-zinc-700 hover:bg-zinc-800"
                  }`}
              >
                {v.name}
              </button>
            ))}
          </div>

          {/* Collapsible menu for selected vendor */}
          <div className="border border-zinc-800 rounded-xl p-3 bg-zinc-900/60 min-h-[120px]">
            {!selectedVendorId ? (
              <p className="text-sm text-gray-500">
                Tap a vendor above to open its menu.
              </p>
            ) : loadingMenu ? (
              <p className="text-sm text-gray-400">Loading menu…</p>
            ) : menuItems.length === 0 ? (
              <p className="text-sm text-gray-500">
                No items found for this vendor.
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {menuItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addMenuItemToCart(item)}
                    className="text-left border border-zinc-700 rounded-lg p-2 hover:bg-zinc-800 flex flex-col justify-between"
                  >
                    <div>
                      <div className="text-sm font-semibold leading-tight">
                        {item.name}
                      </div>
                      {item.description && (
                        <div className="text-[11px] text-gray-400 mt-1 line-clamp-2">
                          {item.description}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-300 mt-2">
                      K {formatMoney(item.price_cents)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Global Basket + Ticket Summary */}
        <div className="space-y-3">
          {/* Basket */}
          <div className="border border-zinc-800 rounded-xl p-3 bg-zinc-900/80 space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-300">
                Basket (all vendors)
              </h2>
              <span className="text-xs text-gray-400">
                Total items:{" "}
                {cart.reduce((sum, item) => sum + item.quantity, 0)}
              </span>
            </div>

            {cart.length === 0 ? (
              <p className="text-sm text-gray-500">
                Tap items on the left (any vendor) to build one ticket.
              </p>
            ) : (
              <div className="space-y-3">
                {Object.entries(cartByVendor).map(([vendorId, items]) => (
                  <div key={vendorId} className="space-y-1">
                    <div className="text-xs font-semibold text-gray-300 border-b border-zinc-700 pb-1">
                      {findVendorName(vendorId)}
                    </div>
                    {items.map((item) => {
                      // Need global index in cart array for edits
                      const globalIndex = cart.findIndex((c) => c === item);
                      return (
                        <div
                          key={`${item.vendorId}-${item.menuItemId}-${globalIndex}`}
                          className="border border-zinc-700 rounded-lg p-2 text-xs space-y-1"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <div className="font-semibold">
                                {item.quantity}× {item.name}
                              </div>
                              {item.notes && (
                                <div className="text-[11px] text-gray-400 mt-0.5 whitespace-pre-line">
                                  {item.notes}
                                </div>
                              )}
                            </div>
                            <div className="text-right">
                              <div>
                                K{" "}
                                {formatMoney(
                                  item.quantity * item.price_cents
                                )}
                              </div>
                              <div className="flex gap-1 mt-1 justify-end">
                                <button
                                  onClick={() =>
                                    changeCartQuantity(globalIndex, -1)
                                  }
                                  className="px-2 py-0.5 border border-zinc-600 rounded"
                                >
                                  -
                                </button>
                                <button
                                  onClick={() =>
                                    changeCartQuantity(globalIndex, +1)
                                  }
                                  className="px-2 py-0.5 border border-zinc-600 rounded"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          </div>

                          <textarea
                            value={item.notes}
                            onChange={(e) =>
                              updateCartNotes(globalIndex, e.target.value)
                            }
                            placeholder="Notes (no chilli, extra sauce…)   "
                            className="w-full mt-1 bg-black/40 border border-zinc-700 rounded px-2 py-1 text-[11px] resize-none"
                            rows={2}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {/* Payment + totals + submit */}
            <div className="border-t border-zinc-800 pt-2 flex flex-col gap-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Payment method</span>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="bg-black/60 border border-zinc-700 rounded px-2 py-1 text-xs"
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="mobile_money">Mobile money</option>
                </select>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-gray-400">Ticket total</span>
                <span className="text-sm font-semibold">
                  K {formatMoney(cartTotalCents)}
                </span>
              </div>

              <button
                onClick={handleSubmitTicket}
                disabled={cart.length === 0}
                className="mt-1 w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-700 disabled:text-gray-400 text-sm font-semibold"
              >
                Submit ticket ({cart.length} lines)
              </button>
            </div>
          </div>

          {/* Session summary (all created orders) */}
          <div className="border border-zinc-800 rounded-xl p-3 bg-zinc-900/60 space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold uppercase tracking-wide text-gray-300 text-xs">
                Ticket summary
              </h2>
              {currentSession && (
                <span className="text-[11px] text-gray-400">
                  Receipt / QR code:{" "}
                  <span className="font-semibold">
                    {currentSession.ticketCode}
                  </span>
                </span>
              )}
            </div>

            {sessionOrders.length === 0 ? (
              <p className="text-gray-500 text-xs">
                Once you submit tickets, each vendor’s order will appear here.
              </p>
            ) : (
              <div className="space-y-1">
                {sessionOrders.map((s) => (
                  <div
                    key={s.orderId}
                    className="flex justify-between items-center border border-zinc-800 rounded px-2 py-1"
                  >
                    <div>
                      <div className="font-semibold">{s.vendorName}</div>
                      <div className="text-[11px] text-gray-400">
                        Order {s.orderCode}
                      </div>
                    </div>
                    <div className="text-xs font-semibold">
                      K {formatMoney(s.totalCents)}
                    </div>
                  </div>
                ))}

                <div className="border-t border-zinc-800 pt-1 flex justify-between">
                  <span className="text-gray-400">Total across vendors</span>
                  <span className="font-semibold">
                    K{" "}
                    {formatMoney(
                      sessionOrders.reduce(
                        (sum, s) => sum + s.totalCents,
                        0
                      )
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* OPTION MODAL */}
      {optionModalOpen && optionTargetItem && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 w-full max-w-xs space-y-3">
            <h3 className="text-sm font-semibold">
              Choose option for {optionTargetItem.name}
            </h3>
            <p className="text-[11px] text-gray-400">
              This item needs an option. It will appear as{" "}
              <span className="italic">Option: Beef / Chicken / Tofu</span> on
              the vendor side.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleOptionSelect("Beef")}
                className="w-full py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
              >
                Beef
              </button>
              <button
                onClick={() => handleOptionSelect("Chicken")}
                className="w-full py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
              >
                Chicken
              </button>
              <button
                onClick={() => handleOptionSelect("Tofu")}
                className="w-full py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
              >
                Tofu
              </button>
            </div>
            <button
              onClick={() => {
                setOptionModalOpen(false);
                setOptionTargetItem(null);
              }}
              className="w-full mt-1 py-1.5 rounded border border-zinc-700 text-[11px] text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* PRINT TICKET MODAL */}
      {printTicket && printOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
          <div className="bg-white text-black rounded-2xl p-4 w-full max-w-sm space-y-3 shadow-xl">
            {/* Logo + header */}
            <div className="flex flex-col items-center gap-1 border-b border-gray-200 pb-2">
              {/* change src to your actual logo file in /public */}
              <img
                src="/market-square-logo.png"
                alt="Market Square"
                className="h-10 object-contain mb-1"
              />
              <p className="text-[10px] tracking-wide uppercase text-gray-500">
                One space, many experiences
              </p>
            </div>

            {/* Ticket + QR row */}
            <div className="flex items-start justify-between pt-1">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500">
                  Ticket
                </p>
                <p className="font-mono text-xl font-semibold">
                  {printTicket.ticketCode}
                </p>
              </div>
              <div className="w-24 h-24">
                {(() => {
                  const origin =
                    typeof window !== "undefined"
                      ? window.location.origin
                      : "";
                  const url = `${origin}/status/${encodeURIComponent(
                    printTicket.ticketCode
                  )}`;
                  const src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                    url
                  )}`;
                  return (
                    <img
                      src={src}
                      alt="Ticket QR"
                      className="w-24 h-24 rounded border border-gray-300"
                    />
                  );
                })()}
              </div>
            </div>

            {/* Orders per vendor */}
            <div className="border-t border-gray-200 pt-2 space-y-1 text-xs">
              {printTicket.orders.map((o) => (
                <div
                  key={o.orderId}
                  className="flex justify-between items-center"
                >
                  <div>
                    <div className="font-semibold">{o.vendorName}</div>
                    <div className="text-[11px] text-gray-500">
                      Order {o.orderCode}
                    </div>
                  </div>
                  <div className="text-xs font-semibold">
                    K {formatMoney(o.totalCents)}
                  </div>
                </div>
              ))}
            </div>

            {/* Totals with VAT breakdown */}
            <div className="border-t border-gray-200 pt-2 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal (excl. VAT)</span>
                <span className="font-medium">
                  K {formatMoney(netCentsForPrint)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">
                  VAT ({Math.round(VAT_RATE * 100)}%) (included)
                </span>
                <span className="font-medium">
                  K {formatMoney(vatCentsForPrint)}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1">
                <span className="font-semibold">Total</span>
                <span className="font-semibold">
                  K {formatMoney(grossCentsForPrint)}
                </span>
              </div>
            </div>

            {/* Footer + buttons */}
            <div className="pt-2 space-y-2">
              <p className="text-[10px] text-gray-500 text-center">
                VAT included in prices. Present this slip and QR code at the
                collection point.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setPrintOpen(false);
                  }}
                  className="flex-1 py-2 rounded border border-gray-400 text-xs"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.print();
                    }
                  }}
                  className="flex-1 py-2 rounded bg-black text-white text-xs font-semibold"
                >
                  Print
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
