import { LayoutDashboard } from "lucide-react";

export default function OwnerHomePage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-white">Owner Dashboard</h1>
      <p className="text-sm text-gray-500 mt-1">
        Only you can see this space.
      </p>

      <div className="mt-8 rounded-xl border border-dashed border-gray-800 p-10 text-center">
        <LayoutDashboard size={28} className="mx-auto text-gray-600" />
        <p className="text-sm text-gray-400 mt-3">Nothing here yet.</p>
        <p className="text-xs text-gray-600 mt-1">
          New pages added to this space show up in the sidebar.
        </p>
      </div>
    </div>
  );
}
