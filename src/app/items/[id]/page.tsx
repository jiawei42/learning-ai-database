"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import {
  ArrowLeft, ExternalLink, Edit2, Trash2,
  Pin, PinOff
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { TypeBadge, CategoryChip, QualityDots } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { Item } from "@/types/database";

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<Item | null>(null);
  const [related, setRelated] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("items")
        .select("*, category:categories(*)")
        .eq("id", id)
        .single();

      if (data) {
        setItem(data as Item);
        // load related items
        const { data: relData } = await supabase
          .from("item_relations")
          .select("target_id")
          .eq("source_id", id);

        if (relData && relData.length > 0) {
          const ids = relData.map((r) => r.target_id);
          const { data: relItems } = await supabase
            .from("items")
            .select("*, category:categories(*)")
            .in("id", ids);
          setRelated((relItems as Item[]) ?? []);
        }
      }
      setLoading(false);
    }
    load();
  }, [id]);

  async function togglePin() {
    if (!item) return;
    const next = !item.is_pinned;
    await supabase.from("items").update({ is_pinned: next }).eq("id", id);
    setItem({ ...item, is_pinned: next });
  }

  async function deleteItem() {
    if (!confirm("確定刪除這筆內容？")) return;
    setDeleting(true);
    await supabase.from("items").delete().eq("id", id);
    router.push("/items");
  }

  if (loading) {
    return (
      <div className="space-y-4 max-w-2xl">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="text-center py-20 text-[#9898b0]">
        <p className="text-4xl mb-3">😕</p>
        <p>找不到這筆內容</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-white/8 text-[#9898b0] hover:text-[#e8e8f0] transition-smooth"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" icon={item.is_pinned ? <PinOff size={14} /> : <Pin size={14} />} onClick={togglePin}>
          {item.is_pinned ? "取消釘選" : "釘選"}
        </Button>
        <Link href={`/items/${id}/edit`}>
          <Button variant="secondary" size="sm" icon={<Edit2 size={14} />}>編輯</Button>
        </Link>
        <Button variant="danger" size="sm" icon={<Trash2 size={14} />} loading={deleting} onClick={deleteItem}>
          刪除
        </Button>
      </div>

      {/* Meta */}
      <Card className="p-6 space-y-4">
        <div className="flex items-start gap-2 flex-wrap">
          <TypeBadge type={item.type} />
          {item.category && (
            <CategoryChip name={item.category.name} color={item.category.color} icon={item.category.icon} />
          )}
          {item.is_pinned && <span className="text-sm">📌</span>}
        </div>

        <h1 className="text-xl font-semibold text-[#e8e8f0]">{item.title}</h1>

        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer"
             className="flex items-center gap-1.5 text-xs text-[#6366f1] hover:text-[#818cf8] break-all">
            <ExternalLink size={12} />
            {item.url}
          </a>
        )}

        <div className="flex items-center gap-4 text-xs text-[#9898b0] border-t border-white/6 pt-4">
          {item.source && <span>來源：{item.source}</span>}
          <QualityDots score={item.quality} />
          <span>建立：{format(new Date(item.created_at), "yyyy/MM/dd HH:mm", { locale: zhTW })}</span>
          <span>更新：{format(new Date(item.updated_at), "yyyy/MM/dd HH:mm", { locale: zhTW })}</span>
        </div>
      </Card>

      {/* Summary */}
      {item.summary && (
        <Card className="p-5">
          <p className="text-xs font-semibold text-[#9898b0] uppercase tracking-wider mb-2">摘要</p>
          <p className="text-sm text-[#e8e8f0] leading-relaxed">{item.summary}</p>
        </Card>
      )}

      {/* Content */}
      {item.content && (
        <Card className="p-5">
          <p className="text-xs font-semibold text-[#9898b0] uppercase tracking-wider mb-3">內容</p>
          <div className="text-sm text-[#e8e8f0] leading-relaxed whitespace-pre-wrap">
            {item.content}
          </div>
        </Card>
      )}

      {/* Related */}
      {related.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#9898b0] uppercase tracking-wider mb-3">關聯內容</p>
          <div className="grid grid-cols-2 gap-3">
            {related.map((r) => (
              <Link key={r.id} href={`/items/${r.id}`}>
                <Card hover className="p-3">
                  <TypeBadge type={r.type} />
                  <p className="text-xs text-[#e8e8f0] mt-1.5 line-clamp-2">{r.title}</p>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
