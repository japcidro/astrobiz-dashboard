"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen } from "lucide-react";
import { KnowledgeManager } from "@/components/ai/knowledge-manager";

export default function AiSettingsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (!data.role || data.role !== "admin") {
          router.replace("/dashboard");
          return;
        }
        setAuthorized(true);
      } catch {
        router.replace("/dashboard");
      }
    })();
  }, [router]);

  if (authorized === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-emerald-600/20 rounded-lg">
          <BookOpen size={20} className="text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">AI Knowledge</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Manage per-store knowledge documents
          </p>
        </div>
      </div>

      <KnowledgeManager />
    </div>
  );
}
