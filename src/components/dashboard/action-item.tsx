import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface Props {
  label: string;
  count: number;
  href: string;
  severity: "info" | "warning" | "danger";
  icon?: React.ReactNode;
}

const dots = {
  info: "bg-info",
  warning: "bg-warn",
  danger: "bg-bad",
};

/** One row in a "needs you" list: a severity dot, the item, the count, a link. */
export function ActionItem({ label, count, href, severity }: Props) {
  if (count === 0) return null;

  return (
    <Link
      href={href}
      className="group flex items-center gap-3 border-b border-line px-1 py-row last:border-b-0 hover:bg-raised"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dots[severity]}`} />
      <span className="flex-1 text-sm text-fg">{label}</span>
      <span className="font-num text-sm text-muted">{count}</span>
      <ArrowRight
        size={14}
        className="text-dim transition-colors group-hover:text-accent"
      />
    </Link>
  );
}
