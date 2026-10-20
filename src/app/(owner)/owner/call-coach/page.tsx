import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/call-coach/server";
import { CallCoachOwner } from "@/components/call-coach/call-coach-owner";

export const dynamic = "force-dynamic";

// Owner and admins only: the (owner) layout lets the marketing team in, but
// VA recordings are not theirs to hear.
export default async function CallCoachPage() {
  const auth = await requireCoach();
  if (auth.error) notFound();
  return <CallCoachOwner />;
}
