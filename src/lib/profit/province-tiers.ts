import type { JtClassification } from "./types";

const LUZON_PROVINCES = [
  "METRO MANILA", "METRO-MANILA", "NCR", "RIZAL", "CAVITE", "LAGUNA",
  "BULACAN", "PAMPANGA", "BATANGAS", "TARLAC", "NUEVA ECIJA", "PANGASINAN",
  "ZAMBALES", "BATAAN", "AURORA", "NUEVA VIZCAYA", "QUIRINO", "ISABELA",
  "CAGAYAN", "BENGUET", "IFUGAO", "KALINGA", "MOUNTAIN PROVINCE", "APAYAO",
  "ABRA", "ILOCOS NORTE", "ILOCOS SUR", "LA UNION", "CAMARINES NORTE",
  "CAMARINES SUR", "ALBAY", "SORSOGON", "CATANDUANES", "MASBATE",
  "MARINDUQUE", "ROMBLON", "ORIENTAL MINDORO", "OCCIDENTAL MINDORO",
  "PALAWAN", "QUEZON",
];

/**
 * Get the delivery cutoff days for a province.
 * Luzon = 5 days, Visayas & Mindanao = 8 days.
 */
export function getProvinceCutoff(province: string): number {
  const p = province.toUpperCase().trim().replace(/-/g, " ");
  for (const luzonProv of LUZON_PROVINCES) {
    if (p === luzonProv) return 5;
  }
  return 8; // Visayas & Mindanao default
}

/**
 * Classify a J&T delivery based on status, age, and province.
 */
export function classifyJtDelivery(
  orderStatus: string,
  daysSinceSubmit: number,
  province: string
): JtClassification {
  const status = orderStatus.trim();

  if (status === "Delivered") return "Delivered";
  if (status === "Returned") return "Returned";
  if (status === "For Return") return "For Return";

  if (status === "In Transit" || status === "Delivering") {
    const cutoff = getProvinceCutoff(province);
    if (daysSinceSubmit > cutoff) return "Returned (Aged)";
    return "In Transit";
  }

  return "Pending";
}
