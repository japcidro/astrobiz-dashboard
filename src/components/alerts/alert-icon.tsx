import {
  Package,
  TrendingDown,
  Trophy,
  Pause,
  Truck,
  AlertTriangle,
  Wifi,
  Tag,
  Sparkles,
} from "lucide-react";
import type { AlertType, AlertSeverity } from "@/lib/alerts/types";

const ICON_BY_TYPE: Record<AlertType, React.ReactNode> = {
  stock_restocked_winner: <Package size={16} />,
  stock_depleting_winner: <TrendingDown size={16} />,
  new_winner: <Trophy size={16} />,
  script_winner_deconstructed: <Sparkles size={16} />,
  autopilot_big_action: <Pause size={16} />,
  rts_spike: <Truck size={16} />,
  cash_at_risk: <AlertTriangle size={16} />,
  store_outage: <Wifi size={16} />,
  waybill_sender_mismatch: <Tag size={16} />,
};

const BG_BY_SEVERITY: Record<AlertSeverity, string> = {
  urgent: "bg-red-500/20 text-red-400",
  action: "bg-orange-500/20 text-orange-400",
  info: "bg-blue-500/20 text-blue-400",
};

interface Props {
  type: AlertType;
  severity: AlertSeverity;
  size?: "sm" | "md";
}

export function AlertIcon({ type, severity, size = "md" }: Props) {
  const dim = size === "sm" ? "w-7 h-7" : "w-9 h-9";
  return (
    <div
      className={`${dim} rounded-lg flex items-center justify-center flex-shrink-0 ${BG_BY_SEVERITY[severity]}`}
    >
      {ICON_BY_TYPE[type]}
    </div>
  );
}
