// app/api/sessions/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function generateTicketCode() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `WL-${n}`;
}

export async function POST(_req: NextRequest) {
  try {
    // naive loop to avoid code collisions; fine at small scale
    let ticket_code = generateTicketCode();
    for (let i = 0; i < 5; i++) {
      const { data, error } = await supabaseAdmin
        .from("order_sessions")
        .insert({
          ticket_code,
        })
        .select("id, ticket_code, created_at, status, total_cents")
        .single();

      if (!error && data) {
        return NextResponse.json({
          success: true,
          session: {
            id: data.id,
            ticket_code: data.ticket_code,
            created_at: data.created_at,
            status: data.status,
            total_cents: data.total_cents,
          },
        });
      }

      // collision, try again
      ticket_code = generateTicketCode();
    }

    return NextResponse.json(
      { success: false, error: "Failed to create session after retries" },
      { status: 500 }
    );
  } catch (e) {
    console.error("sessions/start error", e);
    return NextResponse.json(
      { success: false, error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
