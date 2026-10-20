"use client";

import type { UserRole } from "@/lib/types";
import { AdminDashboard } from "./admin-dashboard";
import { VADashboard } from "./va-dashboard";
import { MarketingDashboard } from "./marketing-dashboard";
import { FulfillmentDashboard } from "./fulfillment-dashboard";
import { PageHeader } from "@/components/ui/page-header";

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
          role === "admin"
            ? "The business today, at a glance."
            : "Your day, at a glance."
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
