"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutDashboard, Library, Share2, FolderOpen,
  ClipboardCheck, Plus, Sparkles, Menu, X,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const navItems = [
  { href: "/",           icon: LayoutDashboard, label: "總覽" },
  { href: "/items",      icon: Library,         label: "知識庫" },
  { href: "/graph",      icon: Share2,           label: "關聯圖" },
  { href: "/categories", icon: FolderOpen,       label: "分類" },
  { href: "/reviews",    icon: ClipboardCheck,   label: "審查紀錄" },
];

export function Sidebar() {
  const path = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  /* Close sidebar whenever route changes */
  useEffect(() => {
    setMobileOpen(false);
  }, [path]);

  /* Prevent background scroll when mobile menu is open */
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-2.5 border-b border-white/6 safe-top">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#6366f1] to-[#818cf8]
                        flex items-center justify-center flex-shrink-0
                        shadow-[0_0_18px_rgba(99,102,241,0.45)]">
          <Sparkles size={15} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#eeeef8] leading-tight truncate">AI 學習庫</p>
          <p className="text-[10px] text-[#9898b0] tracking-wide">Knowledge Base</p>
        </div>
        {/* Close button — mobile only */}
        <button
          onClick={() => setMobileOpen(false)}
          className="ml-auto lg:hidden p-1.5 rounded-lg text-[#9898b0]
                     hover:text-[#eeeef8] hover:bg-white/8 transition-smooth"
          aria-label="關閉選單"
        >
          <X size={17} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-smooth",
                active
                  ? "bg-[#6366f1]/16 text-[#818cf8] border border-[#6366f1]/28"
                  : "text-[#9898b0] hover:text-[#eeeef8] hover:bg-white/6 border border-transparent"
              )}
            >
              <Icon
                size={16}
                className={clsx("flex-shrink-0", active ? "text-[#6366f1]" : "")}
              />
              <span>{label}</span>
              {active && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#6366f1] flex-shrink-0" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Quick add */}
      <div className="px-3 py-3 border-t border-white/6">
        <Link
          href="/items/new"
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium
                     bg-[#6366f1]/12 text-[#818cf8] border border-[#6366f1]/22
                     hover:bg-[#6366f1]/20 hover:border-[#6366f1]/35 transition-smooth"
        >
          <Plus size={15} />
          新增筆記
        </Link>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/6 flex items-center justify-between safe-bottom">
        <p className="text-[10px] text-[#9898b0]/50 tracking-widest font-mono">v0.1.0</p>
        <ThemeToggle />
      </div>
    </>
  );

  return (
    <>
      {/* ── Mobile top bar ───────────────────────────────────────── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center
                      px-4 h-14 bg-[#0c0c16]/95 border-b border-white/6
                      backdrop-filter backdrop-blur-xl safe-top"
           style={{ backdropFilter: "blur(20px) saturate(180%)",
                    WebkitBackdropFilter: "blur(20px) saturate(180%)" }}>
        {/* Logo mark */}
        <div className="flex items-center gap-2.5 flex-1">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#818cf8]
                          flex items-center justify-center
                          shadow-[0_0_14px_rgba(99,102,241,0.4)]">
            <Sparkles size={13} className="text-white" />
          </div>
          <p className="text-sm font-semibold text-[#eeeef8]">AI 學習庫</p>
        </div>

        {/* Hamburger */}
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="p-2 rounded-xl text-[#9898b0] hover:text-[#eeeef8]
                     hover:bg-white/8 transition-smooth min-w-[44px] min-h-[44px]
                     flex items-center justify-center"
          aria-label={mobileOpen ? "關閉選單" : "開啟選單"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* ── Mobile backdrop overlay ───────────────────────────── */}
      <div
        className={clsx(
          "lg:hidden fixed inset-0 z-40 bg-black/60 transition-opacity duration-300",
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside
        className={clsx(
          "fixed left-0 top-0 h-full w-60 flex flex-col z-50",
          "bg-[#0c0c16] border-r border-white/6",
          /* Desktop: always visible */
          "lg:translate-x-0",
          /* Mobile: slide based on state */
          "transition-transform duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {sidebarContent}
      </aside>

      {/* ── Light mode overrides (applied via html.light) ─────── */}
      <style>{`
        html.light aside { background: #ffffff !important; border-color: rgba(0,0,0,0.08) !important; }
        html.light .lg\\:hidden { background: rgba(255,255,255,0.95) !important; border-color: rgba(0,0,0,0.07) !important; }
      `}</style>
    </>
  );
}
