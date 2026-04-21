import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md" | "lg";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size = "md", ...props }, ref) => {
    const sizes = {
      sm: "h-7 px-2.5 text-xs",
      md: "h-9 px-4 text-sm",
      lg: "h-10 px-6 text-base",
    };
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center font-medium bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 disabled:pointer-events-none transition-colors cursor-pointer",
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
