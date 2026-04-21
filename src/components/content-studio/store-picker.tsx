"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Store } from "lucide-react";

export function StorePicker({
  stores,
  current,
}: {
  stores: { name: string }[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("store", value);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2">
      <Store size={14} className="text-neutral-400" />
      <label className="text-[10px] font-bold font-mono uppercase tracking-widest text-neutral-500">
        Store
      </label>
      <select
        value={current}
        onChange={(e) => handleChange(e.target.value)}
        className="h-7 border border-neutral-300 px-2 text-[11px] font-mono bg-white"
      >
        {stores.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
