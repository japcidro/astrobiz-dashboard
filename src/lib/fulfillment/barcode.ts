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
