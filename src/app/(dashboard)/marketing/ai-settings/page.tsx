"use client";

import { BookOpen } from "lucide-react";
import { KnowledgeManager } from "@/components/ai/knowledge-manager";

export default function AiSettingsPage() {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-emerald-600/20 rounded-lg">
          <BookOpen size={20} className="text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">AI Knowledge</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Manage per-store knowledge documents for the AI generator
          </p>
        </div>
      </div>

      <KnowledgeManager />
    </div>
  );
}
