import { NextRequest, NextResponse } from "next/server";

// Temporary stub for menu availability, just to make the module valid.
// You can replace this with your real logic later.
export async function POST(req: NextRequest) {
  // TODO: read body, update availability, etc.
  return NextResponse.json(
    { success: true, message: "set-availablity stub OK" },
    { status: 200 }
  );
}
