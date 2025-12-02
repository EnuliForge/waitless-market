import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");

  if (!slug) {
    return NextResponse.json(
      { success: false, error: "Missing slug" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("vendors")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();

  if (error || !data) {
    console.error(error);
    return NextResponse.json(
      { success: false, error: "Vendor not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, vendor: data }, { status: 200 });
}
