// Shared knowledge documents (same across all 3 tools)
export const DOC_TYPES = [
  { key: "market_sophistication", label: "Market Sophistication Document" },
  { key: "new_information", label: "New Information Prompt Document" },
  { key: "new_mechanism", label: "New Mechanism Prompt Document" },
  { key: "avatar_training", label: "Origins Edition / Evolved Avatar Training" },
  { key: "market_research", label: "Market Research Document" },
  { key: "winning_ad_template", label: "Winning Ad Template" },
] as const;

// System instructions (one per tool per store)
export const SYSTEM_PROMPT_TYPES = [
  { key: "system_angle_generator", label: "Angle Generator System Instruction" },
  { key: "system_script_creator", label: "Script Creator System Instruction" },
  { key: "system_format_expansion", label: "Format Expansion System Instruction" },
] as const;

// Auto-managed docs — written by the v2.0 feedback-loop cron, not by humans.
// Excluded from the readiness counter (totalRequired) since their absence
// just means "no winners yet" — the generator handles that gracefully.
export const AUTO_MANAGED_DOC_TYPES = [
  {
    key: "validated_winners_dna",
    label: "Validated Winners DNA (auto-managed)",
  },
] as const;

// All doc types that can be stored in ai_store_docs
export const ALL_DOC_TYPES = [
  ...DOC_TYPES,
  ...SYSTEM_PROMPT_TYPES,
  ...AUTO_MANAGED_DOC_TYPES,
] as const;

export type DocType = (typeof ALL_DOC_TYPES)[number]["key"];
export type ToolType = "angles" | "scripts" | "formats";

// Map tool_type to which system instruction to use
export const TOOL_TO_SYSTEM_PROMPT: Record<ToolType, string> = {
  angles: "system_angle_generator",
  scripts: "system_script_creator",
  formats: "system_format_expansion",
};

// Metadata jsonb on ai_store_docs. Empty `{}` for human-edited docs.
// `auto_managed: true` marks docs maintained by the v2.0 feedback-loop cron
// (currently `validated_winners_dna`). When an admin clears `auto_managed`
// they take ownership and the cron will skip overwriting that store's row.
export interface AiStoreDocMetadata {
  auto_managed?: boolean;
  generated_at?: string;
  source_winner_ids?: string[];
  default_template_version?: string;
}

export interface AiStoreDoc {
  id: string;
  store_name: string;
  doc_type: DocType;
  title: string;
  content: string;
  metadata: AiStoreDocMetadata;
  created_at: string;
  updated_at: string;
}

export interface AiGeneration {
  id: string;
  employee_id: string;
  store_name: string;
  tool_type: ToolType;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown>;
  created_at: string;
}

export interface GenerateRequest {
  store_name: string;
  tool_type: ToolType;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}
