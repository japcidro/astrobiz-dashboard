import { PageHeader } from "@/components/ui/page-header";
import { GUIDES } from "@/lib/guides/registry";
import { loadGuideProgress } from "@/lib/guides/load";
import { AREA_INFO, AREA_ORDER } from "@/lib/guides/types";
import { canOpenDevDashboard } from "@/lib/owner";
import type { Employee } from "@/lib/types";
import { GuideCard } from "./guide-card";

const TOOLS_COMING = [
  "Clipper",
  "Script generator",
  "Cartoon generator",
  "Science b-roll",
  "Talking head",
  "Hook generator",
  "Static ad generator",
  "UGC generator",
  "Hook studio",
];

/** The Guides tab: every walkthrough by area, with where this employee is on each. */
export async function GuidesPage({ employee, email }: { employee: Employee; email: string | null | undefined }) {
  const progress = await loadGuideProgress(employee);
  const byId = new Map(progress.map((p) => [p.guide_id, p]));
  const devAccess = canOpenDevDashboard(email, employee.role);
  const available = GUIDES.filter((g) => !g.ownerSpace || devAccess);
  const finished = available.filter((g) => byId.get(g.id)?.completed_at).length;
  const pct = available.length ? Math.round((finished / available.length) * 100) : 0;

  return (
    <div className="max-w-6xl">
      <PageHeader title="Guides" subtitle="Short walkthroughs that run on the page itself. Watch one, or read the steps." />

      <div className="mb-6 flex flex-wrap items-center gap-x-7 gap-y-3 rounded-panel border border-line bg-panel px-4 py-3">
        <div>
          <div className="text-xs text-muted">Finished</div>
          <div className="font-num text-lg text-fg">
            {finished} of {available.length}
          </div>
        </div>
        <div className="h-1 min-w-40 flex-1 overflow-hidden rounded-sm bg-raised">
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {AREA_ORDER.map((area) => {
        const guides = GUIDES.filter((g) => g.area === area);
        if (guides.length === 0 && area !== "tools") return null;
        return (
          <section key={area} className="mb-6">
            <h2 className="text-[15px] text-fg">{AREA_INFO[area].title}</h2>
            <p className="mb-2.5 text-[13px] text-muted">{AREA_INFO[area].blurb}</p>
            {guides.length > 0 ? (
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {guides.map((g) => (
                  <GuideCard key={g.id} guide={g} progress={byId.get(g.id)} canOpen={!g.ownerSpace || devAccess} />
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-dim">{TOOLS_COMING.join(", ")}. One short guide each, as the tool arrives.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
