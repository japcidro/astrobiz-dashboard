import { Panel } from "@/components/ui/panel";
import { ActionItem } from "./action-item";

export interface NeedsYouItem {
  label: string;
  count: number;
  href: string;
  severity: "info" | "warning" | "danger";
}

interface Props {
  items: NeedsYouItem[];
  loading?: boolean;
}

/**
 * The "Needs you today" panel every role's home shows: one ActionItem per
 * thing with a count, or one quiet line when nothing does.
 */
export function NeedsYou({ items, loading = false }: Props) {
  const open = items.filter((item) => item.count > 0);
  return (
    <Panel title="Needs you today">
      {loading && open.length === 0 ? (
        <div className="space-y-2">
          <div className="h-8 animate-pulse rounded-control bg-raised" />
          <div className="h-8 animate-pulse rounded-control bg-raised" />
        </div>
      ) : open.length === 0 ? (
        <p className="py-row text-sm text-muted">Nothing needs you right now.</p>
      ) : (
        <div>
          {open.map((item) => (
            <ActionItem key={`${item.href}-${item.label}`} {...item} />
          ))}
        </div>
      )}
    </Panel>
  );
}
