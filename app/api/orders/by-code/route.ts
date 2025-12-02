import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json(
        { success: false, error: "Missing order code" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
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
      .eq("order_code", code)
      .single();

    if (error || !data) {
      console.error("by-code error", error);
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      order: data,
    });
  } catch (e) {
    console.error("by-code unexpected", e);
    return NextResponse.json(
      { success: false, error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
