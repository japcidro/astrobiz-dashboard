import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string | null;
  labels?: Record<string, string>;
  description?: string;
}

export async function GET() {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ELEVENLABS_API_KEY missing in env" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return Response.json(
        { error: `ElevenLabs API ${res.status}: ${text}` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as { voices: ElevenLabsVoice[] };

    const voices = (data.voices ?? []).map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
      preview_url: v.preview_url ?? null,
      labels: v.labels ?? {},
      description: v.description,
    }));

    // Sort: cloned/professional first (likely the user's curated voices), then premade
    voices.sort((a, b) => {
      const order: Record<string, number> = {
        cloned: 0,
        professional: 1,
        generated: 2,
        premade: 3,
      };
      const ai = order[a.category ?? "premade"] ?? 4;
      const bi = order[b.category ?? "premade"] ?? 4;
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name);
    });

    return Response.json({ voices });
  } catch (e: unknown) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
