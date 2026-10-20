import { cn } from "@/lib/utils";

export type PillTone = "neutral" | "good" | "warn" | "bad" | "info";

interface Props {
  tone?: PillTone;
  /** A blinking recording dot before the text. Still under reduced motion. */
  rec?: boolean;
  className?: string;
  children: React.ReactNode;
}

const tones: Record<PillTone, string> = {
  neutral: "border-line-strong text-muted",
  good: "border-good text-good",
  warn: "border-warn text-warn",
  bad: "border-bad text-bad",
  info: "border-info text-info",
};

/** A status pill: outlined, mono, one or two words. Clocked in, Aging, Draft. */
export function Pill({ tone = "neutral", rec = false, className, children }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-0.5 font-mono text-[11.5px] leading-5",
        tones[tone],
        className
      )}
    >
      {rec && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-bad motion-reduce:animate-none"
        />
      )}
      {children}
    </span>
  );
}
