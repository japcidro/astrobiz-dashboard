import { cn } from "@/lib/utils";

interface Props {
  /** warn: look at this. bad: do something now. */
  tone?: "warn" | "bad";
  /** A dashed outline: something to agree to before going on. */
  dashed?: boolean;
  /** A pill or a short bold lead on the first line. */
  title?: React.ReactNode;
  /** Buttons under the text. */
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** An outlined callout. Attention is rare, so a page shows at most one or two. */
export function Note({ tone = "warn", dashed, title, actions, className, children }: Props) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={cn(
        "grid gap-2 rounded-panel border px-4 py-3 text-sm text-fg",
        tone === "bad" ? "border-bad" : "border-warn",
        dashed && "border-dashed",
        className
      )}
    >
      {title && <div className="flex items-center gap-2">{title}</div>}
      <div className="min-w-0">{children}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
