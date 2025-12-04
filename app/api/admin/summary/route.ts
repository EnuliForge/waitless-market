// app/api/admin/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminSummary } from "@/lib/adminDashboard";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const rawDate = url.searchParams.get("date"); // "YYYY-MM-DD" or null
    const date = rawDate ?? undefined;            // coerce null → undefined

    const summary = await getAdminSummary(date);

    return NextResponse.json(
      { success: true, summary },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Error in /api/admin/summary:", err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message ?? "Failed to load admin summary",
      },
      { status: 500 }
    );
  }
}
