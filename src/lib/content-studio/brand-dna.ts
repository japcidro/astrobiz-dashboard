import { createServiceClient } from "@/lib/supabase/service";

const cache = new Map<string, { value: string | null; at: number }>();
const TTL_MS = 60_000;

const MAX_KNOWLEDGE_CHARS = 4000;

export async function injectBrandDNA(
  storeName: string | null | undefined,
  basePrompt: string
): Promise<string> {
  if (!storeName) return basePrompt;
  const base = basePrompt || "";

  const cached = cache.get(storeName);
  let modifier: string | null;
  if (cached && Date.now() - cached.at < TTL_MS) {
    modifier = cached.value;
  } else {
    modifier = await buildModifier(storeName);
    cache.set(storeName, { value: modifier, at: Date.now() });
  }

  if (!modifier) return base;
  return `${modifier}\n\n---\n\n${base}`.trim();
}

async function buildModifier(storeName: string): Promise<string | null> {
  try {
    const admin = createServiceClient();

    const [{ data: storeRow }, { data: docs }] = await Promise.all([
      admin
        .from("shopify_stores")
        .select("prompt_modifier")
        .eq("name", storeName)
        .single(),
      admin
        .from("ai_store_docs")
        .select("doc_type, title, content")
        .eq("store_name", storeName)
        .not("doc_type", "like", "system_%"),
    ]);

    const quickOverride =
      ((storeRow?.prompt_modifier as string | null) || "").trim() || null;

    const knowledgeDocs = (docs || []) as Array<{
      doc_type: string;
      title: string;
      content: string;
    }>;

    const knowledgeBlock = buildKnowledgeBlock(knowledgeDocs);

    const parts: string[] = [];
    if (quickOverride) parts.push(`BRAND STYLE: ${quickOverride}`);
    if (knowledgeBlock) parts.push(knowledgeBlock);

    if (parts.length === 0) return null;
    return parts.join("\n\n");
  } catch {
    return null;
  }
}

function buildKnowledgeBlock(
  docs: Array<{ doc_type: string; title: string; content: string }>
): string | null {
  if (docs.length === 0) return null;

  // Prioritize docs most useful for visual brand sense
  const priority: Record<string, number> = {
    avatar_training: 1,
    market_research: 2,
    market_sophistication: 3,
    new_mechanism: 4,
    new_information: 5,
    winning_ad_template: 6,
  };

  const sorted = [...docs].sort(
    (a, b) => (priority[a.doc_type] ?? 99) - (priority[b.doc_type] ?? 99)
  );

  let totalChars = 0;
  const excerpts: string[] = [];

  for (const doc of sorted) {
    const content = (doc.content || "").trim();
    if (!content) continue;

    const remaining = MAX_KNOWLEDGE_CHARS - totalChars;
    if (remaining <= 100) break;

    const excerpt = content.length > remaining
      ? content.slice(0, remaining) + "..."
      : content;

    excerpts.push(`[${doc.title}]\n${excerpt}`);
    totalChars += excerpt.length + doc.title.length + 5;
  }

  if (excerpts.length === 0) return null;

  return `BRAND KNOWLEDGE (use for tone, audience, and visual direction — do not quote literally):\n\n${excerpts.join("\n\n")}`;
}

export async function getBrandDNAStatus(storeName: string): Promise<{
  hasQuickOverride: boolean;
  knowledgeDocCount: number;
}> {
  try {
    const admin = createServiceClient();
    const [{ data: storeRow }, { count }] = await Promise.all([
      admin
        .from("shopify_stores")
        .select("prompt_modifier")
        .eq("name", storeName)
        .single(),
      admin
        .from("ai_store_docs")
        .select("id", { count: "exact", head: true })
        .eq("store_name", storeName)
        .not("doc_type", "like", "system_%"),
    ]);
    return {
      hasQuickOverride: !!(storeRow?.prompt_modifier as string | null)?.trim(),
      knowledgeDocCount: count ?? 0,
    };
  } catch {
    return { hasQuickOverride: false, knowledgeDocCount: 0 };
  }
}
