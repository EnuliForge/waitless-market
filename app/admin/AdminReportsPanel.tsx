"use client";

import { useState } from "react";

type DownloadState = "idle" | "loading" | "error" | "done";

async function downloadReport(
  type: "summary" | "vendors",
  date?: string
): Promise<void> {
  let url = `/api/admin/reports?type=${type}`;
  if (date) {
    url += `&date=${encodeURIComponent(date)}`;
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Report download failed with status ${res.status}`);
  }

  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);

  const suffix = date ?? new Date().toISOString().slice(0, 10);
  const filename =
    type === "summary"
      ? `market-square-summary-${suffix}.csv`
      : `market-square-vendors-${suffix}.csv`;

  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

export default function AdminReportsPanel({ date }: { date?: string }) {
  const [summaryState, setSummaryState] = useState<DownloadState>("idle");
  const [vendorsState, setVendorsState] = useState<DownloadState>("idle");

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sm font-semibold">Reports</h2>
        <p className="text-xs text-slate-400">
          Export a daily CSV for your overview and per-vendor performance.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Daily summary */}
        <button
          onClick={async () => {
            try {
              setSummaryState("loading");
              await downloadReport("summary", date);
              setSummaryState("done");
              setTimeout(() => setSummaryState("idle"), 2000);
            } catch (e) {
              console.error(e);
              setSummaryState("error");
              setTimeout(() => setSummaryState("idle"), 3000);
            }
          }}
          className="rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium hover:bg-slate-800"
        >
          {summaryState === "idle" && "Download daily summary CSV"}
          {summaryState === "loading" && "Preparing summary…"}
          {summaryState === "done" && "Summary ready ✅"}
          {summaryState === "error" && "Error, try again"}
        </button>

        {/* Vendor breakdown */}
        <button
          onClick={async () => {
            try {
              setVendorsState("loading");
              await downloadReport("vendors", date);
              setVendorsState("done");
              setTimeout(() => setVendorsState("idle"), 2000);
            } catch (e) {
              console.error(e);
              setVendorsState("error");
              setTimeout(() => setVendorsState("idle"), 3000);
            }
          }}
          className="rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium hover:bg-slate-800"
        >
          {vendorsState === "idle" && "Download vendor CSV"}
          {vendorsState === "loading" && "Preparing vendor report…"}
          {vendorsState === "done" && "Vendor report ready ✅"}
          {vendorsState === "error" && "Error, try again"}
        </button>
      </div>
    </div>
  );
}
