interface TemplateArgs {
  employeeName: string;
  appUrl: string;
  startTime?: string;
  endTime?: string;
  hoursSoFar?: number;
  sessionStart?: string;
  autoCloseHours?: number;
}

function shell(title: string, body: string, appUrl: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border-radius:12px;padding:24px;">
        <tr><td style="padding:0 0 14px 0;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:13px;font-weight:600;color:#111827;">Astrobiz</div>
        </td></tr>
        <tr><td style="padding:18px 0;">
          ${body}
        </td></tr>
        <tr><td style="padding:6px 0 0 0;text-align:center;">
          <a href="${appUrl}/time-tracker" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:500;">Open Time Tracker →</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function buildClockinReminder({ employeeName, appUrl, startTime }: TemplateArgs) {
  const subject = `Attendance reminder — haven't clocked in yet`;
  const html = shell(
    subject,
    `<p style="margin:0 0 12px 0;font-size:15px;color:#111827;">Hi ${employeeName},</p>
     <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#374151;">
       Your shift started at <strong>${startTime ?? "the scheduled time"}</strong> but you haven't clocked in yet on the Time Tracker.
     </p>
     <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
       Please clock in now so your hours are recorded accurately.
     </p>`,
    appUrl
  );
  return { subject, html };
}

export function buildBreakReminder({ employeeName, appUrl, hoursSoFar }: TemplateArgs) {
  const subject = `Time for a break?`;
  const html = shell(
    subject,
    `<p style="margin:0 0 12px 0;font-size:15px;color:#111827;">Hi ${employeeName},</p>
     <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#374151;">
       You've been clocked in for <strong>${hoursSoFar?.toFixed(1) ?? "over 4"} hours</strong> without a break.
     </p>
     <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
       Pause the timer and rest before continuing. Philippine labor standard requires a meal break after 5 hours.
     </p>`,
    appUrl
  );
  return { subject, html };
}

export function buildClockoutReminder({ employeeName, appUrl, endTime }: TemplateArgs) {
  const subject = `Still working? Time to clock out`;
  const html = shell(
    subject,
    `<p style="margin:0 0 12px 0;font-size:15px;color:#111827;">Hi ${employeeName},</p>
     <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#374151;">
       Your shift was scheduled to end at <strong>${endTime ?? "earlier"}</strong>. Your session is still running.
     </p>
     <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
       If you're done, please stop the timer. If you're still working overtime, just ignore this reminder.
     </p>`,
    appUrl
  );
  return { subject, html };
}

export function buildAutoCloseNotification({
  employeeName,
  appUrl,
  hoursSoFar,
  autoCloseHours,
}: TemplateArgs) {
  const subject = `Your session was auto-closed after ${autoCloseHours}h`;
  const html = shell(
    subject,
    `<p style="margin:0 0 12px 0;font-size:15px;color:#111827;">Hi ${employeeName},</p>
     <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#374151;">
       Your Time Tracker session was running for <strong>${hoursSoFar?.toFixed(1) ?? autoCloseHours} hours</strong> and was automatically closed to prevent inflated time.
     </p>
     <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
       If the actual end time was different, please add a correction entry or let your admin know.
     </p>`,
    appUrl
  );
  return { subject, html };
}

export function buildAdminAutoCloseAlert({
  employeeName,
  appUrl,
  hoursSoFar,
}: TemplateArgs) {
  const subject = `${employeeName}'s session was auto-closed`;
  const html = shell(
    subject,
    `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#374151;">
       <strong>${employeeName}</strong>'s Time Tracker session was running for <strong>${hoursSoFar?.toFixed(1) ?? "10+"} hours</strong> and was auto-closed.
     </p>
     <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
       They probably forgot to clock out. Review attendance to confirm the hours are accurate.
     </p>`,
    appUrl
  );
  return { subject, html };
}
