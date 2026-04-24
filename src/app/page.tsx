"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import {
  Newspaper, Star, StickyNote, TrendingUp,
  ArrowRight, Bot, Calendar,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, StatCard } from "@/components/ui/Card";
import { TypeBadge, CategoryChip, QualityDots } from "@/components/ui/Badge";
import type { Item, Review } from "@/types/database";

interface Stats {
  total: number;
  news:  number;
  repos: number;
  notes: number;
}

export default function DashboardPage() {
  const [stats, setStats]       = useState<Stats>({ total: 0, news: 0, repos: 0, notes: 0 });
  const [recent, setRecent]     = useState<Item[]>([]);
  const [pinned, setPinned]     = useState<Item[]>([]);
  const [lastReview, setLastReview] = useState<Review | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    async function load() {
      const [
        { count: total },
        { count: news },
        { count: repos },
        { count: notes },
        { data: recentData },
        { data: pinnedData },
        { data: reviewData },
      ] = await Promise.all([
        supabase.from("items").select("*", { count: "exact", head: true }),
        supabase.from("items").select("*", { count: "exact", head: true }).eq("type", "news"),
        supabase.from("items").select("*", { count: "exact", head: true }).eq("type", "repo"),
        supabase.from("items").select("*", { count: "exact", head: true }).eq("type", "note"),
        supabase.from("items").select("*, category:categories(*)").order("created_at", { ascending: false }).limit(8),
        supabase.from("items").select("*, category:categories(*)").eq("is_pinned", true).limit(4),
        supabase.from("reviews").select("*, category:categories(*)").order("created_at", { ascending: false }).limit(1),
      ]);

      setStats({ total: total ?? 0, news: news ?? 0, repos: repos ?? 0, notes: notes ?? 0 });
      setRecent((recentData as Item[]) ?? []);
      setPinned((pinnedData as Item[]) ?? []);
      setLastReview((reviewData?.[0] as Review) ?? null);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-7 animate-fade-in">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs text-[#9898b0] text-mono tracking-wider uppercase mb-1">
            {new Date().toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" })}
          </p>
          <h1 className="text-2xl font-bold text-[#eeeef8] tracking-tight">總覽</h1>
        </div>
        <Link
          href="/items/new"
          className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                     bg-[#6366f1] text-white hover:bg-[#4f46e5] transition-smooth
                     shadow-[0_0_18px_rgba(99,102,241,0.35)]"
        >
          快速新增
        </Link>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="全部內容"
          value={stats.total}
          icon={<TrendingUp size={17} />}
          color="#6366f1"
          accentClass="stat-accent-indigo"
        />
        <StatCard
          label="AI 新聞"
          value={stats.news}
          icon={<Newspaper size={17} />}
          color="#0ea5e9"
          accentClass="stat-accent-blue"
        />
        <StatCard
          label="GitHub Repos"
          value={stats.repos}
          icon={<Star size={17} />}
          color="#10b981"
          accentClass="stat-accent-green"
        />
        <StatCard
          label="個人筆記"
          value={stats.notes}
          icon={<StickyNote size={17} />}
          color="#8b5cf6"
          accentClass="stat-accent-purple"
        />
      </div>

      {/* ── Main content grid ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Recent items — takes 2/3 width on desktop */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-[#6366f1] inline-block" />
              <h2 className="text-sm font-semibold text-[#eeeef8]">最新內容</h2>
            </div>
            <Link
              href="/items"
              className="text-xs text-[#6366f1] hover:text-[#818cf8]
                         flex items-center gap-1 transition-smooth"
            >
              查看全部 <ArrowRight size={11} />
            </Link>
          </div>

          <div className="glass rounded-xl overflow-hidden">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="data-row">
                    <div className="skeleton h-4 w-20 mr-3 flex-shrink-0" />
                    <div className="skeleton h-4 flex-1" />
                    <div className="skeleton h-3 w-16 ml-3 flex-shrink-0" />
                  </div>
                ))
              : recent.map((item, idx) => (
                  <Link
                    key={item.id}
                    href={`/items/${item.id}`}
                    className="data-row group"
                    style={{ animationDelay: `${idx * 0.04}s` }}
                  >
                    {/* Type + category */}
                    <div className="flex items-center gap-1.5 flex-shrink-0 mr-3">
                      <TypeBadge type={item.type} />
                      {item.category && (
                        <span className="hidden sm:inline">
                          <CategoryChip
                            name={item.category.name}
                            color={item.category.color}
                            icon={item.category.icon}
                          />
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <p className="text-sm text-[#eeeef8] truncate flex-1
                                  group-hover:text-[#818cf8] transition-smooth">
                      {item.title}
                    </p>

                    {/* Meta */}
                    <div className="flex items-center gap-2.5 ml-3 flex-shrink-0">
                      <QualityDots score={item.quality} />
                      <span className="text-[10px] text-[#9898b0] text-mono hidden sm:inline">
                        {formatDistanceToNow(new Date(item.created_at), { locale: zhTW, addSuffix: true })}
                      </span>
                      <ArrowRight
                        size={11}
                        className="text-[#9898b0]/30 group-hover:text-[#6366f1]
                                   transition-smooth -translate-x-1 group-hover:translate-x-0"
                      />
                    </div>
                  </Link>
                ))}
          </div>
        </div>

        {/* Right sidebar — 1/3 width on desktop */}
        <div className="space-y-4">

          {/* Pinned */}
          {(loading || pinned.length > 0) && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1 h-4 rounded-full bg-[#f59e0b] inline-block" />
                <h2 className="text-sm font-semibold text-[#eeeef8]">釘選</h2>
              </div>
              <div className="glass rounded-xl overflow-hidden">
                {loading
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="data-row">
                        <div className="skeleton h-3.5 flex-1" />
                      </div>
                    ))
                  : pinned.map((item) => (
                      <Link key={item.id} href={`/items/${item.id}`} className="data-row group">
                        <TypeBadge type={item.type} />
                        <p className="text-xs text-[#eeeef8] truncate flex-1 ml-2
                                      group-hover:text-[#818cf8] transition-smooth">
                          {item.title}
                        </p>
                      </Link>
                    ))}
              </div>
            </div>
          )}

          {/* Last review */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1 h-4 rounded-full bg-[#10b981] inline-block" />
              <h2 className="text-sm font-semibold text-[#eeeef8]">上次審查</h2>
            </div>

            {loading ? (
              <div className="skeleton h-32 rounded-xl" />
            ) : lastReview ? (
              <Card className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs text-[#9898b0]">
                  <Bot size={12} />
                  <span className="truncate">{lastReview.model}</span>
                  <Calendar size={11} className="flex-shrink-0" />
                  <span className="text-mono flex-shrink-0">
                    {formatDistanceToNow(new Date(lastReview.created_at), { locale: zhTW, addSuffix: true })}
                  </span>
                </div>
                {lastReview.category && (
                  <CategoryChip
                    name={lastReview.category.name}
                    color={lastReview.category.color}
                    icon={lastReview.category.icon}
                  />
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#9898b0]">審查 {lastReview.items_checked} 筆</span>
                  {lastReview.avg_quality && (
                    <>
                      <span className="text-[#9898b0]">·</span>
                      <QualityDots score={Math.round(lastReview.avg_quality)} />
                    </>
                  )}
                </div>
                {lastReview.notes && (
                  <p className="text-xs text-[#9898b0] line-clamp-3 border-t border-white/6 pt-2.5">
                    {lastReview.notes}
                  </p>
                )}
                <Link
                  href="/reviews"
                  className="text-xs text-[#6366f1] hover:text-[#818cf8]
                             flex items-center gap-1 transition-smooth"
                >
                  查看審查紀錄 <ArrowRight size={10} />
                </Link>
              </Card>
            ) : (
              <Card className="p-4">
                <p className="text-xs text-[#9898b0]/60">尚無審查紀錄</p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
