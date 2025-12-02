import { NextRequest, NextResponse } from "next/server";
import { listVendorActiveOrders } from "@/core/orders";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const vendorId = searchParams.get("vendorId");

    if (!vendorId) {
      return NextResponse.json(
        { success: false, error: "Missing vendorId" },
        { status: 400 }
      );
    }

    const orders = await listVendorActiveOrders(vendorId);
    return NextResponse.json({ success: true, orders }, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { success: false, error: err.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
