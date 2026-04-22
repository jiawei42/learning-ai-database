"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Zap, Link2, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select, CategorySelect } from "@/components/ui/Input";
import type { Category } from "@/types/database";

type Step = "input" | "analyzing" | "review" | "saving" | "done";
type InputMode = "url" | "text";

interface AnalyzedItem {
  title: string;
  summary: string;
  content: string;
  category: string;
  quality: number;
  tags: string[];
  source: string;
  url: string | null;
  fetch_note: string | null;
}

export default function SmartAddPage() {
  const router = useRouter();
  const [step, setStep]           = useState<Step>("input");
  const [mode, setMode]           = useState<InputMode>("url");
  const [inputVal, setInputVal]   = useState("");
  const [error, setError]         = useState<string | null>(null);
  const [analyzed, setAnalyzed]   = useState<AnalyzedItem | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  // Editable form state (initialized from analyzed result)
  const [form, setForm] = useState({
    title: "", summary: "", content: "",
    category_slug: "", quality: "3", source: "", url: "",
    category_id: "",
  });

  useEffect(() => {
    supabase.from("categories").select("*").order("name").then(({ data }) =>
      setCategories((data as Category[]) ?? [])
    );
  }, []);

  // When analyzed result comes in, pre-fill form
  useEffect(() => {
    if (!analyzed) return;
    const cat = categories.find((c) => c.slug === analyzed.category);
    setForm({
      title:        analyzed.title,
      summary:      analyzed.summary,
      content:      analyzed.content ?? "",
      category_slug: analyzed.category,
      quality:      String(analyzed.quality ?? 3),
      source:       analyzed.source ?? "",
      url:          analyzed.url ?? "",
      category_id:  cat?.id ?? "",
    });
  }, [analyzed, categories]);

  async function analyze() {
    if (!inputVal.trim()) return;
    setError(null);
    setStep("analyzing");

    try {
      const body = mode === "url"
        ? { url: inputVal.trim() }
        : { text: inputVal.trim() };

      const res = await fetch("/api/smart-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "分析失敗，請重試");
        setStep("input");
        return;
      }

      setAnalyzed(data as AnalyzedItem);
      setStep("review");
    } catch (e) {
      setError(`網路錯誤：${String(e)}`);
      setStep("input");
    }
  }

  async function save() {
    setStep("saving");
    try {
      const { error: err } = await supabase.from("items").insert({
        type:        "note",
        title:       form.title.trim(),
        url:         form.url || null,
        summary:     form.summary || null,
        content:     form.content || null,
        category_id: form.category_id || null,
        source:      form.source || null,
        quality:     parseInt(form.quality) || 3,
        is_pinned:   false,
        metadata:    {
          tags:          analyzed?.tags ?? [],
          ai_processed:  true,
          smart_added:   true,
        },
      });
      if (err) throw new Error(err.message);
      setStep("done");
      setTimeout(() => router.push("/items"), 1500);
    } catch (e) {
      setError(`儲存失敗：${String(e)}`);
      setStep("review");
    }
  }

  const qualityOptions = [
    { value: "5", label: "⭐⭐⭐⭐⭐ 必讀" },
    { value: "4", label: "⭐⭐⭐⭐ 很好" },
    { value: "3", label: "⭐⭐⭐ 普通" },
    { value: "2", label: "⭐⭐ 偏弱" },
    { value: "1", label: "⭐ 差" },
  ];

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-white/8 text-[#9898b0] hover:text-[#e8e8f0] transition-smooth"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-[#e8e8f0] flex items-center gap-2">
            <Zap size={22} className="text-[#6366f1]" />
            智慧新增
          </h1>
          <p className="text-xs text-[#9898b0] mt-0.5">貼上網址或文章內容，AI 自動萃取知識卡片</p>
        </div>
      </div>

      {/* Done */}
      {step === "done" && (
        <Card className="p-8 text-center space-y-2">
          <CheckCircle2 size={40} className="text-[#10b981] mx-auto" />
          <p className="text-[#e8e8f0] font-medium">已儲存！跳轉中...</p>
        </Card>
      )}

      {/* Input step */}
      {(step === "input" || step === "analyzing") && (
        <Card className="p-6 space-y-5">
          {/* Mode toggle */}
          <div className="flex gap-1 p-1 glass rounded-xl w-fit">
            <button
              onClick={() => setMode("url")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-smooth ${
                mode === "url" ? "bg-[#6366f1] text-white" : "text-[#9898b0] hover:text-[#e8e8f0]"
              }`}
            >
              <Link2 size={13} /> 貼網址
            </button>
            <button
              onClick={() => setMode("text")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-smooth ${
                mode === "text" ? "bg-[#6366f1] text-white" : "text-[#9898b0] hover:text-[#e8e8f0]"
              }`}
            >
              <FileText size={13} /> 貼內容
            </button>
          </div>

          {mode === "url" ? (
            <Input
              label="文章 URL"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="https://..."
              type="url"
              onKeyDown={(e) => e.key === "Enter" && analyze()}
            />
          ) : (
            <Textarea
              label="貼上 Web Clipper / 文章內容"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="貼上文章全文、HTML 或 Markdown，AI 會自動清理和萃取重點..."
              rows={10}
            />
          )}

          {error && (
            <div className="flex items-start gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <p className="text-xs">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => router.back()}>取消</Button>
            <Button
              variant="primary"
              icon={<Zap size={14} />}
              loading={step === "analyzing"}
              onClick={analyze}
              disabled={!inputVal.trim()}
            >
              {step === "analyzing" ? "AI 分析中..." : "開始分析"}
            </Button>
          </div>
        </Card>
      )}

      {/* Review step */}
      {(step === "review" || step === "saving") && analyzed && (
        <>
          {/* AI result notice */}
          <div className="flex items-center gap-2 text-xs text-[#6366f1] bg-[#6366f1]/10 border border-[#6366f1]/20 rounded-xl px-4 py-2.5">
            <Zap size={13} />
            <span>AI 已萃取完成，請確認內容後儲存</span>
            {analyzed.fetch_note && (
              <span className="ml-auto text-amber-400">⚠ 頁面擷取有限，結果可能不完整</span>
            )}
          </div>

          <Card className="p-6 space-y-5">
            <Input
              label="標題 *"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />

            <Input
              label="URL"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              type="url"
            />

            <div className="grid grid-cols-2 gap-4">
              <CategorySelect
                label="分類"
                categories={categories}
                value={form.category_id}
                onChange={(e) => {
                  const cat = categories.find((c) => c.id === e.target.value);
                  setForm({ ...form, category_id: e.target.value, category_slug: cat?.slug ?? "" });
                }}
              />
              <Select
                label="品質評分"
                value={form.quality}
                onChange={(e) => setForm({ ...form, quality: e.target.value })}
                options={qualityOptions}
              />
            </div>

            <div className="flex gap-2">
              <Input
                label="來源"
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="flex-1"
              />
              <div className="flex flex-col gap-1.5 justify-end">
                <p className="text-sm font-medium text-[#9898b0]">標籤</p>
                <div className="flex flex-wrap gap-1">
                  {analyzed.tags.map((tag) => (
                    <span key={tag} className="tag-chip" style={{ background: "#6366f122", color: "#818cf8" }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <Textarea
              label="摘要"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              rows={3}
            />

            <Textarea
              label="AI 萃取內容（Markdown）"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={10}
            />
          </Card>

          {error && (
            <div className="flex items-start gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <p className="text-xs">{error}</p>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => { setStep("input"); setAnalyzed(null); }}>
              重新分析
            </Button>
            <Button variant="primary" loading={step === "saving"} onClick={save}>
              儲存到知識庫
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
