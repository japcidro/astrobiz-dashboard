"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Palette } from "lucide-react";
import { toast } from "sonner";
import { setTheme } from "@/lib/theme-actions";
import { THEMES, THEME_INFO, type Theme } from "@/lib/theme";

/**
 * Appearance, in the sidebar's user block. Five swatches; picking one
 * switches the page at once and saves it for this employee.
 */
export function AppearancePicker({ current }: { current: Theme }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Theme>(current);
  const [, startTransition] = useTransition();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (theme: Theme) => {
    const previous = active;
    setActive(theme);
    document.documentElement.setAttribute("data-theme", theme);
    startTransition(async () => {
      try {
        await setTheme(theme);
      } catch {
        setActive(previous);
        document.documentElement.setAttribute("data-theme", previous);
        toast.error("Could not save the theme. Try again.");
      }
    });
  };

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-fg cursor-pointer"
      >
        <Palette size={16} />
        Appearance
        <span className="ml-auto flex items-center gap-1.5 text-xs text-dim" aria-hidden>
          {THEME_INFO[active].name}
          <span
            className="h-3 w-3 rounded-full border border-line-strong"
            style={{ background: THEME_INFO[active].swatch[3] }}
          />
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Theme"
          className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-panel border border-line bg-panel p-1.5 shadow-float"
        >
          {THEMES.map((id) => {
            const info = THEME_INFO[id];
            const on = id === active;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  pick(id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left transition-colors cursor-pointer ${
                  on ? "bg-nav-on text-nav-on-fg" : "text-fg hover:bg-raised"
                }`}
              >
                <span
                  className="grid h-8 w-8 shrink-0 grid-cols-2 overflow-hidden rounded-control border border-line-strong"
                  aria-hidden
                >
                  {info.swatch.map((c, i) => (
                    <span key={i} style={{ background: c }} />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{info.name}</span>
                  <span className="block truncate text-xs text-muted">{info.blurb}</span>
                </span>
                {on && <Check size={14} className="shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
