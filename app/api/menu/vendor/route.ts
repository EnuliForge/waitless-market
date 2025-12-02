import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// IMPORTANT: no default export. Just a named GET.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const vendorId = searchParams.get("vendorId");

  if (!vendorId) {
    return NextResponse.json(
      { success: false, error: "Missing vendorId" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("id, name, price_cents, is_available")
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error(error);
    return NextResponse.json(
      { success: false, error: "Failed to load menu" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { success: true, items: data ?? [] },
    { status: 200 }
  );
}
