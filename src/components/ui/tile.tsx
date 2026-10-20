import { cn } from "@/lib/utils";

export type Tone = "neutral" | "good" | "warn" | "bad";

interface Props {
  label: string;
  value: React.ReactNode;
  /** A small unit after the number: "/ 5", "h". */
  unit?: string;
  /** One line under the number: a delta or a note. */
  delta?: React.ReactNode;
  /** Colors the delta line only. */
  tone?: Tone;
  /** The tile needs attention right now: a danger edge, the number in red. */
  hot?: boolean;
  loading?: boolean;
  className?: string;
}

const tones: Record<Tone, string> = {
  neutral: "text-muted",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
};

/**
 * A stat tile: a label, a number in the numeric face, one line under it.
 * No icons, no tinted borders; only `hot` colors the tile, so it still means
 * something when it does.
 */
export function Tile({
  label,
  value,
  unit,
  delta,
  tone = "neutral",
  hot = false,
  loading = false,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-panel border bg-panel px-4 py-3 shadow-card",
        hot ? "border-bad" : "border-line",
        className
      )}
    >
      <p className="text-label text-muted">{label}</p>
      {loading ? (
        <div className="mt-1.5 h-7 w-20 animate-pulse rounded-control bg-raised" />
      ) : (
        <>
          <p
            className={cn(
              "mt-0.5 truncate font-num text-2xl tracking-tight",
              hot ? "text-bad" : "text-fg"
            )}
          >
            {value}
            {unit && <span className="ml-1 text-sm text-muted">{unit}</span>}
          </p>
          {delta && <p className={cn("mt-0.5 truncate text-xs", tones[tone])}>{delta}</p>}
        </>
      )}
    </div>
  );
}
