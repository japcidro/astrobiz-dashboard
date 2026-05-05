import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const MAX_PREVIEW_CHARS = 200;

export async function POST(req: Request) {
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

  let body: { voice_id?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const voiceId = body.voice_id?.trim();
  const text = body.text?.trim();
  if (!voiceId) return Response.json({ error: "voice_id required" }, { status: 400 });
  if (!text) return Response.json({ error: "text required" }, { status: 400 });
  if (text.length > MAX_PREVIEW_CHARS) {
    return Response.json(
      { error: `Preview text too long (max ${MAX_PREVIEW_CHARS} chars)` },
      { status: 400 }
    );
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    voiceId
  )}?output_format=mp3_44100_128`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const errText = await res.text();
    return Response.json(
      { error: `ElevenLabs ${res.status}: ${errText.slice(0, 200)}` },
      { status: 502 }
    );
  }

  const audioBuffer = await res.arrayBuffer();
  return new Response(audioBuffer, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
