import Link from "next/link";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-300">
      <header className="border-b border-gray-800">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-white">
            Astrobiz
          </Link>
          <Link
            href="/login"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Sign In
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">{children}</main>

      <footer className="border-t border-gray-800">
        <div className="max-w-3xl mx-auto px-6 py-6 flex flex-wrap gap-6 justify-center text-sm text-gray-500">
          <Link
            href="/privacy-policy"
            className="hover:text-gray-300 transition-colors"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms-of-service"
            className="hover:text-gray-300 transition-colors"
          >
            Terms of Service
          </Link>
          <Link
            href="/data-deletion"
            className="hover:text-gray-300 transition-colors"
          >
            Data Deletion
          </Link>
        </div>
      </footer>
    </div>
  );
}
