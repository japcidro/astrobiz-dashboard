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
  Layers,
  FileText,
  DollarSign,
  Calculator,
  Sparkles,
  BookOpen,
  ChevronDown,
  ChevronRight,
  BarChart3,
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
  section?: string; // visual section header above this item
}

interface NavGroup {
  label: string;
  icon: React.ReactNode;
  roles: UserRole[];
  children: NavItem[];
}

type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

const navEntries: NavEntry[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: <LayoutDashboard size={20} />,
    roles: ["admin", "va", "fulfillment", "marketing"],
  },
  {
    label: "Time & Attendance",
    icon: <Clock size={20} />,
    roles: ["admin", "va", "fulfillment", "marketing"],
    children: [
      {
        label: "Time Tracker",
        href: "/time-tracker",
        icon: <Clock size={18} />,
        roles: ["admin", "va", "fulfillment", "marketing"],
      },
      {
        label: "Attendance",
        href: "/admin/attendance",
        icon: <Users size={18} />,
        roles: ["admin"],
      },
    ],
  },
  {
    label: "P&L",
    icon: <BarChart3 size={20} />,
    roles: ["admin"],
    children: [
      {
        label: "Net Profit",
        href: "/admin/profit",
        icon: <DollarSign size={18} />,
        roles: ["admin"],
      },
      {
        label: "COGS",
        href: "/admin/cogs",
        icon: <Calculator size={18} />,
        roles: ["admin"],
      },
      {
        label: "J&T Dashboard",
        href: "/admin/jt-dashboard",
        icon: <Truck size={18} />,
        roles: ["admin"],
      },
    ],
  },
  {
    label: "Orders",
    icon: <Truck size={20} />,
    roles: ["admin", "va", "fulfillment"],
    children: [
      {
        label: "Orders & Parcels",
        href: "/va/orders",
        icon: <Truck size={18} />,
        roles: ["admin", "va", "fulfillment"],
      },
    ],
  },
  {
    label: "Fulfillment",
    icon: <Package size={20} />,
    roles: ["admin", "fulfillment"],
    children: [
      {
        label: "Inventory",
        href: "/fulfillment/inventory",
        icon: <Package size={18} />,
        roles: ["admin", "fulfillment"],
      },
      {
        label: "Pick & Pack",
        href: "/fulfillment/pick-pack",
        icon: <Layers size={18} />,
        roles: ["admin", "fulfillment"],
      },
      {
        label: "Stock Management",
        href: "/fulfillment/pick-pack/stock",
        icon: <Package size={18} />,
        roles: ["admin", "fulfillment"],
      },
      {
        label: "Barcodes",
        href: "/fulfillment/pick-pack/barcodes",
        icon: <FileText size={18} />,
        roles: ["admin", "fulfillment"],
      },
      {
        label: "Bin Locations",
        href: "/fulfillment/pick-pack/bins",
        icon: <Package size={18} />,
        roles: ["admin", "fulfillment"],
      },
      {
        label: "Audit Trail",
        href: "/fulfillment/pick-pack/audit",
        icon: <FileText size={18} />,
        roles: ["admin"],
      },
    ],
  },
  {
    label: "Marketing",
    icon: <TrendingUp size={20} />,
    roles: ["admin", "marketing"],
    children: [
      {
        label: "Ad Performance",
        href: "/marketing/ads",
        icon: <TrendingUp size={18} />,
        roles: ["admin", "marketing"],
        section: "Ad Management",
      },
      {
        label: "Create Ad",
        href: "/marketing/create",
        icon: <PlusCircle size={18} />,
        roles: ["admin", "marketing"],
      },
      {
        label: "Bulk Create",
        href: "/marketing/bulk-create",
        icon: <Layers size={18} />,
        roles: ["admin", "marketing"],
      },
      {
        label: "Ad Drafts",
        href: "/marketing/drafts",
        icon: <FileText size={18} />,
        roles: ["admin", "marketing"],
      },
      {
        label: "AI Generator",
        href: "/marketing/ai-generator",
        icon: <Sparkles size={18} />,
        roles: ["admin", "marketing"],
        section: "Creative Generator",
      },
      {
        label: "AI Knowledge",
        href: "/marketing/ai-settings",
        icon: <BookOpen size={18} />,
        roles: ["admin"],
      },
    ],
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const filteredEntries = navEntries.filter((entry) =>
    entry.roles.includes(employeeRole)
  );

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  // Auto-open group if current path matches a child
  const isGroupActive = (group: NavGroup) =>
    group.children.some((c) => pathname === c.href || pathname.startsWith(c.href + "/"));

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
        {filteredEntries.map((entry) => {
          if (isGroup(entry)) {
            const active = isGroupActive(entry);
            const expanded = openGroups[entry.label] ?? active;
            return (
              <div key={entry.label}>
                <button
                  onClick={() => toggleGroup(entry.label)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    active
                      ? "text-white bg-white/5"
                      : "text-gray-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {entry.icon}
                  {entry.label}
                  <span className="ml-auto">
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                </button>
                {expanded && (
                  <div className="ml-4 mt-1 space-y-0.5">
                    {entry.children
                      .filter((child) => child.roles.includes(employeeRole))
                      .map((child) => {
                        const childActive =
                          pathname === child.href || pathname.startsWith(child.href + "/");
                        return (
                          <div key={child.href}>
                            {child.section && (
                              <p className="text-[10px] uppercase tracking-wider text-gray-600 font-medium px-3 pt-3 pb-1">
                                {child.section}
                              </p>
                            )}
                          <Link
                            href={child.href}
                            onClick={() => setMobileOpen(false)}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                              childActive
                                ? "bg-white/10 text-white font-medium"
                                : "text-gray-500 hover:text-white hover:bg-white/5"
                            }`}
                          >
                            {child.icon}
                            {child.label}
                          </Link>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          }

          const item = entry as NavItem;
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
