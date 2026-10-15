import { LayoutDashboard } from "lucide-react";

export default function OwnerHomePage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-white">Development Dashboard</h1>
      <p className="text-sm text-gray-500 mt-1">
        Where new tools are built and tried before they move to Operations. The owner and the marketing team see this space.
      </p>

      <div className="mt-8 rounded-xl border border-dashed border-gray-800 p-10 text-center">
        <LayoutDashboard size={28} className="mx-auto text-gray-600" />
        <p className="text-sm text-gray-400 mt-3">
          The Clipper lives under Marketing Tools in the sidebar; the Marketing Board has its own tab.
        </p>
        <p className="text-xs text-gray-600 mt-1">
          UGC Generator and Hook Studio sit under Mobile App, which only the owner sees.
        </p>
      </div>
    </div>
  );
}
