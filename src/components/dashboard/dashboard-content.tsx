"use client";

import type { UserRole } from "@/lib/types";
import { AdminDashboard } from "./admin-dashboard";
import { VADashboard } from "./va-dashboard";
import { MarketingDashboard } from "./marketing-dashboard";
import { FulfillmentDashboard } from "./fulfillment-dashboard";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";

interface Props {
  role: UserRole;
  employeeName: string;
  hoursToday: string;
  hasActiveSession: boolean;
  teamTotalHours: number;
  teamNotClockedIn: number;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-PH", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

export function DashboardContent({
  role,
  employeeName,
  hoursToday,
  hasActiveSession,
  teamTotalHours,
  teamNotClockedIn,
}: Props) {
  const firstName = employeeName.split(" ")[0];

  return (
    <div>
      <PageHeader
        title={`${getGreeting()}, ${firstName}`}
        subtitle={
          <>
            {todayLabel()}
            {" · "}
            <span className="font-num text-fg">{hoursToday}</span> on the clock
            {role === "admin" && (
              <>
                {" · "}
                {teamNotClockedIn > 0 ? (
                  <>
                    <span className="font-num text-fg">{teamNotClockedIn}</span> not clocked in
                  </>
                ) : (
                  "everyone clocked in"
                )}
              </>
            )}
          </>
        }
        actions={
          hasActiveSession ? (
            <Pill tone="good">Clocked in</Pill>
          ) : (
            <Pill>Not clocked in</Pill>
          )
        }
      />

      {role === "admin" && (
        <AdminDashboard
          employeeName={employeeName}
          teamTotalHours={teamTotalHours}
          teamNotClockedIn={teamNotClockedIn}
        />
      )}
      {role === "va" && (
        <VADashboard
          employeeName={employeeName}
          hoursToday={hoursToday}
          hasActiveSession={hasActiveSession}
        />
      )}
      {role === "marketing" && (
        <MarketingDashboard
          employeeName={employeeName}
          hoursToday={hoursToday}
          hasActiveSession={hasActiveSession}
        />
      )}
      {role === "fulfillment" && (
        <FulfillmentDashboard
          employeeName={employeeName}
          hoursToday={hoursToday}
          hasActiveSession={hasActiveSession}
        />
      )}
    </div>
  );
}
