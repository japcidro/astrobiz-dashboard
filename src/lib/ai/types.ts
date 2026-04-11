export const DOC_TYPES = [
  { key: "system_instruction", label: "System Instruction" },
  { key: "market_sophistication", label: "Market Sophistication Document" },
  { key: "new_information", label: "New Information Prompt Document" },
  { key: "new_mechanism", label: "New Mechanism Prompt Document" },
  { key: "avatar_training", label: "Origins Edition / Evolved Avatar Training" },
  { key: "market_research", label: "Market Research Document" },
  { key: "winning_ad_template", label: "Winning Ad Template" },
] as const;

export type DocType = (typeof DOC_TYPES)[number]["key"];

export interface AiStoreDoc {
  id: string;
  store_name: string;
  doc_type: DocType;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export type ToolType = "angles" | "scripts" | "formats";

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
  user_input: string;
  count: number;
}
