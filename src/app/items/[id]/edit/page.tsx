"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select } from "@/components/ui/Input";
import type { Category, Item, ItemType } from "@/types/database";

export default function EditItemPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    type: "note" as ItemType,
    title: "",
    url: "",
    summary: "",
    content: "",
    category_id: "",
    source: "",
    quality: "",
  });

  useEffect(() => {
    Promise.all([
      supabase.from("items").select("*").eq("id", id).single(),
      supabase.from("categories").select("*").order("name"),
    ]).then(([{ data: item }, { data: cats }]) => {
      if (item) {
        const i = item as Item;
        setForm({
          type: i.type,
          title: i.title,
          url: i.url ?? "",
          summary: i.summary ?? "",
          content: i.content ?? "",
          category_id: i.category_id ?? "",
          source: i.source ?? "",
          quality: i.quality?.toString() ?? "",
        });
      }
      setCategories((cats as Category[]) ?? []);
    });
  }, [id]);

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    await supabase.from("items").update({
      type: form.type,
      title: form.title.trim(),
      url: form.url || null,
      summary: form.summary || null,
      content: form.content || null,
      category_id: form.category_id || null,
      source: form.source || null,
      quality: form.quality ? parseInt(form.quality) : null,
    }).eq("id", id);
    setSaving(false);
    router.push(`/items/${id}`);
  }

  const typeOptions = [
    { value: "note", label: "📝 個人筆記" },
    { value: "news", label: "📰 新聞" },
    { value: "repo", label: "⭐ GitHub Repo" },
  ];

  const catOptions = [
    { value: "", label: "— 不分類 —" },
    ...categories.map((c) => ({ value: c.id, label: `${c.icon ?? ""} ${c.name}` })),
  ];

  const qualityOptions = [
    { value: "", label: "— 不評分 —" },
    { value: "5", label: "⭐⭐⭐⭐⭐ 必讀" },
    { value: "4", label: "⭐⭐⭐⭐ 很好" },
    { value: "3", label: "⭐⭐⭐ 普通" },
    { value: "2", label: "⭐⭐ 偏弱" },
    { value: "1", label: "⭐ 差" },
  ];

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-white/8 text-[#9898b0] hover:text-[#e8e8f0] transition-smooth">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-2xl font-semibold text-[#e8e8f0]">編輯內容</h1>
      </div>

      <Card className="p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Select label="類型" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ItemType })} options={typeOptions} />
          <Select label="分類" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} options={catOptions} />
        </div>
        <Input label="標題 *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="輸入標題..." />
        <Input label="連結 URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://..." type="url" />
        <div className="grid grid-cols-2 gap-4">
          <Input label="來源" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. arXiv..." />
          <Select label="品質評分" value={form.quality} onChange={(e) => setForm({ ...form, quality: e.target.value })} options={qualityOptions} />
        </div>
        <Textarea label="摘要" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="一兩句話描述重點..." rows={3} />
        <Textarea label="內容 / 筆記" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="詳細筆記..." rows={8} />
      </Card>

      <div className="flex gap-3 justify-end">
        <Button variant="ghost" onClick={() => router.back()}>取消</Button>
        <Button variant="primary" loading={saving} onClick={save}>儲存</Button>
      </div>
    </div>
  );
}
