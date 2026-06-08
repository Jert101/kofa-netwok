"use client";

import { useRef } from "react";

interface ReceiptData {
  memberName: string;
  structureName: string;
  amountPaid: number;
  date: string;
  receiptId: string;
}

export default function ReceiptModal({
  data,
  onClose,
}: {
  data: ReceiptData;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = 400;
    const h = 500;
    canvas.width = w;
    canvas.height = h;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    ctx.font = "bold 22px sans-serif";
    ctx.fillStyle = "#1a1a1a";
    ctx.textAlign = "center";
    ctx.fillText("Knights of the Altar", w / 2, 50);

    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#555";
    ctx.fillText("Official Receipt", w / 2, 74);

    ctx.beginPath();
    ctx.moveTo(20, 90);
    ctx.lineTo(w - 20, 90);
    ctx.strokeStyle = "#ccc";
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#555";
    ctx.fillText("Receipt #:", 30, 120);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText(data.receiptId.slice(0, 8).toUpperCase(), 120, 120);

    ctx.fillStyle = "#555";
    ctx.fillText("Date:", 30, 142);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText(data.date, 120, 142);

    ctx.beginPath();
    ctx.moveTo(20, 158);
    ctx.lineTo(w - 20, 158);
    ctx.strokeStyle = "#eee";
    ctx.stroke();

    ctx.fillStyle = "#555";
    ctx.fillText("Member:", 30, 180);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText(data.memberName, 120, 180);

    ctx.fillStyle = "#555";
    ctx.fillText("Payment type:", 30, 202);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText(data.structureName, 120, 202);

    ctx.beginPath();
    ctx.moveTo(20, 218);
    ctx.lineTo(w - 20, 218);
    ctx.strokeStyle = "#eee";
    ctx.stroke();

    ctx.font = "bold 16px sans-serif";
    ctx.fillStyle = "#1a1a1a";
    ctx.textAlign = "right";
    ctx.fillText(
      `₱${data.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      w - 30,
      250
    );

    ctx.textAlign = "left";
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#555";
    ctx.fillText("Amount paid", 30, 250);

    ctx.beginPath();
    ctx.moveTo(20, 268);
    ctx.lineTo(w - 20, 268);
    ctx.strokeStyle = "#ccc";
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#999";
    ctx.fillText("Thank you for your support!", w / 2, h - 40);
    ctx.fillText("Knights of the Altar Attendance Monitoring System", w / 2, h - 24);

    const link = document.createElement("a");
    link.download = `receipt-${data.receiptId.slice(0, 8)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--surface)] p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-[var(--accent)]">Payment Receipt</h2>
        <div className="mt-4 space-y-2 text-sm">
          <p><span className="text-[var(--muted)]">Receipt #:</span> {data.receiptId.slice(0, 8).toUpperCase()}</p>
          <p><span className="text-[var(--muted)]">Date:</span> {data.date}</p>
          <p><span className="text-[var(--muted)]">Member:</span> {data.memberName}</p>
          <p><span className="text-[var(--muted)]">Payment type:</span> {data.structureName}</p>
          <p className="text-lg font-bold text-[var(--accent)]">
            ₱{data.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>

        <canvas ref={canvasRef} className="hidden" />

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={downloadPng}
            className="min-h-11 flex-1 rounded-xl bg-[var(--accent)] text-sm font-semibold text-white"
          >
            Download PNG
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 flex-1 rounded-xl border border-[var(--border)] text-sm font-medium text-[var(--muted)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
