import { NextRequest, NextResponse } from "next/server";
import { updateOrderStatus } from "@/core/orders";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { orderId, orderCode, toStatus, actor } = body as {
      orderId?: string;
      orderCode?: string;
      toStatus: "preparing" | "ready" | "collected";
      actor?: "vendor" | "cashier" | "system";
    };

    if (!orderId && !orderCode) {
      return NextResponse.json(
        { success: false, error: "orderId or orderCode is required" },
        { status: 400 }
      );
    }

    const result = await updateOrderStatus({
      orderId,
      orderCode,
      toStatus,
      actor: actor ?? "vendor",
    });

    return NextResponse.json({ success: true, order: result }, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { success: false, error: err.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
