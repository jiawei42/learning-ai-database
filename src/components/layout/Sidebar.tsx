"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  Library,
  Share2,
  FolderOpen,
  ClipboardCheck,
  Plus,
  Sparkles,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const navItems = [
  { href: "/",            icon: LayoutDashboard, label: "總覽" },
  { href: "/items",       icon: Library,         label: "知識庫" },
  { href: "/graph",       icon: Share2,           label: "關聯圖" },
  { href: "/categories",  icon: FolderOpen,       label: "分類" },
  { href: "/reviews",     icon: ClipboardCheck,   label: "審查紀錄" },
];

export function Sidebar() {
  const path = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-full w-60 flex flex-col z-20
                      bg-[#0f0f18] border-r border-white/6">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-2.5 border-b border-white/6">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#6366f1] to-[#818cf8]
                        flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.4)]">
          <Sparkles size={16} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[#e8e8f0] leading-tight">AI 學習庫</p>
          <p className="text-[10px] text-[#9898b0]">Knowledge Base</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-smooth",
                active
                  ? "bg-[#6366f1]/15 text-[#818cf8] border border-[#6366f1]/25"
                  : "text-[#9898b0] hover:text-[#e8e8f0] hover:bg-white/6"
              )}
            >
              <Icon size={17} className={active ? "text-[#6366f1]" : ""} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Quick add */}
      <div className="px-3 py-3 border-t border-white/6">
        <Link
          href="/items/new"
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium
                     bg-[#6366f1]/12 text-[#818cf8] border border-[#6366f1]/20
                     hover:bg-[#6366f1]/20 transition-smooth"
        >
          <Plus size={16} />
          新增筆記
        </Link>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/6 flex items-center justify-between">
        <p className="text-[10px] text-[#9898b0]/60">v0.1.0</p>
        <ThemeToggle />
      </div>
    </aside>
  );
}
