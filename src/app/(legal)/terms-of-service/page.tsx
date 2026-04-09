import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Astrobiz Dashboard",
  description: "Terms of service for the Astrobiz Dashboard application.",
};

export default function TermsOfServicePage() {
  return (
    <article className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-white">Terms of Service</h1>
        <p className="mt-2 text-sm text-gray-500">
          Last updated: April 9, 2026
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          Acceptance of Terms
        </h2>
        <p>
          By accessing and using the Astrobiz Dashboard (&ldquo;the
          Service&rdquo;), you agree to be bound by these Terms of Service. If
          you do not agree to these terms, you may not use the Service.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          Description of Service
        </h2>
        <p>
          The Astrobiz Dashboard is an internal employee application operated by
          Astrobiz for the purpose of:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            Managing Facebook advertising campaigns across multiple ad accounts
          </li>
          <li>Creating and submitting ad creatives via the Facebook Marketing API</li>
          <li>Tracking employee work hours and attendance</li>
          <li>Viewing internal business performance data</li>
        </ul>
        <p>
          This Service is an internal business tool and is not intended for
          public or consumer use.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">User Eligibility</h2>
        <p>
          Access to the Service is restricted to authorized employees of
          Astrobiz. You must have a valid employee account and be granted
          appropriate role permissions by an administrator to use the Service.
          Unauthorized access is prohibited.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          Account Responsibilities
        </h2>
        <p>As an authorized user, you are responsible for:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Maintaining the security of your login credentials</li>
          <li>
            All activities that occur under your account
          </li>
          <li>
            Notifying an administrator immediately of any unauthorized use of
            your account
          </li>
          <li>
            Ensuring that your use of the Service complies with all applicable
            laws and regulations
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Acceptable Use</h2>
        <p>When using the Service, you agree not to:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            Use the Service for any purpose other than authorized business
            operations
          </li>
          <li>
            Share your account credentials or grant access to unauthorized
            individuals
          </li>
          <li>
            Attempt to access data or features beyond your assigned role
            permissions
          </li>
          <li>
            Misuse the Facebook Marketing API integration in violation of
            Meta&apos;s terms of service
          </li>
          <li>
            Interfere with or disrupt the Service or its infrastructure
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          Intellectual Property
        </h2>
        <p>
          The Service, including its design, code, and functionality, is the
          property of Astrobiz. All advertising content created through the
          Service belongs to Astrobiz. You may not copy, modify, or distribute
          any part of the Service without prior authorization.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          Disclaimer of Warranties
        </h2>
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo; without warranties of any kind, either express or
          implied. Astrobiz does not guarantee that the Service will be
          uninterrupted, error-free, or free of harmful components. We are not
          responsible for any actions taken by Meta/Facebook regarding your ad
          accounts or campaigns.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          Limitation of Liability
        </h2>
        <p>
          To the maximum extent permitted by law, Astrobiz shall not be liable
          for any indirect, incidental, special, consequential, or punitive
          damages arising from your use of the Service, including but not
          limited to lost profits, data loss, or business interruption.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Termination</h2>
        <p>
          Astrobiz reserves the right to suspend or terminate your access to the
          Service at any time, with or without cause, including but not limited
          to violation of these Terms. Upon termination, your right to use the
          Service will immediately cease.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Governing Law</h2>
        <p>
          These Terms shall be governed by and construed in accordance with the
          laws of the Republic of the Philippines, without regard to its
          conflict of law provisions. Any disputes arising from these Terms
          shall be resolved in the courts of the Philippines.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          Changes to These Terms
        </h2>
        <p>
          We may update these Terms of Service from time to time. Changes will
          be reflected on this page with an updated &ldquo;Last updated&rdquo;
          date. Continued use of the Service after changes constitutes
          acceptance of the updated terms.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Contact Us</h2>
        <p>
          If you have questions about these Terms of Service, please contact us:
        </p>
        <p>
          <strong className="text-white">Astrobiz</strong>
          <br />
          Email:{" "}
          <a
            href="mailto:japcidro@gmail.com"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            japcidro@gmail.com
          </a>
        </p>
      </section>
    </article>
  );
}
