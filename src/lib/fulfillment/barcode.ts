/**
 * Generate a barcode data URL using JsBarcode.
 * Dynamically imports JsBarcode to avoid SSR issues.
 */
export async function generateBarcodeDataUrl(
  value: string,
  options?: { width?: number; height?: number; fontSize?: number; format?: string }
): Promise<string> {
  const JsBarcode = (await import("jsbarcode")).default;
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, {
    format: options?.format || "CODE128",
    width: options?.width || 2,
    height: options?.height || 40,
    fontSize: options?.fontSize || 12,
    margin: 5,
    displayValue: true,
  });
  return canvas.toDataURL("image/png");
}

/**
 * Generate a QR code data URL.
 * QR encodes any value reliably at small label sizes and scans from any angle.
 */
export async function generateQRDataUrl(
  value: string,
  options?: { size?: number; margin?: number; errorCorrectionLevel?: "L" | "M" | "Q" | "H" }
): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(value, {
    width: options?.size ?? 240,
    margin: options?.margin ?? 1,
    errorCorrectionLevel: options?.errorCorrectionLevel ?? "M",
  });
}
