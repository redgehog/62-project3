const QR_API = "https://api.qrserver.com/v1/create-qr-code/";

export function qrCodeUrl(data: string, size = 180): string {
  const params = new URLSearchParams({
    size:   `${size}x${size}`,
    data,
    format: "svg",
    qzone:  "1",
  });
  return `${QR_API}?${params.toString()}`;
}

export function receiptQrData(opts: {
  orderNumber: number;
  total: string;
  scheduledFor?: string;
}): string {
  const date = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  return [
    "BOBA HOUSE",
    `Order #${opts.orderNumber}`,
    `Total: $${opts.total}`,
    opts.scheduledFor ? `Pickup: ${opts.scheduledFor}` : null,
    date,
    "Thank you!",
  ].filter(Boolean).join("\n");
}
