import { createServiceClient } from "@/lib/supabase/service";
import { runBriefing } from "@/lib/briefings/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createServiceClient();
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const result = await runBriefing(supabase, baseUrl, process.env.CRON_SECRET!, "morning");
  return Response.json(result);
}
