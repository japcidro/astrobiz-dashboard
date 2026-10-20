import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { controlClasses } from "./input";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

/** A native select in the shared control look, with its own chevron. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, children, ...props }, ref) => (
    <div className={cn("relative min-w-0", className)}>
      <select
        ref={ref}
        aria-invalid={error || undefined}
        className={cn(controlClasses, "h-9 appearance-none pr-8 cursor-pointer")}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
      />
    </div>
  )
);
Select.displayName = "Select";
