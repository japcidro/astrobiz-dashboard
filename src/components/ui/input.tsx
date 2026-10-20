import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** The value is wrong: a danger border. Put the message in the Field's `error`. */
  error?: boolean;
}

/** The shared control look: canvas fill, hairline, accent ring on focus. */
export const controlClasses =
  "w-full rounded-control border border-line-strong bg-canvas px-3 py-2 text-sm text-fg placeholder:text-dim outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-50 aria-invalid:border-bad aria-invalid:focus:ring-bad-soft";

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={error || undefined}
      className={cn(controlClasses, "h-9", className)}
      {...props}
    />
  )
);
Input.displayName = "Input";
