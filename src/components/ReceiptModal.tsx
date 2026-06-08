"use client";

import { useRef, useEffect } from "react";
import { formatPeso } from "@/lib/format-peso";

interface ReceiptData {
  memberName: string;
  structureName: string;
  amountPaid: number;
  date: string;
  receiptId: string;
}

function numberToWords(n: number): string {
  if (n === 0) return "Zero Pesos Only";

  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function convertBelow1000(num: number): string {
    if (num === 0) return "";
    if (num < 20) return ones[num];
    if (num < 100) {
      const t = tens[Math.floor(num / 10)];
      const o = num % 10 !== 0 ? " " + ones[num % 10] : "";
      return t + o;
    }
    return ones[Math.floor(num / 100)] + " Hundred" + (num % 100 !== 0 ? " " + convertBelow1000(num % 100) : "");
  }

  function convertBelow1000000(num: number): string {
    if (num < 1000) return convertBelow1000(num);
    return convertBelow1000(Math.floor(num / 1000)) + " Thousand" + (num % 1000 !== 0 ? " " + convertBelow1000(num % 1000) : "");
  }

  const whole = Math.floor(n);
  const cents = Math.round((n - whole) * 100);

  let result = "";
  if (whole > 0) result = convertBelow1000000(whole) + " Pesos";
  if (cents > 0) result += (result ? " and " : "") + convertBelow1000(cents) + " Centavos";
  if (!result) result = "Zero Pesos";
  result += " Only";

  return result;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export default function ReceiptModal({
  data,
  onClose,
}: {
  data: ReceiptData;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = "/logo.png";
    img.onload = () => {
      logoRef.current = img;
      drawReceipt();
    };
    img.onerror = () => drawReceipt();
    drawReceipt();
  }, [data]);

  function drawReceipt() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 520;
    const H = 740;
    canvas.width = W;
    canvas.height = H;

    const RED = "#aa1f2a";
    const GOLD = "#c9a84c";
    const WARM_BG = "#fefcf6";
    const DARK = "#1a1a1a";
    const MUTED = "#666666";
    const LIGHT_BORDER = "#e0d8c8";
    const AMOUNT_BG = "#fdf3e0";
    const WHITE = "#ffffff";

    ctx.fillStyle = WARM_BG;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = RED;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(6, 6, W - 12, H - 12);

    ctx.strokeStyle = LIGHT_BORDER;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(10, 10, W - 20, H - 20);

    ctx.fillStyle = RED;
    ctx.fillRect(10, 28, W - 20, 78);

    const logo = logoRef.current;
    if (logo) {
      ctx.drawImage(logo, 26, 43, 48, 48);
    }

    ctx.fillStyle = WHITE;
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("KNIGHTS OF THE ALTAR", W / 2, 56);

    ctx.font = "12px sans-serif";
    ctx.fillText("Official Receipt", W / 2, 84);

    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 60, 112);
    ctx.lineTo(W / 2 + 60, 112);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const labelX = 32;
    const valueX = 150;
    let y = 138;
    const lineH = 30;

    function drawDetail(label: string, value: string) {
      ctx.font = "11px sans-serif";
      ctx.fillStyle = MUTED;
      ctx.fillText(label, labelX, y);
      ctx.fillStyle = DARK;
      ctx.font = "12px sans-serif";
      ctx.fillText(value, valueX, y);
      y += lineH;
    }

    drawDetail("Receipt No.:", data.receiptId.slice(0, 8).toUpperCase());
    drawDetail("Date:", data.date);

    y += 4;
    ctx.strokeStyle = LIGHT_BORDER;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(labelX, y);
    ctx.lineTo(W - labelX, y);
    ctx.stroke();
    y += 16;

    drawDetail("Member:", data.memberName);
    drawDetail("Payment:", data.structureName);

    y += 8;
    const amountBoxY = y;
    const amountBoxH = 58;
    ctx.fillStyle = AMOUNT_BG;
    ctx.fillRect(labelX, amountBoxY, W - labelX * 2, amountBoxH);

    ctx.font = "13px sans-serif";
    ctx.fillStyle = DARK;
    ctx.textAlign = "left";
    ctx.fillText("Amount Paid", labelX + 12, amountBoxY + amountBoxH / 2);

    ctx.font = "bold 24px sans-serif";
    ctx.fillStyle = RED;
    ctx.textAlign = "right";
    ctx.fillText(formatPeso(data.amountPaid), W - labelX - 12, amountBoxY + amountBoxH / 2);

    y = amountBoxY + amountBoxH + 12;

    ctx.font = "10px sans-serif";
    ctx.fillStyle = MUTED;
    ctx.textAlign = "left";
    ctx.fillText("Amount in Words:", labelX, y);
    y += 14;

    const words = numberToWords(data.amountPaid);
    ctx.font = "10px sans-serif";
    ctx.fillStyle = DARK;
    const maxWordWidth = W - labelX * 2;
    const wordLines = wrapText(ctx, words, maxWordWidth);
    for (const line of wordLines) {
      ctx.fillText(line, labelX, y);
      y += 14;
    }

    y = Math.max(y + 20, 530);

    ctx.strokeStyle = LIGHT_BORDER;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(labelX, y);
    ctx.lineTo(W - labelX, y);
    ctx.stroke();
    y += 20;

    ctx.font = "italic 14px sans-serif";
    ctx.fillStyle = RED;
    ctx.textAlign = "center";
    ctx.fillText("Thank you for your support!", W / 2, y);
    y += 28;

    ctx.font = "9px sans-serif";
    ctx.fillStyle = "#bbb";
    ctx.fillText(`Receipt ID: ${data.receiptId}`, W / 2, y);
    y += 20;

    ctx.strokeStyle = DARK;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(W - 220, y);
    ctx.lineTo(W - 40, y);
    ctx.stroke();

    ctx.font = "10px sans-serif";
    ctx.fillStyle = MUTED;
    ctx.textAlign = "center";
    ctx.fillText("Authorized Signature", W - 130, y + 14);

    y = H - 30;
    ctx.font = "8px sans-serif";
    ctx.fillStyle = "#bbb";
    ctx.textAlign = "center";
    ctx.fillText("Knights of the Altar Attendance Monitoring System", W / 2, y);
  }

  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `receipt-${data.receiptId.slice(0, 8)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--surface)] p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-[var(--accent)]">Payment Receipt</h2>
        <div className="mt-4">
          <canvas
            ref={canvasRef}
            className="w-full rounded-lg border border-[var(--border)]"
            style={{ aspectRatio: "520 / 740" }}
          />
        </div>
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
