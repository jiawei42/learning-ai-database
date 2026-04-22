"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Search, Plus, Filter, ExternalLink, Zap, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { TypeBadge, CategoryChip, QualityDots } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { Item, Category, ItemType } from "@/types/database";

const TYPES: { value: string; label: string }[] = [
  { value: "",        label: "全部" },
  { value: "news",   label: "新聞" },
  { value: "repo",   label: "Repo" },
  { value: "note",   label: "筆記" },
];

const TABS = [
  { value: "all",       label: "全部" },
  { value: "duplicate", label: "待審查 ⚠" },
];

export default function ItemsPage() {
  const [items, setItems]         = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery]         = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [catFilter, setCatFilter]   = useState("");
  const [tab, setTab]             = useState("all");
  const [loading, setLoading]     = useState(true);
  const [dupCount, setDupCount]   = useState(0);

  const load = useCallback(async () => {
    setLoading(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from("items")
      .select("*, category:categories(*)")
      .order("created_at", { ascending: false })
      .limit(200);

    // Tab filter
    if (tab === "duplicate") q = q.eq("duplicate_suspect", true);

    // Type filter
    if (typeFilter) q = q.eq("type", typeFilter as ItemType);

    // Category filter
    if (catFilter) q = q.eq("category_id", catFilter);

    // Search — ilike across title + summary + content (supports Chinese + English)
    if (query.trim()) {
      const esc = query.trim().replace(/[%_\\]/g, "\\$&");
      q = q.or(`title.ilike.%${esc}%,summary.ilike.%${esc}%,content.ilike.%${esc}%`);
    }

    const { data } = await q;
    setItems((data as Item[]) ?? []);
    setLoading(false);
  }, [query, typeFilter, catFilter, tab]);

  // Dup count badge
  useEffect(() => {
    supabase
      .from("items")
      .select("id", { count: "exact", head: true })
      .eq("duplicate_suspect", true)
      .then(({ count }) => setDupCount(count ?? 0));
  }, []);

  useEffect(() => {
    supabase.from("categories").select("*").order("name").then(({ data }) =>
      setCategories((data as Category[]) ?? [])
    );
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 280);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#e8e8f0]">知識庫</h1>
          <p className="text-sm text-[#9898b0] mt-1">{items.length} 筆內容</p>
        </div>
        <div className="flex gap-2">
          <Link href="/items/smart">
            <Button variant="secondary" icon={<Zap size={15} />}>智慧新增</Button>
          </Link>
          <Link href="/items/new">
            <Button variant="primary" icon={<Plus size={15} />}>手動新增</Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-smooth flex items-center gap-1.5 ${
              tab === t.value
                ? "bg-[#6366f1] text-white"
                : "text-[#9898b0] hover:text-[#e8e8f0]"
            }`}
          >
            {t.label}
            {t.value === "duplicate" && dupCount > 0 && (
              <span className="bg-amber-500/20 text-amber-400 rounded-full px-1.5 py-0 text-[10px] font-semibold">
                {dupCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-56">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9898b0]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋標題、摘要、內容..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm
                       bg-white/5 border border-white/10 text-[#e8e8f0]
                       placeholder:text-[#9898b0]/60
                       focus:outline-none focus:border-[#6366f1]/60 transition-smooth"
          />
        </div>

        {/* Type filter */}
        <div className="flex gap-1 p-1 glass rounded-xl">
          {TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTypeFilter(t.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-smooth ${
                typeFilter === t.value
                  ? "bg-[#6366f1] text-white"
                  : "text-[#9898b0] hover:text-[#e8e8f0]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Category */}
        <div className="flex items-center gap-1.5">
          <Filter size={13} className="text-[#9898b0]" />
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="bg-[#1e1e2c] border border-white/10 rounded-xl px-3 py-2 text-xs
                       text-[#e8e8f0] focus:outline-none focus:border-[#6366f1]/60 transition-smooth"
          >
            <option value="">所有分類</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Items grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-32 w-full" />
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
        <div className="grid grid-cols-2 gap-4">
          {items.map((item) => (
            <Link key={item.id} href={`/items/${item.id}`}>
              <Card hover className="p-4 h-full">
                <div className="flex flex-col gap-2 h-full">
                  {/* Top row */}
                  <div className="flex items-start gap-2 flex-wrap">
                    <TypeBadge type={item.type} />
                    {item.category && (
                      <CategoryChip
                        name={item.category.name}
                        color={item.category.color}
                        icon={item.category.icon}
                      />
                    )}
                    {/* Duplicate warning badge */}
                    {(item as Item & { duplicate_suspect?: boolean }).duplicate_suspect && (
                      <span className="flex items-center gap-1 text-[10px] font-medium
                                       bg-amber-500/15 text-amber-400 border border-amber-500/25
                                       px-2 py-0.5 rounded-full ml-auto">
                        <AlertTriangle size={10} />
                        重複嫌疑
                      </span>
                    )}
                    {item.is_pinned && !((item as Item & { duplicate_suspect?: boolean }).duplicate_suspect) && (
                      <span className="ml-auto text-xs">📌</span>
                    )}
                  </div>

                  <p className="text-sm font-medium text-[#e8e8f0] line-clamp-2 flex-1">
                    {item.title}
                  </p>

                  {item.summary && (
                    <p className="text-xs text-[#9898b0] line-clamp-2">{item.summary}</p>
                  )}

                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/5">
                    <div className="flex items-center gap-2">
                      <QualityDots score={item.quality} />
                      {item.source && (
                        <span className="text-[10px] text-[#9898b0]">{item.source}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {item.url && <ExternalLink size={11} className="text-[#9898b0]" />}
                      <span className="text-[10px] text-[#9898b0]">
                        {formatDistanceToNow(new Date(item.created_at), { locale: zhTW, addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
