"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import type { Category } from "@/types/database";
import { Plus, Edit2, Trash2, X, Check } from "lucide-react";

const PRESET_COLORS = [
  "#6366f1","#0ea5e9","#10b981","#f59e0b",
  "#ec4899","#8b5cf6","#64748b","#ef4444",
];

interface EditState {
  name: string;
  slug: string;
  color: string;
  icon: string;
  description: string;
}

const empty: EditState = { name: "", slug: "", color: "#6366f1", icon: "", description: "" };

export default function CategoriesPage() {
  const [cats, setCats] = useState<Category[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [editId, setEditId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<EditState>(empty);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [{ data }, { data: countData }] = await Promise.all([
      supabase.from("categories").select("*").order("name"),
      supabase.from("items").select("category_id"),
    ]);
    setCats((data as Category[]) ?? []);
    const c: Record<string, number> = {};
    (countData ?? []).forEach((row: { category_id: string | null }) => {
      if (row.category_id) c[row.category_id] = (c[row.category_id] ?? 0) + 1;
    });
    setCounts(c);
  }

  useEffect(() => { load(); }, []);

  function startNew() {
    setEditId("new");
    setForm(empty);
  }

  function startEdit(cat: Category) {
    setEditId(cat.id);
    setForm({
      name: cat.name,
      slug: cat.slug,
      color: cat.color,
      icon: cat.icon ?? "",
      description: cat.description ?? "",
    });
  }

  function cancel() { setEditId(null); setForm(empty); }

  function autoSlug(name: string) {
    return name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
  }

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      slug: form.slug || autoSlug(form.name),
      color: form.color,
      icon: form.icon || null,
      description: form.description || null,
    };

    if (editId === "new") {
      await supabase.from("categories").insert(payload);
    } else {
      await supabase.from("categories").update(payload).eq("id", editId);
    }
    setSaving(false);
    cancel();
    load();
  }

  async function del(id: string) {
    if (!confirm("刪除後，該分類下的內容會變成未分類，確定刪除？")) return;
    await supabase.from("categories").delete().eq("id", id);
    load();
  }

  const showForm = editId !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#e8e8f0]">分類管理</h1>
          <p className="text-sm text-[#9898b0] mt-1">{cats.length} 個分類</p>
        </div>
        {!showForm && (
          <Button variant="primary" icon={<Plus size={16} />} onClick={startNew}>新增分類</Button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <Card className="p-5 space-y-4">
          <p className="text-sm font-semibold text-[#e8e8f0]">
            {editId === "new" ? "新增分類" : "編輯分類"}
          </p>
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="名稱 *"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value, slug: autoSlug(e.target.value) })}
              placeholder="AI 模型"
            />
            <Input
              label="Slug"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              placeholder="ai-models"
            />
            <Input
              label="Icon (emoji)"
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              placeholder="🧠"
            />
          </div>

          {/* Color picker */}
          <div>
            <p className="text-sm font-medium text-[#9898b0] mb-2">顏色</p>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  className="w-7 h-7 rounded-lg border-2 transition-smooth"
                  style={{
                    background: c,
                    borderColor: form.color === c ? "#fff" : "transparent",
                  }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="w-7 h-7 rounded-lg cursor-pointer border-0 bg-transparent"
                title="自訂顏色"
              />
            </div>
          </div>

          <Textarea
            label="說明"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="這個分類的用途..."
            rows={2}
          />

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" icon={<X size={14} />} onClick={cancel}>取消</Button>
            <Button variant="primary" icon={<Check size={14} />} loading={saving} onClick={save}>儲存</Button>
          </div>
        </Card>
      )}

      {/* Category list */}
      <div className="grid grid-cols-2 gap-4">
        {cats.map((cat) => (
          <Card key={cat.id} className="p-4">
            <div className="flex items-start gap-3">
              {/* Color dot + icon */}
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                style={{ background: cat.color + "22" }}
              >
                {cat.icon ?? "📁"}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[#e8e8f0]" style={{ color: cat.color }}>
                    {cat.name}
                  </p>
                  <span className="text-[10px] text-[#9898b0] bg-white/5 px-2 py-0.5 rounded-full">
                    {counts[cat.id] ?? 0} 筆
                  </span>
                </div>
                {cat.description && (
                  <p className="text-xs text-[#9898b0] mt-0.5 line-clamp-1">{cat.description}</p>
                )}
                <p className="text-[10px] text-[#9898b0]/50 mt-0.5">/{cat.slug}</p>
              </div>

              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => startEdit(cat)}
                  className="p-1.5 rounded-lg hover:bg-white/8 text-[#9898b0] hover:text-[#e8e8f0] transition-smooth"
                >
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => del(cat.id)}
                  className="p-1.5 rounded-lg hover:bg-red-500/15 text-[#9898b0] hover:text-red-400 transition-smooth"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
