"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Clock,
  LayoutDashboard,
  Users,
  Package,
  TrendingUp,
  Truck,
  LogOut,
  Menu,
  X,
  Settings,
  PlusCircle,
  FileText,
} from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  roles: UserRole[];
  comingSoon?: boolean;
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: <LayoutDashboard size={20} />,
    roles: ["admin", "va", "fulfillment", "marketing"],
  },
  {
    label: "Time Tracker",
    href: "/time-tracker",
    icon: <Clock size={20} />,
    roles: ["admin", "va", "fulfillment", "marketing"],
  },
  {
    label: "Attendance",
    href: "/admin/attendance",
    icon: <Users size={20} />,
    roles: ["admin"],
  },
  {
    label: "Orders & Parcels",
    href: "/va/orders",
    icon: <Truck size={20} />,
    roles: ["admin", "va"],
    comingSoon: true,
  },
  {
    label: "Inventory",
    href: "/fulfillment/inventory",
    icon: <Package size={20} />,
    roles: ["admin", "fulfillment"],
    comingSoon: true,
  },
  {
    label: "Ad Performance",
    href: "/marketing/ads",
    icon: <TrendingUp size={20} />,
    roles: ["admin", "marketing"],
  },
  {
    label: "Create Ad",
    href: "/marketing/create",
    icon: <PlusCircle size={20} />,
    roles: ["admin", "marketing"],
  },
  {
    label: "Ad Drafts",
    href: "/marketing/drafts",
    icon: <FileText size={20} />,
    roles: ["admin", "marketing"],
  },
  {
    label: "Settings",
    href: "/admin/settings",
    icon: <Settings size={20} />,
    roles: ["admin"],
  },
];

const roleColors: Record<UserRole, string> = {
  admin: "bg-purple-600",
  va: "bg-blue-600",
  fulfillment: "bg-green-600",
  marketing: "bg-orange-600",
};

interface SidebarProps {
  employeeName: string;
  employeeRole: UserRole;
}

export function Sidebar({ employeeName, employeeRole }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const filteredItems = navItems.filter((item) =>
    item.roles.includes(employeeRole)
  );

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-6 border-b border-gray-800">
        <h1 className="text-xl font-bold text-white">Astrobiz</h1>
        <p className="text-xs text-gray-500 mt-1">Employee Dashboard</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-1">
        {filteredItems.map((item) => {
          if (item.comingSoon) {
            return (
              <div
                key={item.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 cursor-not-allowed"
              >
                {item.icon}
                {item.label}
                <span className="ml-auto text-[10px] bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">
                  Soon
                </span>
              </div>
            );
          }
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-white/10 text-white"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User info */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-white text-sm font-medium">
            {employeeName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">{employeeName}</p>
            <span
              className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium text-white uppercase ${roleColors[employeeRole]}`}
            >
              {employeeRole}
            </span>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-sm w-full px-3 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-gray-900 rounded-lg text-white cursor-pointer"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-gray-950 border-r border-gray-800 transform transition-transform lg:transform-none ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Mobile close */}
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden absolute top-4 right-4 text-gray-400 hover:text-white cursor-pointer"
        >
          <X size={20} />
        </button>
        {sidebarContent}
      </aside>
    </>
  );
}
