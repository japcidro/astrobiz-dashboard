import * as React from "react";
import { cn } from "@/lib/utils";

interface Props extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** The panel's name, set in the display face. */
  title?: React.ReactNode;
  /** A pill or a small action, on the title row's right. */
  actions?: React.ReactNode;
  /** Drop the inner padding when the body is a Table that wants its own edges. */
  flush?: boolean;
}

/**
 * A titled surface. Panels are for objects: a session, a list that needs a
 * name, a form. Lists and tables that stand alone sit on the canvas instead.
 */
export function Panel({ title, actions, flush, className, children, ...rest }: Props) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-panel border border-line bg-panel shadow-card",
        flush ? "" : "p-4",
        className
      )}
      {...rest}
    >
      {(title || actions) && (
        <div
          className={cn(
            "flex items-center justify-between gap-3",
            flush ? "px-4 pt-4 pb-2" : "mb-3"
          )}
        >
          {title ? <h2 className="min-w-0 truncate text-base text-fg">{title}</h2> : <span />}
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
