import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md" | "lg";
  /**
   * primary: the one action on the page (accent).
   * secondary: a raised neutral button.
   * ghost: text only, for cancel and tertiary actions.
   * danger: outlined in the danger color; for clock out, delete, pause.
   */
  variant?: "primary" | "secondary" | "ghost" | "danger";
}

const sizes = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-6 text-base",
};

const variants = {
  primary: "bg-accent text-accent-ink border-accent hover:bg-accent-hover",
  secondary: "bg-raised text-fg border-line-strong hover:border-dim",
  ghost: "bg-transparent text-muted border-transparent hover:bg-raised hover:text-fg",
  danger: "bg-transparent text-bad border-bad hover:bg-bad-soft",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size = "md", variant = "primary", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-control border font-display text-sm transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none",
          sizes[size],
          variants[variant],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
