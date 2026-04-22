"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import type { Category } from "@/types/database";
import { Plus, Edit2, Trash2, X, Check, ChevronRight } from "lucide-react";

const PRESET_COLORS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
  "#ec4899", "#8b5cf6", "#64748b", "#ef4444",
  "#818cf8", "#38bdf8", "#34d399", "#fbbf24",
];

interface EditState {
  name: string;
  slug: string;
  color: string;
  icon: string;
  description: string;
  parent_id: string;
}

const empty: EditState = {
  name: "", slug: "", color: "#6366f1", icon: "", description: "", parent_id: "",
};

type CatNode = Category & { children: Category[] };

function buildTree(cats: Category[]): CatNode[] {
  const roots = cats.filter((c) => !c.parent_id).map((c) => ({ ...c, children: [] as Category[] }));
  roots.forEach((root) => {
    root.children = cats.filter((c) => c.parent_id === root.id);
  });
  return roots;
}

export default function CategoriesPage() {
  const [cats, setCats]     = useState<Category[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [editId, setEditId] = useState<string | "new" | null>(null);
  const [form, setForm]     = useState<EditState>(empty);
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

  function startNew() { setEditId("new"); setForm(empty); }

  function startEdit(cat: Category) {
    setEditId(cat.id);
    setForm({
      name:        cat.name,
      slug:        cat.slug,
      color:       cat.color,
      icon:        cat.icon ?? "",
      description: cat.description ?? "",
      parent_id:   cat.parent_id ?? "",
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
      name:        form.name.trim(),
      slug:        form.slug || autoSlug(form.name),
      color:       form.color,
      icon:        form.icon || null,
      description: form.description || null,
      parent_id:   form.parent_id || null,
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

  // 頂層分類（供 parent 選單用）
  const roots = cats.filter((c) => !c.parent_id);
  const tree  = buildTree(cats);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#e8e8f0]">分類管理</h1>
          <p className="text-sm text-[#9898b0] mt-1">
            {roots.length} 個頂層分類 · {cats.length - roots.length} 個子分類
          </p>
        </div>
        {editId === null && (
          <Button variant="primary" icon={<Plus size={16} />} onClick={startNew}>新增分類</Button>
        )}
      </div>

      {/* Form */}
      {editId !== null && (
        <Card className="p-5 space-y-4">
          <p className="text-sm font-semibold text-[#e8e8f0]">
            {editId === "new" ? "新增分類" : "編輯分類"}
          </p>

          {/* Parent selector */}
          <div>
            <p className="text-sm font-medium text-[#9898b0] mb-1.5">上層分類</p>
            <select
              value={form.parent_id}
              onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#1e1e2c] border border-white/10
                         text-[#e8e8f0] focus:outline-none focus:border-[#6366f1]/60 transition-smooth"
            >
              <option value="">— 頂層分類（無上層）—</option>
              {roots
                .filter((r) => r.id !== editId) // 不能選自己當父
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.icon} {r.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input
              label="名稱 *"
              value={form.name}
              onChange={(e) =>
                setForm({ ...form, name: e.target.value, slug: autoSlug(e.target.value) })
              }
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
                    background:  c,
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

      {/* Category tree */}
      <div className="space-y-3">
        {tree.map((parent) => (
          <div key={parent.id}>
            {/* Parent row */}
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                  style={{ background: parent.color + "22" }}
                >
                  {parent.icon ?? "📁"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold" style={{ color: parent.color }}>
                      {parent.name}
                    </p>
                    <span className="text-[10px] text-[#9898b0] bg-white/5 px-2 py-0.5 rounded-full">
                      {counts[parent.id] ?? 0} 筆
                    </span>
                    {parent.children.length > 0 && (
                      <span className="text-[10px] text-[#9898b0]/60">
                        {parent.children.length} 子分類
                      </span>
                    )}
                  </div>
                  {parent.description && (
                    <p className="text-xs text-[#9898b0] mt-0.5 line-clamp-1">{parent.description}</p>
                  )}
                  <p className="text-[10px] text-[#9898b0]/40 mt-0.5">/{parent.slug}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => startEdit(parent)}
                    className="p-1.5 rounded-lg hover:bg-white/8 text-[#9898b0] hover:text-[#e8e8f0] transition-smooth"
                  >
                    <Edit2 size={13} />
                  </button>
                  <button
                    onClick={() => del(parent.id)}
                    className="p-1.5 rounded-lg hover:bg-red-500/15 text-[#9898b0] hover:text-red-400 transition-smooth"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </Card>

            {/* Children */}
            {parent.children.length > 0 && (
              <div className="ml-6 mt-1.5 space-y-1.5 border-l-2 border-white/8 pl-4">
                {parent.children.map((child) => (
                  <Card key={child.id} className="p-3">
                    <div className="flex items-center gap-3">
                      <ChevronRight size={12} className="text-[#9898b0]/40 shrink-0" />
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0"
                        style={{ background: child.color + "22" }}
                      >
                        {child.icon ?? "📁"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium" style={{ color: child.color }}>
                            {child.name}
                          </p>
                          <span className="text-[10px] text-[#9898b0] bg-white/5 px-1.5 py-0.5 rounded-full">
                            {counts[child.id] ?? 0} 筆
                          </span>
                        </div>
                        {child.description && (
                          <p className="text-[10px] text-[#9898b0] mt-0.5 line-clamp-1">
                            {child.description}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => startEdit(child)}
                          className="p-1.5 rounded-lg hover:bg-white/8 text-[#9898b0] hover:text-[#e8e8f0] transition-smooth"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={() => del(child.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/15 text-[#9898b0] hover:text-red-400 transition-smooth"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
