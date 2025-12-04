// app/api/admin/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminSummary } from "@/lib/adminDashboard";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date"); // optional "YYYY-MM-DD"

    const summary = await getAdminSummary(date);

    return NextResponse.json(
      { success: true, summary },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error in /api/admin/summary:", err);
    return NextResponse.json(
      { success: false, error: "Failed to load admin summary" },
      { status: 500 }
    );
  }
}
