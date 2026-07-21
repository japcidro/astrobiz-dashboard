"use client";

import { useState } from "react";
import { Newspaper, PenSquare, CalendarClock } from "lucide-react";
import { PageSelector } from "@/components/marketing/create/page-selector";
import { PagePostForm } from "./page-post-form";
import { ScheduledPostsList } from "./scheduled-posts-list";

type Tab = "compose" | "scheduled";

export function PagePostings() {
  const [pageId, setPageId] = useState("");
  const [pageName, setPageName] = useState("");
  const [tab, setTab] = useState<Tab>("compose");

  const tabClass = (active: boolean) =>
    `flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
      active
        ? "bg-white text-black"
        : "border border-gray-700 text-gray-300 hover:border-gray-600"
    }`;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Newspaper size={24} className="text-white" />
        <h1 className="text-2xl font-semibold text-white">Page Postings</h1>
      </div>
      <p className="text-sm text-gray-400 mb-6">
        Mag-publish, mag-schedule, at mag-manage ng organic posts (text,
        larawan, o video) sa iyong Facebook Page.
      </p>

      <div className="mb-5">
        <PageSelector
          selectedPageId={pageId}
          onChange={(id, name) => {
            setPageId(id);
            setPageName(name);
          }}
        />
      </div>

      <div className="mb-5 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("compose")}
          className={tabClass(tab === "compose")}
        >
          <PenSquare size={16} />
          Bagong Post
        </button>
        <button
          type="button"
          onClick={() => setTab("scheduled")}
          className={tabClass(tab === "scheduled")}
        >
          <CalendarClock size={16} />
          Naka-schedule
        </button>
      </div>

      {tab === "compose" ? (
        <PagePostForm
          pageId={pageId}
          pageName={pageName}
          onScheduled={() => setTab("scheduled")}
        />
      ) : (
        <ScheduledPostsList pageId={pageId} pageName={pageName} />
      )}
    </div>
  );
}
