"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import {
  Newspaper, Star, StickyNote, TrendingUp,
  ArrowRight, Bot, Calendar
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, StatCard } from "@/components/ui/Card";
import { TypeBadge, CategoryChip, QualityDots } from "@/components/ui/Badge";
import type { Item, Review } from "@/types/database";

interface Stats {
  total: number;
  news: number;
  repos: number;
  notes: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ total: 0, news: 0, repos: 0, notes: 0 });
  const [recent, setRecent] = useState<Item[]>([]);
  const [pinned, setPinned] = useState<Item[]>([]);
  const [lastReview, setLastReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);

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
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-[#e8e8f0]">總覽</h1>
        <p className="text-sm text-[#9898b0] mt-1">
          {new Date().toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="全部內容" value={stats.total} icon={<TrendingUp size={18} />} color="#6366f1" />
        <StatCard label="AI 新聞" value={stats.news} icon={<Newspaper size={18} />} color="#0ea5e9" />
        <StatCard label="GitHub Repos" value={stats.repos} icon={<Star size={18} />} color="#10b981" />
        <StatCard label="個人筆記" value={stats.notes} icon={<StickyNote size={18} />} color="#8b5cf6" />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Recent items */}
        <div className="col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#e8e8f0]">最新內容</h2>
            <Link href="/items" className="text-xs text-[#6366f1] hover:text-[#818cf8] flex items-center gap-1">
              查看全部 <ArrowRight size={12} />
            </Link>
          </div>

          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton h-16 w-full" />
              ))
            : recent.map((item) => (
                <Link key={item.id} href={`/items/${item.id}`}>
                  <Card hover className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <TypeBadge type={item.type} />
                          {item.category && (
                            <CategoryChip
                              name={item.category.name}
                              color={item.category.color}
                              icon={item.category.icon}
                            />
                          )}
                        </div>
                        <p className="text-sm font-medium text-[#e8e8f0] truncate">{item.title}</p>
                        {item.summary && (
                          <p className="text-xs text-[#9898b0] mt-0.5 line-clamp-1">{item.summary}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <QualityDots score={item.quality} />
                        <span className="text-[10px] text-[#9898b0]">
                          {formatDistanceToNow(new Date(item.created_at), { locale: zhTW, addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Pinned */}
          {pinned.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-[#e8e8f0] mb-3">📌 釘選</h2>
              <div className="space-y-2">
                {pinned.map((item) => (
                  <Link key={item.id} href={`/items/${item.id}`}>
                    <Card hover className="p-3">
                      <div className="flex items-center gap-2">
                        <TypeBadge type={item.type} />
                        <p className="text-xs text-[#e8e8f0] truncate flex-1">{item.title}</p>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Last Review */}
          <div>
            <h2 className="text-sm font-semibold text-[#e8e8f0] mb-3">🤖 上次審查</h2>
            {lastReview ? (
              <Card className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs text-[#9898b0]">
                  <Bot size={13} />
                  <span>{lastReview.model}</span>
                  <span>·</span>
                  <Calendar size={13} />
                  <span>{formatDistanceToNow(new Date(lastReview.created_at), { locale: zhTW, addSuffix: true })}</span>
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
                  <p className="text-xs text-[#9898b0] line-clamp-3 border-t border-white/6 pt-2">
                    {lastReview.notes}
                  </p>
                )}
                <Link href="/reviews" className="text-xs text-[#6366f1] hover:text-[#818cf8] flex items-center gap-1">
                  查看審查紀錄 <ArrowRight size={11} />
                </Link>
              </Card>
            ) : (
              <Card className="p-4">
                <p className="text-xs text-[#9898b0]">尚無審查紀錄</p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
