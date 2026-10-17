"use client";

import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, FileText, Film, Loader2, RefreshCw, Sparkles, Trash2, Trophy, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DnaView, ReferenceSource, RunView, ScriptRow, StudioPage, Winner, WinnersView } from "@/lib/script-studio/types";
import { DEFAULT_VERSIONS, isRecent } from "@/lib/script-studio/types";
import { cleanScript, hasHiddenDetails } from "@/lib/script-studio/clean";
import { Button, ConfirmButton, Label, Panel, Pill, api, timeAgo } from "@/components/hook-studio/ui";

const field = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";

/** One number for the card: the hook and the structure weigh double, since they are what won. */
const overall = (s: ScriptRow) => {
  const r = s.review;
  if (!r || r.checking) return null;
  const x = r.scores;
  return Math.round(((x.hook * 2 + x.structure * 2 + x.language + x.compliance + x.brand) / 7) * 10) / 10;
};

const peso = (n: number | null) => (n === null ? "no buys" : `₱${n.toLocaleString("en-PH")}`);

/**
 * Script Generator: a winning video ad's script in, our brand's script out.
 * The skill decodes what won in the reference, maps every beat onto our
 * brand from the brand kit and the Winning DNA, writes the versions and
 * reviews each with scores. Same structure and language as the reference;
 * notes are the only steering.
 */
export function ScriptGenerator() {
  const params = useSearchParams();
  const itemId = params.get("item");
  const [page, setPage] = useState<StudioPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [script, setScript] = useState("");
  /** The full transcript behind a clean view: timestamps and captions the skill reads but the box hides. Dropped once the text is edited. */
  const [hidden, setHidden] = useState<{ raw: string; clean: string } | null>(null);
  const [label, setLabel] = useState("");
  const [source, setSource] = useState<ReferenceSource>("paste");
  const [store, setStore] = useState("");
  const [notes, setNotes] = useState("");
  const [versions, setVersions] = useState(DEFAULT_VERSIONS);
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState<"board" | "winners" | null>(null);
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [dnaOpen, setDnaOpen] = useState(false);
  const [rewrite, setRewrite] = useState<{ id: string; note: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** "refresh", or the ad id being transcribed. */
  const [winBusy, setWinBusy] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [briefStore, setBriefStore] = useState("");
  const seeded = useRef(false);
  const reviewing = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const p = await api<StudioPage>(`/api/owner/script-generator${itemId ? `?item=${itemId}` : ""}`);
      setPage(p);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [itemId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const transcribe = useCallback(
    async (id: string) => {
      setTranscribing(id);
      setError(null);
      try {
        const r = await api<{ text: string; label: string; seconds: number | null }>("/api/owner/script-generator/transcribe", { method: "POST", body: JSON.stringify({ item_id: id }) });
        const clean = cleanScript(r.text);
        setScript(clean);
        setHidden(hasHiddenDetails(r.text) ? { raw: r.text, clean } : null);
        setLabel(r.label);
        setSource("board");
        setPicker(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Transcription failed");
      } finally {
        setTranscribing(null);
      }
    },
    []
  );

  // First load: the brand from the card (FOLIQ otherwise), and a card's own video transcribed straight into the box.
  useEffect(() => {
    if (!page || seeded.current) return;
    seeded.current = true;
    setStore(page.item?.store ?? (page.stores.includes("FOLIQ") ? "FOLIQ" : page.stores[0] ?? ""));
    if (page.item?.has_video && !script) void transcribe(page.item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const runs = useMemo(() => page?.runs ?? [], [page]);
  const writing = runs.some((r) => r.scripts.some((s) => s.status === "writing"));
  const pendingReview = runs.some((r) => r.scripts.some((s) => s.status === "done" && (!s.review || s.review.checking)));

  // Reviews run from here: the server scores whatever finished and has no review yet.
  useEffect(() => {
    if (!pendingReview || reviewing.current) return;
    reviewing.current = true;
    api<{ runs: RunView[] }>("/api/owner/script-generator/review", { method: "POST", body: JSON.stringify({ item_id: itemId }) })
      .then((r) => setPage((p) => (p ? { ...p, runs: r.runs } : p)))
      .catch(() => {})
      .finally(() => {
        reviewing.current = false;
      });
  }, [pendingReview, itemId, runs]);

  useEffect(() => {
    const t = setInterval(() => void refresh(), writing || pendingReview ? 10_000 : 60_000);
    return () => clearInterval(t);
  }, [refresh, writing, pendingReview]);

  const dna: DnaView | null = store && page ? page.dna[store] ?? null : null;
  const winners: WinnersView | null = store && page ? page.winners[store] ?? null : null;
  const canRun = script.trim().length >= 40 && !!store && busy === null;

  // The brand's standing brief follows the brand picked; unsaved typing is kept until the brand changes.
  useEffect(() => {
    if (!store || store === briefStore) return;
    setBriefStore(store);
    setBrief(dna?.brief ?? "");
  }, [store, briefStore, dna]);

  const winnersCall = useCallback(
    async (body: Record<string, unknown>, key: string) => {
      setWinBusy(key);
      setError(null);
      try {
        const r = await api<{ winners: WinnersView }>("/api/owner/script-generator/winners", { method: "POST", body: JSON.stringify({ store, ...body }) });
        setPage((p) => (p ? { ...p, winners: { ...p.winners, [store]: r.winners } } : p));
        return r.winners;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the winners");
        return null;
      } finally {
        setWinBusy(null);
      }
    },
    [store]
  );

  // The winners list comes from the ad data: built when missing, refreshed when a day old.
  const stale = !winners || Date.now() - new Date(winners.refreshed_at).getTime() > 24 * 3_600_000;
  useEffect(() => {
    if (!page || !store || !stale || winBusy) return;
    void winnersCall({}, "refresh");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, store, stale]);
  /** What the skill gets: the full transcript while the clean view is untouched, else the text as edited. */
  const detailsIntact = !!hidden && script === hidden.clean;
  const scriptForSkill = detailsIntact ? hidden.raw : script;

  const adapt = async () => {
    setBusy("run");
    setError(null);
    try {
      const r = await api<{ id: string; runs: RunView[] }>("/api/owner/script-generator/adapt", {
        method: "POST",
        body: JSON.stringify({ item_id: itemId, store, script: scriptForSkill, label, source, notes, versions }),
      });
      setPage((p) => (p ? { ...p, runs: r.runs } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start");
      void refresh();
    } finally {
      setBusy(null);
    }
  };

  const rebuildDna = async () => {
    setBusy("dna");
    setError(null);
    try {
      const r = await api<{ dna: DnaView }>("/api/owner/script-generator/dna", { method: "POST", body: JSON.stringify({ store }) });
      setPage((p) => (p ? { ...p, dna: { ...p.dna, [store]: r.dna } } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rebuild");
    } finally {
      setBusy(null);
    }
  };

  const act = async (id: string, body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError(null);
    try {
      await api(`/api/owner/script-generator/scripts/${id}`, { method: "POST", body: JSON.stringify(body) });
      setRewrite(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not do that");
    } finally {
      setBusy(null);
    }
  };

  const removeRun = async (id: string) => {
    setBusy("delete");
    try {
      await api(`/api/owner/script-generator/runs/${id}`, { method: "DELETE" });
      setPage((p) => (p ? { ...p, runs: p.runs.filter((r) => r.id !== id) } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (s: ScriptRow) => {
    try {
      await navigator.clipboard.writeText(s.script_text);
      setCopied(s.id);
      setTimeout(() => setCopied((c) => (c === s.id ? null : c)), 1500);
    } catch {
      setError("Could not copy; select the text instead");
    }
  };

  const pickWinner = (w: Winner) => {
    const clean = cleanScript(w.transcript);
    setScript(clean);
    setHidden(hasHiddenDetails(w.transcript) ? { raw: w.transcript, clean } : null);
    setLabel(`${store} winner · ${w.ad}`);
    setSource("winner");
    setPicker(null);
  };

  const saveBrief = async () => {
    setBusy("brief");
    setError(null);
    try {
      const r = await api<{ dna: DnaView }>("/api/owner/script-generator/brief", { method: "PUT", body: JSON.stringify({ store, brief }) });
      setPage((p) => (p ? { ...p, dna: { ...p.dna, [store]: r.dna } } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the brief");
    } finally {
      setBusy(null);
    }
  };
  const briefDirty = brief !== (dna?.brief ?? "");
  const launched = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : "");

  return (
    <div className="max-w-7xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
          <FileText size={22} className="text-purple-400" /> Script Generator
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {page?.item ? (
            <>
              Adapting <span className="text-gray-300">{page.item.title || "a board video"}</span> ·{" "}
              <Link href="/owner/marketing-board" className="text-purple-300 hover:text-white">
                back to the board
              </Link>
            </>
          ) : (
            "A winning ad's script in, our script out. The skill decodes what won, keeps that structure and language, and swaps everything that is theirs for ours."
          )}
        </p>
      </div>
      {error && (
        <p className="text-xs text-red-300 inline-flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      <Panel>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-5 items-start">
          <div>
            <Label>Reference script · the ad we are adapting</Label>
            <textarea
              value={script}
              onChange={(e) => {
                setScript(e.target.value);
                if (hidden && e.target.value !== hidden.clean) setHidden(null);
                if (source !== "paste") setSource("paste");
              }}
              rows={14}
              placeholder={transcribing ? "Transcribing the video…" : "Paste the reference ad's script here, or transcribe a board video below."}
              className={`${field} resize-y leading-relaxed`}
              disabled={!!transcribing}
            />
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <Button onClick={() => setPicker((v) => (v === "board" ? null : "board"))} busy={!!transcribing} className="!px-2.5 !py-1 !text-xs">
                <Film size={12} /> Transcribe a board video
              </Button>
              <Button ghost onClick={() => setPicker((v) => (v === "winners" ? null : "winners"))} disabled={!store} className="!px-2.5 !py-1 !text-xs">
                <Trophy size={12} /> One of our winners
              </Button>
              {script && (
                <Button ghost onClick={() => { setScript(""); setHidden(null); setLabel(""); setSource("paste"); }} className="!px-2.5 !py-1 !text-xs">
                  <X size={12} /> Clear
                </Button>
              )}
              {label && <span className="text-[11px] text-gray-500 truncate">{label}</span>}
              {detailsIntact && <span className="text-[11px] text-gray-600">Spoken words only; the timestamps and on-screen captions stay hidden and still go to the skill.</span>}
              {transcribing && (
                <span className="text-[11px] text-purple-300 inline-flex items-center gap-1">
                  <Loader2 size={11} className="animate-spin" /> Gemini is reading the video, about a minute
                </span>
              )}
            </div>
            {picker === "board" && (
              <div className="mt-2 rounded-lg bg-gray-950 border border-gray-800 p-2 max-h-72 overflow-y-auto grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {(page?.board_videos ?? []).map((v) => (
                  <button key={v.id} type="button" onClick={() => void transcribe(v.id)} className="text-left cursor-pointer hover:bg-white/5 rounded-md p-0.5" title={v.title}>
                    {v.thumb_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.thumb_url} alt="" className="w-full aspect-[9/12] object-cover rounded" loading="lazy" />
                    ) : (
                      <div className="w-full aspect-[9/12] rounded bg-gray-900" />
                    )}
                    <p className="text-[9px] text-gray-400 truncate">{v.title}</p>
                    <p className="text-[9px] text-gray-600 truncate">{[v.author, v.seconds ? `${v.seconds}s` : ""].filter(Boolean).join(" · ")}</p>
                  </button>
                ))}
                {(page?.board_videos ?? []).length === 0 && (
                  <p className="col-span-4 text-xs text-gray-500 p-2">
                    No saved videos on the board yet. Paste a link on the{" "}
                    <Link href="/owner/marketing-board" className="text-purple-300 hover:text-white">
                      Marketing Board
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}
            {picker === "winners" && (
              <div className="mt-2 rounded-lg bg-gray-950 border border-gray-800">
                <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-gray-500 border-b border-gray-900">
                  <span className="flex-1">
                    Our {store} creatives that sold, newest first, scaled copies counted in{winners ? ` · ${winners.winners.length}` : ""}
                  </span>
                  {winBusy === "refresh" ? (
                    <span className="inline-flex items-center gap-1 text-purple-300">
                      <Loader2 size={10} className="animate-spin" /> Reading the ad data
                    </span>
                  ) : (
                    <button type="button" onClick={() => void winnersCall({ refresh: true }, "refresh")} className="inline-flex items-center gap-1 hover:text-white cursor-pointer">
                      <RefreshCw size={10} /> {winners ? `refreshed ${timeAgo(winners.refreshed_at)}` : "refresh"}
                    </button>
                  )}
                </div>
                <div className="divide-y divide-gray-900 max-h-96 overflow-y-auto">
                  {(winners?.winners ?? []).map((w) => {
                    const fresh = isRecent(w.created_time, dna?.anchor_days ?? 45);
                    const transcribing = winBusy === w.ad_id;
                    return (
                      <div key={w.ad_id} className="px-3 py-2 grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3 items-center text-xs">
                        <div className="w-10 h-[52px] rounded bg-gray-900 overflow-hidden border border-gray-800">
                          {w.thumbnail_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={w.thumbnail_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-gray-200 truncate">
                            <span className="font-mono text-[11px]">{w.ad}</span>
                            {w.verdict === "early" ? (
                              <span className="ml-1.5 rounded-full bg-green-900 text-green-200 text-[9px] font-extrabold px-1.5 py-px tracking-wide">EARLY WINNER</span>
                            ) : fresh ? (
                              <span className="ml-1.5 rounded-full bg-purple-900 text-purple-200 text-[9px] font-extrabold px-1.5 py-px tracking-wide">NEW</span>
                            ) : null}
                            {w.verdict === "loser" && <span className="ml-1.5 text-[9px] text-red-400 font-semibold">high CPA</span>}
                            {(w.ad_ids?.length ?? 1) > 1 && <span className="ml-1.5 text-[9px] text-gray-500">+ {w.ad_ids!.length - 1} scaled {w.ad_ids!.length - 1 === 1 ? "copy" : "copies"}</span>}
                          </p>
                          <p className="text-gray-500 truncate">
                            {launched(w.created_time)}
                            {w.seconds ? ` · ${w.seconds}s` : ""}
                            {w.hook ? ` · ${w.hook}` : " · no script yet"}
                          </p>
                          <p className="font-mono text-[11px]">
                            <span className="text-green-400">{w.purchases} buys</span> <span className="text-gray-500">· {peso(w.cpa)} per buy · ₱{w.spend.toLocaleString("en-PH")} spent</span>
                          </p>
                        </div>
                        {w.transcript ? (
                          <Button primary onClick={() => pickWinner(w)} className="!px-2.5 !py-1 !text-[11px]">
                            Use as reference
                          </Button>
                        ) : (
                          <Button ghost onClick={() => void winnersCall({ ad_id: w.ad_id }, w.ad_id)} busy={transcribing} disabled={winBusy !== null} className="!px-2.5 !py-1 !text-[11px]">
                            {transcribing ? "Reading, about a minute" : "Transcribe"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {winners && winners.winners.length === 0 && <p className="text-xs text-gray-500 p-3">No {store} ads with purchases in the cached ad data yet. Open the Ad Performance page for the weeks the ads ran, then refresh.</p>}
                  {!winners && winBusy !== "refresh" && <p className="text-xs text-gray-500 p-3">No list yet; refresh to read the ad data.</p>}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <Label>Adapt for</Label>
              <select value={store} onChange={(e) => setStore(e.target.value)} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500">
                {(page?.stores ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {store && page && !page.profiled.includes(store) && <p className="text-[11px] text-amber-300 mt-1">No brand profile for {store} yet; the writer will only know the product&apos;s name. Add one in the Clipper&apos;s brand kit.</p>}
            </div>
            <div>
              <Label>Notes · optional</Label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder='e.g. "keep the barber pointing at the crown", "walang price", "gawing mas Tagalog yung hook", "mention the 2-bottle bundle"' className={`${field} resize-none`} />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button primary onClick={() => void adapt()} busy={busy === "run"} disabled={!canRun}>
                <Sparkles size={13} /> Adapt for {store || "…"} · {versions} {versions === 1 ? "version" : "versions"}
              </Button>
              <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
                {[1, 2, 4].map((n) => (
                  <button key={n} type="button" onClick={() => setVersions(n)} className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${versions === n ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                    {n}
                  </button>
                ))}
              </div>
              <span className="text-xs text-gray-500">about 2 min: decode what won → map every beat → write → review</span>
            </div>
            <p className="text-[11px] text-gray-600">Same structure, same language mix and about the same length as the reference. Only what is theirs changes.</p>
          </div>
        </div>
      </Panel>

      {store && (
        <Panel>
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-64">
              <Label>Winning DNA · {store}</Label>
              {dna && dna.dna ? (
                <p className="text-xs text-gray-400">
                  {dna.ads_read > 0 ? `Built from ${dna.ads_read} of our ads and their purchases, ${dna.winning_now} of them launched in the last ${dna.anchor_days} days (what is winning now)` : "A hand-written first brief from our winning ads; rebuild it to anchor on the newest winners"} · {timeAgo(dna.built_at)}. The skill reads it to fill what the reference cannot give us, newest winners first.
                </p>
              ) : (
                <p className="text-xs text-amber-300">No Winning DNA for {store} yet. Rebuild it from our winners, or run without it (the writer then only has the brand profile and your brief).</p>
              )}
            </div>
            <Button ghost onClick={() => void rebuildDna()} busy={busy === "dna"} className="!px-2.5 !py-1 !text-xs">
              <RefreshCw size={12} /> Rebuild from winners
            </Button>
            {dna && dna.dna && (
              <button type="button" onClick={() => setDnaOpen((v) => !v)} className="text-[11px] text-gray-400 hover:text-white inline-flex items-center gap-1 cursor-pointer">
                {dnaOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Read the brief
              </button>
            )}
          </div>
          {busy === "dna" && <p className="text-[11px] text-purple-300 mt-2">Reading the newest winners (transcribing up to two that have no script yet), then writing the brief. Two to four minutes.</p>}
          {dnaOpen && dna && dna.dna && <pre className="mt-3 text-xs text-gray-300 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto rounded-lg bg-gray-950 border border-gray-800 p-3 font-sans">{dna.dna}</pre>}
          <div className="mt-4">
            <Label>Your brief for {store} · read before every run</Label>
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} placeholder={`Standing facts and rules the skill must follow for every ${store} script: the offer running now, the skit setup and cast, lines to always keep, things never to say.`} className={`${field} resize-y`} />
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <Button primary={briefDirty} ghost={!briefDirty} onClick={() => void saveBrief()} busy={busy === "brief"} disabled={!briefDirty || busy !== null} className="!px-2.5 !py-1 !text-xs">
                {briefDirty ? "Save the brief" : "Saved"}
              </Button>
              <span className="text-[11px] text-gray-600">Applied above the Winning DNA and the brand profile; only a run&apos;s own notes can override it.</span>
            </div>
          </div>
        </Panel>
      )}

      {page === null ? (
        <Loader2 size={20} className="mx-auto my-10 animate-spin text-gray-500" />
      ) : runs.length === 0 ? (
        <Panel>
          <p className="text-sm text-gray-500 text-center my-6">Nothing adapted yet.</p>
        </Panel>
      ) : (
        runs.map((run) => {
          const scored = run.scripts.filter((s) => overall(s) !== null && s.review?.ok !== false);
          const bestId = scored.length > 1 ? scored.reduce((a, b) => (overall(a)! >= overall(b)! ? a : b)).id : null;
          const planOpen = openPlan === run.id;
          return (
            <Panel key={run.id}>
              <div className="flex items-start gap-3 flex-wrap mb-3">
                <div className="flex-1 min-w-64">
                  <p className="text-sm text-white">{run.study?.angle ?? (run.error ? "Could not read the reference" : "Reading the reference…")}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {timeAgo(run.created_at)} · {run.store}
                    {run.reference_label ? ` · ${run.reference_label}` : ""}
                    {run.study ? ` · ${run.study.language}` : ""}
                    {run.plan ? ` · ${run.plan.target_seconds} s target` : ""}
                    {run.notes ? ` · notes: ${run.notes}` : ""}
                  </p>
                  {run.error && <p className="text-[11px] text-red-300 mt-1">{run.error}</p>}
                </div>
                {run.study && run.plan && (
                  <button type="button" onClick={() => setOpenPlan(planOpen ? null : run.id)} className="text-[11px] text-gray-400 hover:text-white inline-flex items-center gap-1 cursor-pointer">
                    {planOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} What the skill did
                  </button>
                )}
                <ConfirmButton question="Delete run?" label="Delete" onConfirm={() => void removeRun(run.id)} className="text-[11px] text-gray-500 hover:text-red-300 inline-flex items-center gap-1 cursor-pointer">
                  <Trash2 size={11} />
                </ConfirmButton>
              </div>

              {planOpen && run.study && run.plan && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 text-xs">
                  <div className="rounded-lg bg-gray-950 border border-gray-800 p-3 space-y-1.5">
                    <p className="text-white font-semibold">1 · What won in the reference</p>
                    <p className="text-gray-400"><span className="text-gray-500">Hook move:</span> {run.study.hook_move}</p>
                    <p className="text-gray-400"><span className="text-gray-500">Language:</span> {run.study.language} · <span className="text-gray-500">Tone:</span> {run.study.tone}</p>
                    <p className="text-gray-400"><span className="text-gray-500">Why it works:</span> {run.study.why_it_works}</p>
                    <div className="pt-1">
                      {run.study.structure.map((b, i) => (
                        <p key={i} className="text-gray-400 border-t border-gray-900 py-1">
                          <span className="text-purple-300 font-mono">{b.range || `${i + 1}`}</span> <span className="text-white">{b.role}</span> · {b.summary}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg bg-gray-950 border border-gray-800 p-3 space-y-1.5">
                    <p className="text-white font-semibold">2 · Their line → our line</p>
                    <div className="max-h-96 overflow-y-auto">
                      {run.plan.beats.map((b, i) => (
                        <div key={i} className="border-t border-gray-900 py-1.5">
                          <p className="text-purple-300 font-semibold">{b.role}</p>
                          <p className="text-gray-500">{b.theirs}</p>
                          <p className="text-white mt-0.5">{b.ours}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg bg-gray-950 border border-gray-800 p-3 space-y-2">
                    <p className="text-white font-semibold">3 · Kept, replaced, added</p>
                    <div>
                      <p className="text-gray-500">Kept from the reference</p>
                      <ul className="list-disc pl-4 text-gray-400">{run.plan.kept.map((k, i) => <li key={i}>{k}</li>)}</ul>
                    </div>
                    <div>
                      <p className="text-gray-500">Theirs, replaced</p>
                      <ul className="list-disc pl-4 text-gray-400">{run.study.theirs_to_replace.map((k, i) => <li key={i}>{k}</li>)}</ul>
                    </div>
                    <div>
                      <p className="text-gray-500">Filled from the Winning DNA</p>
                      <ul className="list-disc pl-4 text-gray-400">{run.plan.added_from_dna.length ? run.plan.added_from_dna.map((k, i) => <li key={i}>{k}</li>) : <li>nothing; the reference had every beat</li>}</ul>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                {run.scripts.map((s) => {
                  const score = overall(s);
                  const checking = s.status === "done" && (!s.review || s.review.checking);
                  const rewriting = rewrite?.id === s.id;
                  return (
                    <div key={s.id} className="rounded-xl border border-gray-800 bg-gray-950 p-3 space-y-2 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {score !== null && <span className="rounded-full bg-black border border-gray-700 text-white text-[11px] font-bold px-2 py-0.5 font-mono">{score.toFixed(1)}</span>}
                        {bestId === s.id && <span className="rounded-full bg-green-500 text-green-950 text-[10px] font-extrabold px-2 py-0.5">BEST</span>}
                        {s.review?.ok === false && !s.review.checking && <span className="rounded-full bg-amber-500 text-amber-950 text-[10px] font-extrabold px-2 py-0.5">NEEDS A FIX</span>}
                        {s.attempts > 1 && s.status === "done" && <Pill tone="muted">rewritten once by the reviewer</Pill>}
                        {s.kept && (
                          <span className="text-green-400 text-[11px] inline-flex items-center gap-1">
                            <Check size={11} /> on the board
                          </span>
                        )}
                      </div>
                      {s.status === "writing" ? (
                        <div className="py-10 text-center text-xs text-purple-300 inline-flex w-full items-center justify-center gap-2">
                          <Loader2 size={14} className="animate-spin" /> Writing version {s.idx + 1}…
                        </div>
                      ) : s.status === "failed" ? (
                        <p className="text-xs text-red-300 py-6">{s.error ?? "Failed"}</p>
                      ) : (
                        <>
                          <div>
                            <p className="text-sm text-white font-semibold">{s.title || `Version ${s.idx + 1}`}</p>
                            <p className="text-[11px] text-gray-500">
                              {s.seconds ? `${s.seconds} s` : ""}
                              {s.beats.length ? ` · ${s.beats.length} beats` : ""}
                            </p>
                          </div>
                          <p className="text-xs text-white font-semibold bg-gray-900 border-l-2 border-purple-500 rounded px-2 py-1.5">{s.hook}</p>
                          <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
                            {s.beats.map((b, i) => (
                              <div key={i} className="grid grid-cols-[52px_minmax(0,1fr)] gap-2 text-xs">
                                <span className="font-mono text-[10px] text-purple-300 pt-0.5">{b.t || `${i + 1}`}</span>
                                <div className="min-w-0">
                                  <p className="text-gray-200 whitespace-pre-wrap">{b.line}</p>
                                  {b.on_screen && <p className="text-[10px] text-amber-300">ON SCREEN: {b.on_screen}</p>}
                                  {b.visual && <p className="text-[10px] text-gray-500">{b.visual}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                          {s.review && (
                            <p className={`text-[11px] inline-flex items-start gap-1 ${checking ? "text-gray-500" : s.review.ok ? "text-green-400" : "text-amber-300"}`}>
                              {checking ? <Loader2 size={10} className="animate-spin mt-0.5" /> : s.review.ok ? <Check size={10} className="mt-0.5" /> : <AlertTriangle size={10} className="mt-0.5" />}
                              <span title={s.review.notes}>
                                {checking ? "Reviewing…" : s.review.notes}
                                {!checking ? ` (hook ${s.review.scores.hook}, structure ${s.review.scores.structure}, language ${s.review.scores.language}, compliance ${s.review.scores.compliance}, brand ${s.review.scores.brand})` : ""}
                              </span>
                            </p>
                          )}
                          {!s.review && <p className="text-[11px] text-gray-500 inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Waiting for the reviewer</p>}
                          <div className="flex items-center gap-3 flex-wrap text-[11px]">
                            <button type="button" onClick={() => void copy(s)} className="text-gray-300 hover:text-white inline-flex items-center gap-1 cursor-pointer">
                              {copied === s.id ? <Check size={11} /> : <Copy size={11} />} {copied === s.id ? "Copied" : "Copy"}
                            </button>
                            {run.item_id && (
                              <button type="button" onClick={() => void act(s.id, { action: "keep" }, `keep:${s.id}`)} disabled={s.kept || busy !== null} className={`inline-flex items-center gap-1 cursor-pointer ${s.kept ? "text-green-400" : "text-purple-300 hover:text-white"}`}>
                                <Check size={11} /> {s.kept ? "Kept" : "Keep on the board"}
                              </button>
                            )}
                            {!rewriting && (
                              <button type="button" onClick={() => setRewrite({ id: s.id, note: "" })} disabled={busy !== null} className="text-purple-300 hover:text-white cursor-pointer">
                                Rewrite with a note
                              </button>
                            )}
                          </div>
                          {rewriting && (
                            <div className="flex items-center gap-2 flex-wrap">
                              <input autoFocus value={rewrite.note} onChange={(e) => setRewrite({ id: s.id, note: e.target.value })} placeholder="What should change? e.g. shorter hook, more Tagalog, mention the bundle" className={`${field} flex-1 min-w-48 !py-1.5 !text-xs`} onKeyDown={(e) => e.key === "Enter" && rewrite.note.trim() && void act(s.id, { action: "rewrite", note: rewrite.note }, `rewrite:${s.id}`)} />
                              <Button primary onClick={() => void act(s.id, { action: "rewrite", note: rewrite.note }, `rewrite:${s.id}`)} busy={busy === `rewrite:${s.id}`} disabled={!rewrite.note.trim() || busy !== null} className="!px-2.5 !py-1 !text-xs">
                                Rewrite
                              </Button>
                              <Button ghost onClick={() => setRewrite(null)} className="!px-2.5 !py-1 !text-xs">
                                Cancel
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>
          );
        })
      )}
    </div>
  );
}
