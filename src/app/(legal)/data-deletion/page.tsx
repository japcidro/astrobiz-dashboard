import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data Deletion — Astrobiz Dashboard",
  description:
    "Instructions for requesting data deletion from the Astrobiz Dashboard.",
};

export default function DataDeletionPage() {
  return (
    <article className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-white">
          Data Deletion Instructions
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Last updated: April 9, 2026
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Overview</h2>
        <p>
          The Astrobiz Dashboard stores limited data in connection with your use
          of the application. This page explains what data we store and how you
          can request its deletion.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">What Data We Store</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong className="text-white">Account Data:</strong> Your email
            address and display name from Google OAuth sign-in
          </li>
          <li>
            <strong className="text-white">Employee Profile:</strong> Your role
            and active status within the organization
          </li>
          <li>
            <strong className="text-white">Time Tracking Records:</strong> Work
            session entries including timestamps and notes
          </li>
          <li>
            <strong className="text-white">Ad Drafts:</strong> Saved advertising
            drafts created through the application
          </li>
          <li>
            <strong className="text-white">Application Settings:</strong> Your
            selected ad account preferences
          </li>
        </ul>
        <p>
          <strong className="text-white">Note:</strong> We do not permanently
          store Facebook advertising performance data. Ad metrics are fetched
          on-demand from the Facebook Marketing API and are not retained in our
          database.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          How to Request Data Deletion
        </h2>
        <p>
          To request deletion of your data, please send an email to our team
          with the following information:
        </p>
        <ol className="list-decimal pl-6 space-y-2">
          <li>
            Send an email to{" "}
            <a
              href="mailto:privacy@astrobiz.ph"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              privacy@astrobiz.ph
            </a>
          </li>
          <li>
            Use the subject line:{" "}
            <strong className="text-white">
              &ldquo;Data Deletion Request&rdquo;
            </strong>
          </li>
          <li>
            Include the email address associated with your account
          </li>
          <li>
            Specify whether you want a{" "}
            <strong className="text-white">full deletion</strong> (all data) or{" "}
            <strong className="text-white">partial deletion</strong> (specify
            which data to remove)
          </li>
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          What Gets Deleted
        </h2>
        <p>Upon a full deletion request, we will remove:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Your employee account and profile information</li>
          <li>All time tracking records associated with your account</li>
          <li>All ad drafts created by your account</li>
          <li>Your authentication session data</li>
          <li>Any application settings tied to your account</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Processing Time</h2>
        <p>
          Data deletion requests will be processed within{" "}
          <strong className="text-white">30 days</strong> of receiving your
          request. In most cases, deletion is completed much sooner.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Confirmation</h2>
        <p>
          Once your data has been deleted, we will send a confirmation email to
          the address you provided in your request. Please note that after
          deletion, your access to the Astrobiz Dashboard will be revoked and
          cannot be restored without creating a new account.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Contact Us</h2>
        <p>
          If you have questions about data deletion or need assistance, please
          contact us:
        </p>
        <p>
          <strong className="text-white">Astrobiz</strong>
          <br />
          Email:{" "}
          <a
            href="mailto:privacy@astrobiz.ph"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            privacy@astrobiz.ph
          </a>
        </p>
      </section>
    </article>
  );
}
