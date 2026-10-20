"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  Microscope,
  DollarSign,
  Calculator,
  ChevronDown,
  ChevronRight,
  BarChart3,
  CheckCircle,
  Bell,
  Newspaper,
  ScanLine,
  ClipboardList,
  Trophy,
  PhoneCall,
  Target,
  AlertTriangle,
  Sparkles,
  Hand,
  FileSpreadsheet,
  Clapperboard,
  ShieldCheck,
  Award,
  Repeat,
  AudioLines,
  CreditCard,
  ImagePlus,
  Smartphone,
  Images,
  Kanban,
  Megaphone,
  Mic,
  Film,
  Headphones,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types";
import { NotificationBell } from "@/components/alerts/notification-bell";
import { EmployeeNotificationBell } from "@/components/attendance/employee-notification-bell";
import { OPS_HOME, OWNER_HOME } from "@/lib/owner";
import { AppearancePicker } from "@/components/theme/appearance-picker";
import type { Theme } from "@/lib/theme";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  roles: UserRole[];
  comingSoon?: boolean;
  section?: string; // visual section header above this item
  /** Only the owner (by email) sees it, whatever the role. */
  ownerOnly?: boolean;
}

interface NavGroup {
  label: string;
  icon: React.ReactNode;
  roles: UserRole[];
  children: NavItem[];
  ownerOnly?: boolean;
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
    label: "Tasks",
    href: "/tasks",
    icon: <ClipboardList size={20} />,
    roles: ["admin", "va", "fulfillment", "marketing"],
  },
  {
    label: "Bonus Tracker",
    href: "/bonus",
    icon: <Award size={20} />,
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
        // Call Coach: the VA's own scores and coaching notes. No audio here.
        label: "My Calls",
        href: "/va/my-calls",
        icon: <Headphones size={18} />,
        roles: ["admin", "va"],
      },
      {
        label: "Attendance",
        href: "/admin/attendance",
        icon: <Users size={18} />,
        roles: ["admin"],
      },
      {
        label: "Schedule",
        href: "/admin/attendance/schedule",
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
      {
        label: "Repeat Buyers",
        href: "/admin/repeat-buyers",
        icon: <Repeat size={18} />,
        roles: ["admin"],
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
        label: "Verify & Fulfill",
        href: "/fulfillment/pick-pack/verify",
        icon: <CheckCircle size={18} />,
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
        label: "Scanner Test",
        href: "/fulfillment/pick-pack/scanner-test",
        icon: <ScanLine size={18} />,
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
      {
        label: "Packing Errors",
        href: "/fulfillment/packing-errors",
        icon: <AlertTriangle size={18} />,
        roles: ["admin", "fulfillment"],
        section: "KPI Inputs",
      },
      {
        label: "Stock Count",
        href: "/fulfillment/stock-count",
        icon: <ClipboardList size={18} />,
        roles: ["admin", "fulfillment"],
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
        label: "Ads Billing",
        href: "/marketing/ads-billing",
        icon: <CreditCard size={18} />,
        roles: ["admin"],
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
        label: "Submitted Videos",
        href: "/marketing/submitted",
        icon: <Clapperboard size={18} />,
        roles: ["admin", "marketing"],
      },
      {
        label: "Fix Rejections",
        href: "/marketing/fix-rejections",
        icon: <ShieldCheck size={18} />,
        roles: ["admin", "marketing"],
      },
      {
        label: "Creatives",
        href: "/marketing/creatives",
        icon: <Trophy size={18} />,
        roles: ["admin", "marketing"],
        section: "Analytics",
      },
      {
        label: "AI Analytics",
        href: "/marketing/ai-analytics",
        icon: <BarChart3 size={18} />,
        roles: ["admin", "marketing"],
      },
      {
        label: "Ad Deconstructor",
        href: "/marketing/deconstructor",
        icon: <Sparkles size={18} />,
        roles: ["admin", "marketing"],
      },
      {
        label: "Transcriber",
        href: "/marketing/transcriber",
        icon: <AudioLines size={18} />,
        roles: ["admin", "marketing"],
      },
      {
        label: "Page Postings",
        href: "/marketing/page-postings",
        icon: <Newspaper size={18} />,
        roles: ["admin"],
      },
      {
        label: "Creative Attribution",
        href: "/marketing/creative-tagging",
        icon: <Target size={18} />,
        roles: ["admin", "marketing"],
        section: "KPI Inputs",
      },
    ],
  },
  {
    label: "KPI Dashboard",
    href: "/admin/kpi-dashboard",
    icon: <Target size={20} />,
    roles: ["admin"],
  },
  {
    label: "Compliance",
    href: "/admin/compliance",
    icon: <FileSpreadsheet size={20} />,
    roles: ["admin"],
  },
  {
    label: "Notifications",
    href: "/admin/notifications",
    icon: <Bell size={20} />,
    roles: ["admin"],
  },
  {
    label: "Briefings",
    href: "/admin/briefings",
    icon: <Newspaper size={20} />,
    roles: ["admin"],
  },
  {
    label: "Call Confirmer",
    href: "/admin/call-confirmer",
    icon: <PhoneCall size={20} />,
    roles: ["admin"],
  },
  {
    label: "Settings",
    href: "/admin/settings",
    icon: <Settings size={20} />,
    roles: ["admin"],
  },
];

// The Development Dashboard's own navigation: add a page under
// src/app/(owner)/owner/ and list it here. The layout already restricts the
// space to the owner and the marketing team, so entries list every role;
// `ownerOnly` hides an entry from the team.
const ownerRoles: UserRole[] = ["admin", "va", "fulfillment", "marketing"];

const ownerNavEntries: NavEntry[] = [
  {
    label: "Home",
    href: OWNER_HOME,
    icon: <LayoutDashboard size={20} />,
    roles: ownerRoles,
  },
  {
    // Tools the marketing team works in day to day.
    label: "Marketing Tools",
    icon: <Megaphone size={20} />,
    roles: ownerRoles,
    children: [
      {
        label: "Clipper",
        href: "/owner/clipper",
        icon: <Film size={18} />,
        roles: ownerRoles,
      },
      {
        label: "Talking Head",
        href: "/owner/talking-head",
        icon: <Mic size={18} />,
        roles: ownerRoles,
      },
      {
        label: "Cartoon Generator",
        href: "/owner/cartoon-generator",
        icon: <Sparkles size={18} />,
        roles: ownerRoles,
      },
      {
        label: "Hook Generator",
        href: "/owner/hook-generator",
        icon: <Hand size={18} />,
        roles: ownerRoles,
      },
      {
        label: "Static Ad Generator",
        href: "/owner/image-studio",
        icon: <Images size={18} />,
        roles: ownerRoles,
      },
      {
        label: "Script Generator",
        href: "/owner/script-generator",
        icon: <FileText size={18} />,
        roles: ownerRoles,
      },
      {
        label: "Science B-roll",
        href: "/owner/science-broll",
        icon: <Microscope size={18} />,
        roles: ownerRoles,
      },
    ],
  },
  {
    // The creative tooling behind the mobile app's ads. Owner only.
    label: "Mobile App",
    icon: <Smartphone size={20} />,
    roles: ownerRoles,
    ownerOnly: true,
    children: [
      {
        label: "UGC Generator",
        href: "/owner/ugc-generator",
        icon: <ImagePlus size={18} />,
        roles: ownerRoles,
      },
      {
        label: "Hook Studio",
        href: "/owner/hook-studio",
        icon: <Clapperboard size={18} />,
        roles: ownerRoles,
      },
    ],
  },
  {
    label: "Marketing Board",
    href: "/owner/marketing-board",
    icon: <Kanban size={20} />,
    roles: ownerRoles,
  },
  {
    // VA shift recordings. Owner only: the team must not hear each other.
    label: "Call Coach",
    href: "/owner/call-coach",
    icon: <Headphones size={20} />,
    roles: ownerRoles,
    ownerOnly: true,
  },
];

export type SidebarSpace = "ops" | "owner";

const roleLabels: Record<UserRole, string> = {
  admin: "Admin",
  va: "VA",
  fulfillment: "Fulfillment",
  marketing: "Marketing",
};

interface SidebarProps {
  employeeName: string;
  employeeRole: UserRole;
  /** The employee's saved theme, for the Appearance picker. */
  theme: Theme;
  /** Shows the Development Dashboard switch. Decided on the server (owner email or team role). */
  devAccess?: boolean;
  /** The owner by email: sees owner-only entries too. */
  isOwner?: boolean;
  space?: SidebarSpace;
}

export function Sidebar({
  employeeName,
  employeeRole,
  theme,
  devAccess = false,
  isOwner = false,
  space = "ops",
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const inOwnerSpace = space === "owner";
  const entries = inOwnerSpace ? ownerNavEntries : navEntries;

  const switchSpace = () => {
    setMobileOpen(false);
    router.push(inOwnerSpace ? OPS_HOME : OWNER_HOME);
  };

  const visible = (entry: NavEntry) => entry.roles.includes(employeeRole) && (!entry.ownerOnly || isOwner);
  const filteredEntries = entries.filter(visible);

  // Auto-open group if current path matches a child
  const isGroupActive = (group: NavGroup) =>
    group.children.some((c) => pathname === c.href || pathname.startsWith(c.href + "/"));

  const findActiveGroupLabel = () =>
    entries.find((e): e is NavGroup => isGroup(e) && isGroupActive(e))?.label ?? null;

  // Accordion: only one group expanded at a time.
  const [openGroup, setOpenGroup] = useState<string | null>(() => findActiveGroupLabel());

  // When navigating to a route inside a group, make sure that group opens
  // (and any other open group collapses).
  useEffect(() => {
    const activeLabel = findActiveGroupLabel();
    if (activeLabel) {
      setOpenGroup(activeLabel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggleGroup = (label: string) => {
    setOpenGroup((prev) => (prev === label ? null : label));
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const itemBase =
    "flex items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors";
  const itemOn = "bg-nav-on text-nav-on-fg font-medium";
  const itemOff = "text-muted hover:bg-raised hover:text-fg";

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="shrink-0 px-5 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <span className="font-display text-base text-fg">Astrobiz</span>
          {devAccess && (
            <button
              type="button"
              role="switch"
              aria-checked={inOwnerSpace}
              aria-label="Development dashboard"
              title={inOwnerSpace ? "Back to Operations" : "Open Development Dashboard"}
              onClick={switchSpace}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-pill border transition-colors ${
                inOwnerSpace
                  ? "border-accent bg-accent"
                  : "border-line-strong bg-raised hover:border-dim"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                  inOwnerSpace ? "translate-x-[18px] bg-accent-ink" : "translate-x-[3px] bg-muted"
                }`}
              />
            </button>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {inOwnerSpace ? "Development" : "Operations"}
        </p>
      </div>

      {/* Nav */}
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 pb-3">
        {filteredEntries.map((entry) => {
          if (isGroup(entry)) {
            const active = isGroupActive(entry);
            const expanded = openGroup === entry.label;
            return (
              <div key={entry.label}>
                <button
                  onClick={() => toggleGroup(entry.label)}
                  aria-expanded={expanded}
                  className={`w-full cursor-pointer ${itemBase} ${
                    active && !expanded ? "text-fg" : "text-muted hover:bg-raised hover:text-fg"
                  }`}
                >
                  <span className={active ? "text-accent" : ""}>{entry.icon}</span>
                  {entry.label}
                  <span className="ml-auto text-dim">
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                </button>
                {expanded && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l border-line pl-2">
                    {entry.children
                      .filter(visible)
                      .map((child) => {
                        // Check if another sibling has a longer matching href (prevents parent matching child)
                        const hasMoreSpecificSibling = entry.children.some(
                          (other) => other.href !== child.href && other.href.startsWith(child.href + "/") && pathname.startsWith(other.href)
                        );
                        const childActive = hasMoreSpecificSibling
                          ? pathname === child.href
                          : pathname === child.href || pathname.startsWith(child.href + "/");
                        return (
                          <div key={child.href}>
                            {child.section && (
                              <p className="text-label px-3 pb-1 pt-3 text-dim">
                                {child.section}
                              </p>
                            )}
                            <Link
                              href={child.href}
                              onClick={() => setMobileOpen(false)}
                              aria-current={childActive ? "page" : undefined}
                              className={`${itemBase} ${childActive ? itemOn : itemOff}`}
                            >
                              <span className={childActive ? "text-accent" : ""}>{child.icon}</span>
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
                className={`${itemBase} cursor-not-allowed text-dim`}
              >
                {item.icon}
                {item.label}
                <span className="ml-auto rounded-pill border border-line px-1.5 py-0.5 font-num text-[10px] text-dim">
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
              aria-current={isActive ? "page" : undefined}
              className={`${itemBase} ${isActive ? itemOn : itemOff}`}
            >
              <span className={isActive ? "text-accent" : ""}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="shrink-0 border-t border-line p-3">
        <div className="mb-1 flex items-center gap-3 px-1 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft font-display text-sm text-accent">
            {employeeName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm text-fg">{employeeName}</p>
            <p className="text-xs text-muted">{roleLabels[employeeRole]}</p>
          </div>
          {employeeRole === "admin" ? (
            <NotificationBell employeeRole={employeeRole} />
          ) : (
            <EmployeeNotificationBell />
          )}
        </div>
        <AppearancePicker current={theme} />
        <button
          onClick={handleLogout}
          className="flex w-full cursor-pointer items-center gap-2 rounded-control px-3 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-fg"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="fixed left-4 top-4 z-50 cursor-pointer rounded-control border border-line bg-panel p-2 text-fg lg:hidden"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 transform border-r border-line bg-sidebar transition-transform lg:static lg:transform-none ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Mobile close */}
        <button
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className="absolute right-4 top-4 cursor-pointer text-muted hover:text-fg lg:hidden"
        >
          <X size={20} />
        </button>
        {sidebarContent}
      </aside>
    </>
  );
}
