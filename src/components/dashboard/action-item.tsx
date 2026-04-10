import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface Props {
  label: string;
  count: number;
  href: string;
  severity: "info" | "warning" | "danger";
  icon: React.ReactNode;
}

const dotColors = {
  info: "bg-blue-400",
  warning: "bg-yellow-400",
  danger: "bg-red-400",
};

const countColors = {
  info: "text-blue-400",
  warning: "text-yellow-400",
  danger: "text-red-400",
};

export function ActionItem({ label, count, href, severity, icon }: Props) {
  if (count === 0) return null;

  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-700/30 transition-colors group"
    >
      <div className={`w-2 h-2 rounded-full ${dotColors[severity]}`} />
      <span className="text-gray-400">{icon}</span>
      <span className="flex-1 text-sm text-gray-300">{label}</span>
      <span className={`text-sm font-semibold ${countColors[severity]}`}>
        {count}
      </span>
      <ChevronRight
        size={14}
        className="text-gray-600 group-hover:text-gray-400 transition-colors"
      />
    </Link>
  );
}
