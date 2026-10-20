import { Tile, type Tone } from "@/components/ui/tile";

interface Props {
  label: string;
  value: string;
  subtitle?: string;
  tone?: Tone;
  hot?: boolean;
  loading: boolean;
  /** Kept for the pages still passing icons; the tile no longer shows them. */
  icon?: React.ReactNode;
  iconBg?: string;
  accentBorder?: string;
  subtitleColor?: string;
}

/** The old props carried meaning in class names; keep that meaning. */
function legacyTone(color?: string): Tone | undefined {
  if (!color) return undefined;
  if (/green|emerald/.test(color)) return "good";
  if (/yellow|amber|orange/.test(color)) return "warn";
  if (/red/.test(color)) return "bad";
  return undefined;
}

/**
 * The pre-system stat card, now a thin wrapper over Tile for the pages that
 * still pass icon and color props. New code uses Tile directly.
 */
export function StatCard({
  label,
  value,
  subtitle,
  tone: toneProp,
  hot: hotProp,
  loading,
  subtitleColor,
  accentBorder,
}: Props) {
  return (
    <Tile
      label={label}
      value={value}
      delta={subtitle}
      tone={toneProp ?? legacyTone(subtitleColor) ?? "neutral"}
      hot={hotProp ?? /red/.test(accentBorder ?? "")}
      loading={loading}
    />
  );
}
