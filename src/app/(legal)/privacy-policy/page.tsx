import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Astrobiz Dashboard",
  description: "Privacy policy for the Astrobiz Dashboard application.",
};

export default function PrivacyPolicyPage() {
  return (
    <article className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
        <p className="mt-2 text-sm text-gray-500">
          Last updated: April 9, 2026
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Introduction</h2>
        <p>
          Astrobiz (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;)
          operates the Astrobiz Dashboard, an internal employee tool for
          managing advertising campaigns, time tracking, and business
          operations. This Privacy Policy explains how we collect, use, and
          protect information when you use our application.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          Information We Collect
        </h2>
        <p>We collect the following types of information:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong className="text-white">Account Information:</strong> When
            you sign in via Google OAuth, we receive your email address and
            display name.
          </li>
          <li>
            <strong className="text-white">Facebook Advertising Data:</strong>{" "}
            Through the Facebook Marketing API, we access ad account
            information, campaign performance metrics, ad creative data, and
            page information associated with your business ad accounts.
          </li>
          <li>
            <strong className="text-white">Time Tracking Data:</strong> Work
            session records including start/end times and notes entered by
            employees.
          </li>
          <li>
            <strong className="text-white">Usage Data:</strong> Basic
            application usage information necessary for the service to function.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          How We Use Your Information
        </h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            Managing and monitoring Facebook advertising campaigns across
            multiple ad accounts
          </li>
          <li>Creating, editing, and submitting ad creatives to Facebook</li>
          <li>Tracking employee work hours and attendance</li>
          <li>Generating internal business performance reports</li>
          <li>Authenticating and authorizing employee access</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          Facebook Data Usage
        </h2>
        <p>
          We access Facebook data solely through the Facebook Marketing API for
          the purpose of managing advertising campaigns on behalf of our
          business. Specifically:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            We <strong className="text-white">do not sell</strong> any data
            obtained from Facebook to third parties.
          </li>
          <li>
            We <strong className="text-white">do not share</strong> Facebook
            data with third parties except as required for the service to
            function (e.g., hosting infrastructure).
          </li>
          <li>
            Facebook data is used exclusively for internal business advertising
            management.
          </li>
          <li>
            We do not use Facebook data for purposes unrelated to our
            advertising operations.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          Third-Party Services
        </h2>
        <p>Our application uses the following third-party services:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong className="text-white">Supabase</strong> — Authentication
            and database hosting
          </li>
          <li>
            <strong className="text-white">Vercel</strong> — Application
            hosting and deployment
          </li>
          <li>
            <strong className="text-white">Google</strong> — OAuth
            authentication provider
          </li>
          <li>
            <strong className="text-white">Meta (Facebook)</strong> — Marketing
            API for advertising management
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Data Retention</h2>
        <p>
          We retain your data for as long as your employee account is active.
          Facebook advertising data is fetched on-demand and is not permanently
          stored beyond what is necessary for the application to function (such
          as saved account preferences and ad drafts). Upon account
          deactivation, your personal data will be removed within 30 days.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Data Security</h2>
        <p>
          We implement appropriate security measures to protect your
          information, including:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Encrypted data transmission (HTTPS/TLS)</li>
          <li>Row-level security policies on all database tables</li>
          <li>Role-based access control for employees</li>
          <li>Secure authentication via OAuth 2.0</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Your Rights</h2>
        <p>You have the right to:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Access the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your data</li>
          <li>Withdraw consent for data processing</li>
        </ul>
        <p>
          To exercise these rights, please contact us at the email address
          below.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          Children&apos;s Privacy
        </h2>
        <p>
          This application is an internal business tool and is not directed at
          children under the age of 13. We do not knowingly collect personal
          information from children.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          Changes to This Policy
        </h2>
        <p>
          We may update this Privacy Policy from time to time. Changes will be
          reflected on this page with an updated &ldquo;Last updated&rdquo;
          date. Continued use of the application after changes constitutes
          acceptance of the updated policy.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy or wish to exercise
          your data rights, please contact us:
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
