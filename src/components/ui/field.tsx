import * as React from "react";
import { cn } from "@/lib/utils";

interface Props {
  label: React.ReactNode;
  /** The id of the control inside, so the label focuses it. */
  htmlFor?: string;
  /** One line under the control. In the danger color when `error` is set. */
  help?: React.ReactNode;
  /** The error message; replaces `help` and colors the line. */
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** A label, a control, and one help line. Pair it with Input or Select. */
export function Field({ label, htmlFor, help, error, className, children }: Props) {
  const line = error ?? help;
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm text-muted">
        {label}
      </label>
      {children}
      {line && (
        <p className={cn("text-xs", error ? "text-bad" : "text-muted")} role={error ? "alert" : undefined}>
          {line}
        </p>
      )}
    </div>
  );
}
