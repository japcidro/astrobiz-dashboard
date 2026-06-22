import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/resend";
import { getAdminEmails } from "@/lib/email/admin-recipients";

/**
 * Called when an AUTHENTICATED user reaches the dashboard but has no employee
 * record (i.e. their Google email is not on the allowlist). They see only the
 * "Account Not Set Up" screen — no data — but we email the admin so they know
 * an unknown account got as far as signing in.
 *
 * Deduped via unauthorized_access_attempts: emailed exactly once per account.
 * Safe to call on every render — it no-ops after the first time, and never
 * throws (failures are logged, not propagated, so login is never blocked).
 */
export async function alertUnauthorizedAccess(
  authId: string,
  email: string | undefined,
): Promise<void> {
  try {
    const supabase = createServiceClient();

    // Claim this account in the ledger. ignoreDuplicates → if a row already
    // exists, select() returns [] and we skip the email. Only the first hit
    // for a given auth_id gets a non-empty result.
    const { data: inserted, error: insErr } = await supabase
      .from("unauthorized_access_attempts")
      .upsert(
        { auth_id: authId, email: email?.toLowerCase() ?? null },
        { onConflict: "auth_id", ignoreDuplicates: true },
      )
      .select("auth_id");

    if (insErr) {
      console.error("[unauthorized-access] ledger insert failed:", insErr.message);
      return;
    }
    if (!inserted || inserted.length === 0) return; // already alerted before

    const recipients = await getAdminEmails(supabase);
    if (recipients.length === 0) return;

    const when = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });
    const safeEmail = email ?? "(no email on account)";
    const subject = `⚠️ Unknown account signed in: ${safeEmail}`;
    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#111">
        <h2 style="margin:0 0 12px">Unknown account reached the dashboard login</h2>
        <p style="margin:0 0 16px;color:#444">
          Someone signed in with Google but is <strong>not on your team allowlist</strong>,
          so they were blocked at the "Account Not Set Up" screen and saw
          <strong>no data</strong>. No action is required unless you recognize this and
          want to give them access.
        </p>
        <table style="border-collapse:collapse;font-size:14px">
          <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td style="font-weight:600">${safeEmail}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666">Time (PH)</td><td>${when}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666">Account ID</td><td style="font-family:monospace;font-size:12px">${authId}</td></tr>
        </table>
        <p style="margin:16px 0 0;color:#444">
          • If this is a teammate → add them in <strong>Settings → Team</strong>.<br/>
          • If you don't recognize them → no need to do anything; they have no access.
          You can delete the stray account anytime in Supabase → Authentication.
        </p>
        <p style="margin:16px 0 0;color:#999;font-size:12px">
          You're getting this once per unknown account. Sent automatically by your Astrobiz dashboard.
        </p>
      </div>`;

    const result = await sendEmail({ to: recipients, subject, html });
    if (!result.ok) {
      console.error("[unauthorized-access] email failed:", result.error);
      return;
    }

    // Stamp notified_at for the audit trail.
    await supabase
      .from("unauthorized_access_attempts")
      .update({ notified_at: new Date().toISOString() })
      .eq("auth_id", authId);
  } catch (err) {
    console.error("[unauthorized-access] unexpected error:", err);
  }
}
