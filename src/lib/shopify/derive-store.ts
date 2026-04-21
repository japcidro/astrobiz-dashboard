// Lowercases + strips non-alphanumerics so "I Love Patches" and
// "ilovepatches" and "ILP" → "ilovepatches" / "ilp" respectively
// and match regardless of spacing/casing.
function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Returns the store whose (normalized) name appears as a substring of
// the (normalized) campaign. Longest match wins so "i love patches"
// beats a sub-match like "patches". Returns null if none match.
export function deriveStore(
  campaign: string,
  storeNames: string[]
): string | null {
  const normCampaign = normalize(campaign);
  if (!normCampaign) return null;
  let best: { name: string; len: number } | null = null;
  for (const name of storeNames) {
    const key = normalize(name);
    if (!key) continue;
    if (normCampaign.includes(key)) {
      if (!best || key.length > best.len) {
        best = { name, len: key.length };
      }
    }
  }
  return best?.name ?? null;
}
