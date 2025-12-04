// app/api/admin/reports/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminSummary } from "@/lib/adminDashboard";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const rawDate = url.searchParams.get("date"); // "YYYY-MM-DD" or null
    const rawType = url.searchParams.get("type"); // "summary" | "vendors" | null

    const date = rawDate ?? undefined; // coerce null → undefined for getAdminSummary()
    const type = rawType ?? "summary"; // default to "summary" if not provided

    const summary = await getAdminSummary(date);
    const day = rawDate ?? new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // ===== SUMMARY CSV =====
    if (type === "summary") {
      const rows = [
        [
          "date",
          "orders_today",
          "revenue_kw",
          "tax_kw",
          "active_orders",
          "avg_prep_minutes",
        ],
        [
          day,
          summary.ordersToday.toString(),
          summary.revenueToday.toFixed(2),
          summary.taxToday.toFixed(2),
          summary.activeOrders.toString(),
          summary.avgPrepMinutesToday != null
            ? summary.avgPrepMinutesToday.toFixed(2)
            : "",
        ],
      ];

      const csv = rows.map((r) => r.join(",")).join("\n");

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="market-square-summary-${day}.csv"`,
        },
      });
    }

    // ===== VENDORS CSV =====
    if (type === "vendors") {
      const rows = [
        ["date", "vendor_id", "vendor_name", "revenue_kw"],
        ...summary.vendorSalesToday.map((v) => [
          day,
          v.vendorId,
          v.vendorName,
          v.total.toFixed(2),
        ]),
      ];

      const csv = rows.map((r) => r.join(",")).join("\n");

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="market-square-vendors-${day}.csv"`,
        },
      });
    }

    // Unknown type
    return NextResponse.json(
      { success: false, error: "Unknown report type" },
      { status: 400 }
    );
  } catch (err) {
    console.error("Error in /api/admin/reports:", err);
    return NextResponse.json(
      { success: false, error: "Failed to generate report" },
      { status: 500 }
    );
  }
}
