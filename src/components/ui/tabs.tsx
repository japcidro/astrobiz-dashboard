"use client";

import { cn } from "@/lib/utils";

export interface Tab<T extends string = string> {
  value: T;
  label: React.ReactNode;
  /** A small mono count after the label. */
  count?: number;
}

interface Props<T extends string> {
  tabs: Tab<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** A row of tabs on one hairline; the active tab underlined in the accent. */
export function Tabs<T extends string>({ tabs, value, onChange, className }: Props<T>) {
  return (
    <div role="tablist" className={cn("flex gap-0.5 border-b border-line", className)}>
      {tabs.map((tab) => {
        const on = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.value)}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors cursor-pointer",
              on
                ? "border-accent font-medium text-fg"
                : "border-transparent text-muted hover:text-fg"
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn("font-num text-xs", on ? "text-accent" : "text-dim")}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
