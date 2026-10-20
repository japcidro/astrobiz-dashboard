import { cn } from "@/lib/utils";

interface Props {
  title: string;
  /** One line: what will fill this space. */
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** A dashed box where a list would be: a bold title and one line. */
export function EmptyState({ title, children, action, className }: Props) {
  return (
    <div
      className={cn(
        "grid justify-items-center gap-1.5 rounded-panel border border-dashed border-line-strong px-6 py-7 text-center",
        className
      )}
    >
      <p className="font-display text-sm text-fg">{title}</p>
      {children && <p className="max-w-prose text-sm text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
