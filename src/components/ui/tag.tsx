import { cn } from "@/lib/utils";

export type TagTone = "neutral" | "good" | "warn" | "bad" | "info";

interface Props {
  tone?: TagTone;
  className?: string;
  children: React.ReactNode;
}

const tones: Record<TagTone, string> = {
  neutral: "text-muted",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-info",
};

/** A small mono label on a raised chip: a rubric item, a rule name, a SKU. */
export function Tag({ tone = "neutral", className, children }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-sm bg-raised px-1.5 py-px font-mono text-[11px] leading-4",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
