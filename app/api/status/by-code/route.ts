import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    // 0) Validate
    if (!code) {
      return NextResponse.json(
        { success: false, error: "Missing code" },
        { status: 400 }
      );
    }

    // 1) Try treat code as a TICKET (order_sessions.ticket_code)
    const { data: session, error: sessionError } = await supabaseAdmin
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
            quantity,
            notes
          )
        )
      `
      )
      .eq("ticket_code", code)
      .single();

    if (session && !sessionError) {
      return NextResponse.json(
        {
          success: true,
          kind: "session",
          session,
        },
        { status: 200 }
      );
    }

    // 2) If no session found, fall back to treating code as a single ORDER
    const { data: order, error: orderError } = await supabaseAdmin
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

    if (order && !orderError) {
      return NextResponse.json(
        {
          success: true,
          kind: "order",
          order,
        },
        { status: 200 }
      );
    }

    // 3) Nothing found
    return NextResponse.json(
      { success: false, error: "No ticket or order found for this code." },
      { status: 404 }
    );
  } catch (e) {
    console.error("status/by-code unexpected", e);
    return NextResponse.json(
      { success: false, error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
