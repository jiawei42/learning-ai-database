"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Search, Plus, ExternalLink, Zap, AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { TypeBadge, CategoryChip, QualityDots } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CategorySelect } from "@/components/ui/Input";
import type { Item, Category, ItemType } from "@/types/database";

const TYPES = [
  { value: "",      label: "全部" },
  { value: "news",  label: "新聞" },
  { value: "repo",  label: "Repo" },
  { value: "note",  label: "筆記" },
];

const TABS = [
  { value: "all",       label: "全部" },
  { value: "duplicate", label: "待審查" },
];

export default function ItemsPage() {
  const [items, setItems]             = useState<Item[]>([]);
  const [categories, setCategories]   = useState<Category[]>([]);
  const [query, setQuery]             = useState("");
  const [typeFilter, setTypeFilter]   = useState("");
  const [catFilter, setCatFilter]     = useState("");
  const [tab, setTab]                 = useState("all");
  const [loading, setLoading]         = useState(true);
  const [dupCount, setDupCount]       = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from("items")
      .select("*, category:categories(*)")
      .order("created_at", { ascending: false })
      .limit(200);

    if (tab === "duplicate") q = q.eq("duplicate_suspect", true);
    if (typeFilter) q = q.eq("type", typeFilter as ItemType);
    if (catFilter) {
      const childIds = categories.filter((c) => c.parent_id === catFilter).map((c) => c.id);
      q = childIds.length > 0
        ? q.in("category_id", [catFilter, ...childIds])
        : q.eq("category_id", catFilter);
    }
    if (query.trim()) {
      const esc = query.trim().replace(/[%_\\]/g, "\\$&");
      q = q.or(`title.ilike.%${esc}%,summary.ilike.%${esc}%,content.ilike.%${esc}%`);
    }

    const { data } = await q;
    setItems((data as Item[]) ?? []);
    setLoading(false);
  }, [query, typeFilter, catFilter, tab, categories]);

  useEffect(() => {
    supabase.from("items")
      .select("id", { count: "exact", head: true })
      .eq("duplicate_suspect", true)
      .then(({ count }) => setDupCount(count ?? 0));
  }, []);

  useEffect(() => {
    supabase.from("categories").select("*").order("name")
      .then(({ data }) => setCategories((data as Category[]) ?? []));
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 280);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#eeeef8] tracking-tight">知識庫</h1>
          <p className="text-xs text-[#9898b0] mt-1 text-mono">
            {loading ? "載入中…" : `${items.length} 筆記錄`}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Link href="/items/smart">
            <Button variant="secondary" size="sm" icon={<Zap size={13} />}>
              <span className="hidden sm:inline">智慧新增</span>
            </Button>
          </Link>
          <Link href="/items/new">
            <Button variant="primary" size="sm" icon={<Plus size={13} />}>
              <span className="hidden sm:inline">新增</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* ── Tabs + Filters ──────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        {/* Tabs */}
        <div className="flex gap-1 p-1 glass rounded-xl w-fit flex-shrink-0">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-smooth ${
                tab === t.value
                  ? "bg-[#6366f1] text-white shadow-[0_0_10px_rgba(99,102,241,0.4)]"
                  : "text-[#9898b0] hover:text-[#eeeef8]"
              }`}
            >
              {t.label}
              {t.value === "duplicate" && dupCount > 0 && (
                <span className="bg-amber-500/20 text-amber-400 rounded-full px-1.5 text-[10px] font-bold">
                  {dupCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9898b0]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋標題、摘要、內容…"
            className="w-full pl-10 pr-4 py-2 rounded-xl text-sm
                       bg-white/5 border border-white/10 text-[#eeeef8]
                       placeholder:text-[#9898b0]/50
                       focus:outline-none focus:border-[#6366f1]/60 transition-smooth"
          />
        </div>

        {/* Type filter */}
        <div className="flex gap-0.5 p-1 glass rounded-xl flex-shrink-0">
          {TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTypeFilter(t.value)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-smooth ${
                typeFilter === t.value
                  ? "bg-[#6366f1] text-white"
                  : "text-[#9898b0] hover:text-[#eeeef8]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Category select */}
        <CategorySelect
          categories={categories}
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          placeholder="所有分類"
          className="text-xs py-2 flex-shrink-0"
        />
      </div>

      {/* ── Items ────────────────────────────────────────────────── */}
      {loading ? (
        <div className="glass rounded-xl overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="data-row gap-3">
              <div className="skeleton h-4 w-14 flex-shrink-0" />
              <div className="skeleton h-4 flex-1" />
              <div className="skeleton h-3 w-20 flex-shrink-0 hidden sm:block" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-[#9898b0]">
          <p className="text-4xl mb-3">{tab === "duplicate" ? "✅" : "🔍"}</p>
          <p className="text-sm">
            {tab === "duplicate" ? "沒有待審查的重複嫌疑文章" : "找不到符合的內容"}
          </p>
        </div>
      ) : (
        <div className="glass rounded-xl overflow-hidden">
          {items.map((item, idx) => {
            const isDup = (item as Item & { duplicate_suspect?: boolean }).duplicate_suspect;
            return (
              <Link
                key={item.id}
                href={`/items/${item.id}`}
                className="data-row group gap-3"
                style={{ animationDelay: `${Math.min(idx * 0.025, 0.3)}s` }}
              >
                {/* Type badge */}
                <div className="flex-shrink-0">
                  <TypeBadge type={item.type} />
                </div>

                {/* Category — hidden on small screens */}
                {item.category && (
                  <div className="flex-shrink-0 hidden md:block">
                    <CategoryChip
                      name={item.category.name}
                      color={item.category.color}
                      icon={item.category.icon}
                    />
                  </div>
                )}

                {/* Title + summary */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#eeeef8] truncate
                                group-hover:text-[#818cf8] transition-smooth">
                    {item.title}
                  </p>
                  {item.summary && (
                    <p className="text-[11px] text-[#9898b0] truncate mt-0.5 hidden sm:block">
                      {item.summary}
                    </p>
                  )}
                </div>

                {/* Status / warning badges */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isDup && (
                    <span className="flex items-center gap-1 text-[10px] font-medium
                                     bg-amber-500/12 text-amber-400 border border-amber-500/22
                                     px-2 py-0.5 rounded-full">
                      <AlertTriangle size={9} />
                      <span className="hidden sm:inline">重複</span>
                    </span>
                  )}
                  {item.is_pinned && !isDup && (
                    <span className="text-[11px]">📌</span>
                  )}
                </div>

                {/* Quality + date + external link */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <QualityDots score={item.quality} />
                  {item.url && (
                    <ExternalLink size={11} className="text-[#9898b0]/50 hidden sm:block" />
                  )}
                  <span className="text-[10px] text-[#9898b0] text-mono hidden sm:block">
                    {formatDistanceToNow(new Date(item.created_at), { locale: zhTW, addSuffix: true })}
                  </span>
                  <ArrowRight
                    size={11}
                    className="text-[#9898b0]/25 group-hover:text-[#6366f1] transition-smooth
                               -translate-x-1 group-hover:translate-x-0"
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
