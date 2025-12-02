// app/order/page.tsx
import { Suspense } from "react";
import OrderPageClient from "./OrderPageClient";

export default function OrderPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
          <p className="text-sm text-gray-400">Loading your order…</p>
        </div>
      }
    >
      <OrderPageClient />
    </Suspense>
  );
}
