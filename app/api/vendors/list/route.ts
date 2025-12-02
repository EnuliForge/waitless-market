import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// IMPORTANT: no default export here.
// App Router wants a named export for each HTTP method.

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("vendors")
    .select("id, name, slug")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error(error);
    return NextResponse.json(
      { success: false, error: "Failed to load vendors" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { success: true, vendors: data ?? [] },
    { status: 200 }
  );
}
