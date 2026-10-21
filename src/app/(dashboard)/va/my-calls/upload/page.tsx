import { redirect } from "next/navigation";
import { Headphones } from "lucide-react";
import { getEmployee } from "@/lib/supabase/get-employee";
import { createServiceClient } from "@/lib/supabase/service";
import { activeConsent, isRecordedRole } from "@/lib/call-coach/server";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/button";
import { ConsentForm } from "@/components/call-coach/consent-form";
import { PhoneUpload } from "@/components/call-coach/phone-upload";

export const dynamic = "force-dynamic";

/**
 * Upload from phone: for a VA who calls from her phone because the desk has
 * no signal. Same consent as the PC recorder, same VA, same pipeline.
 */
export default async function PhoneUploadPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (!isRecordedRole(employee.role)) redirect("/dashboard");

  const consent = await activeConsent(createServiceClient(), employee.id);

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Upload calls from your phone"
        subtitle="Calls you made from your phone, recorded by your phone. They are scored like the ones from the PC."
        actions={
          <LinkButton href="/va/my-calls" variant="ghost" size="sm">
            <Headphones size={14} /> My Calls
          </LinkButton>
        }
      />
      {consent ? (
        <PhoneUpload />
      ) : (
        <ConsentForm
          fullName={employee.full_name}
          askMic={false}
          intro="Before your first upload, read and sign the recording consent once. It covers the calls you record on your phone too."
          buttonLabel="I agree, let me upload my calls"
        />
      )}
    </div>
  );
}
