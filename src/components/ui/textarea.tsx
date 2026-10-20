import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-control border border-line-strong bg-canvas p-2 text-sm text-fg placeholder:text-dim outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
