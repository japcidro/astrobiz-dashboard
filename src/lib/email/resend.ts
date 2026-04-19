// Thin wrapper over the Resend REST API. No SDK dependency — keeps bundle light.
// Requires env: RESEND_API_KEY and ALERTS_EMAIL_FROM (e.g. "Astrobiz <alerts@yourdomain.com>").

interface SendEmailArgs {
  to: string[];
  subject: string;
  html: string;
  replyTo?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<{ ok: boolean; error?: string; id?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERTS_EMAIL_FROM;

  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set" };
  if (!from) return { ok: false, error: "ALERTS_EMAIL_FROM not set" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      reply_to: args.replyTo,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `${res.status}: ${body.slice(0, 300)}` };
  }
  const json = (await res.json()) as { id?: string };
  return { ok: true, id: json.id };
}
