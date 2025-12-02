// core/types.ts
export type OrderStatus = "preparing" | "ready" | "collected";

export type PaymentMethod = "cash" | "card" | "momo" | "other";

export interface CreateOrderItemInput {
  menuItemId: string;
  quantity: number;
  notes?: string;
}

export interface CreateOrderInput {
  vendorId: string;
  items: CreateOrderItemInput[];
  paymentMethod: PaymentMethod;
  taxRate?: number; // e.g. 16 for 16%, optional for now
}

export interface CreatedOrderResult {
  orderId: string;
  orderCode: string;
}
