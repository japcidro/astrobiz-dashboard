import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full border border-neutral-300 p-2 outline-none focus:border-neutral-500",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
