import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";
/**
 * primary: the one action on the page (accent).
 * secondary: a raised neutral button.
 * ghost: text only, for cancel and tertiary actions.
 * danger: outlined in the danger color; for clock out, delete, pause.
 */
type Variant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: Size;
  variant?: Variant;
}

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-6 text-base",
};

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink border-accent hover:bg-accent-hover",
  secondary: "bg-raised text-fg border-line-strong hover:border-dim",
  ghost: "bg-transparent text-muted border-transparent hover:bg-raised hover:text-fg",
  danger: "bg-transparent text-bad border-bad hover:bg-bad-soft",
};

/** The button look as a class string, for links that act like buttons. */
export function buttonClasses({
  size = "md",
  variant = "primary",
  className,
}: { size?: Size; variant?: Variant; className?: string } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-control border font-display text-sm transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none",
    sizes[size],
    variants[variant],
    className
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size = "md", variant = "primary", ...props }, ref) => {
    return <button ref={ref} className={buttonClasses({ size, variant, className })} {...props} />;
  }
);
Button.displayName = "Button";

type LinkButtonProps = React.ComponentProps<typeof Link> & {
  size?: Size;
  variant?: Variant;
};

/** A link that looks like a button: "Open orders", "Start verifying". */
export function LinkButton({ className, size = "md", variant = "primary", ...props }: LinkButtonProps) {
  return <Link className={buttonClasses({ size, variant, className })} {...props} />;
}
