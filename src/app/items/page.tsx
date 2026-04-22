"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Search, Plus, Filter, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { TypeBadge, CategoryChip, QualityDots } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { Item, Category, ItemType } from "@/types/database";

const TYPES: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: "news", label: "新聞" },
  { value: "repo", label: "Repo" },
  { value: "note", label: "筆記" },
];

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [catFilter, setCatFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("items")
      .select("*, category:categories(*)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (typeFilter) q = q.eq("type", typeFilter);
    if (catFilter)  q = q.eq("category_id", catFilter);
    if (query)      q = q.textSearch("fts", query, { type: "websearch" });

    const { data } = await q;
    setItems((data as Item[]) ?? []);
    setLoading(false);
  }, [query, typeFilter, catFilter]);

  useEffect(() => {
    supabase.from("categories").select("*").order("name").then(({ data }) => {
      setCategories((data as Category[]) ?? []);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 300);
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
        <Link href="/items/new">
          <Button variant="primary" icon={<Plus size={16} />}>新增</Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-56">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9898b0]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋標題、摘要..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm
                       bg-white/5 border border-white/10 text-[#e8e8f0]
                       placeholder:text-[#9898b0]/60
                       focus:outline-none focus:border-[#6366f1]/60 transition-smooth"
          />
        </div>

        {/* Type filter */}
        <div className="flex gap-1.5 p-1 glass rounded-xl">
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

        {/* Category filter */}
        <div className="flex items-center gap-1.5">
          <Filter size={14} className="text-[#9898b0]" />
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
          <p className="text-4xl mb-3">🔍</p>
          <p className="text-sm">找不到符合的內容</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {items.map((item) => (
            <Link key={item.id} href={`/items/${item.id}`}>
              <Card hover className="p-4 h-full">
                <div className="flex flex-col gap-2 h-full">
                  <div className="flex items-start gap-2">
                    <TypeBadge type={item.type} />
                    {item.category && (
                      <CategoryChip
                        name={item.category.name}
                        color={item.category.color}
                        icon={item.category.icon}
                      />
                    )}
                    {item.is_pinned && (
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
                      {item.url && (
                        <ExternalLink size={12} className="text-[#9898b0]" />
                      )}
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
