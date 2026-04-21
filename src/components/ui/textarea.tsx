import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-white placeholder:text-gray-500 outline-none focus:ring-2 focus:ring-purple-500 focus:border-gray-700",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
