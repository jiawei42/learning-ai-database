"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Item, ItemRelation, Category } from "@/types/database";

const TYPE_COLORS = {
  news:  { border: "#0ea5e9", bg: "#1e3a5f" },
  repo:  { border: "#10b981", bg: "#1f2f1a" },
  note:  { border: "#8b5cf6", bg: "#2d2040" },
};

export default function GraphPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("載入資料中...");
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [selected, setSelected] = useState<Item | null>(null);

  useEffect(() => {
    let network: import("vis-network").Network | null = null;

    async function init() {
      const [{ data: items }, { data: relations }, { data: categories }] = await Promise.all([
        supabase.from("items").select("id, title, type, category_id, summary, url"),
        supabase.from("item_relations").select("source_id, target_id, relation_type"),
        supabase.from("categories").select("id, name, color"),
      ]);

      if (!items || items.length === 0) {
        setStatus("尚無資料，新增內容後關聯會自動顯示");
        return;
      }

      const catMap = Object.fromEntries(
        (categories ?? []).map((c: Category) => [c.id, c])
      );

      const { DataSet } = await import("vis-data");
      const { Network } = await import("vis-network");

      const nodes = new DataSet(
        (items as Item[]).map((item) => {
          const cat = item.category_id ? catMap[item.category_id] : null;
          const colors = TYPE_COLORS[item.type] ?? TYPE_COLORS.note;
          return {
            id: item.id,
            label: item.title.length > 30 ? item.title.slice(0, 28) + "…" : item.title,
            title: item.summary ?? item.title,
            color: {
              background: cat ? cat.color + "33" : colors.bg,
              border: cat ? cat.color : colors.border,
              highlight: { background: colors.bg, border: colors.border },
              hover: { background: colors.bg, border: colors.border },
            },
            font: { color: "#e8e8f0", size: 12, face: "Inter, sans-serif" },
            shape: item.type === "repo" ? "diamond" : item.type === "news" ? "dot" : "box",
            size: item.type === "repo" ? 14 : 10,
            borderWidth: 1.5,
            _data: item,
          };
        })
      );

      const edges = new DataSet(
        (relations as ItemRelation[]).map((r) => ({
          from: r.source_id,
          to: r.target_id,
          color: { color: "#3a3a52", highlight: "#6366f1" },
          width: 1,
          label: r.relation_type !== "related" ? r.relation_type : undefined,
          font: { color: "#9898b0", size: 10 },
          arrows: { to: { enabled: true, scaleFactor: 0.5 } },
          smooth: { type: "curvedCW", roundness: 0.2 },
        }))
      );

      setStats({ nodes: nodes.length, edges: edges.length });

      if (!containerRef.current) return;

      network = new Network(
        containerRef.current,
        { nodes, edges },
        {
          physics: {
            stabilization: { iterations: 150 },
            barnesHut: { gravitationalConstant: -3000, springLength: 150 },
          },
          interaction: {
            hover: true,
            tooltipDelay: 200,
            zoomView: true,
            dragView: true,
          },
          layout: { improvedLayout: true },
        }
      );

      network.on("click", (params) => {
        if (params.nodes.length > 0) {
          const node = nodes.get(params.nodes[0]) as { _data: Item } & object;
          if (node) setSelected((node as { _data: Item })._data as Item);
        } else {
          setSelected(null);
        }
      });

      network.on("stabilized", () => setStatus(""));
    }

    init();
    return () => network?.destroy();
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#e8e8f0]">關聯圖</h1>
          <p className="text-sm text-[#9898b0] mt-1">
            {stats.nodes} 個節點 · {stats.edges} 條關聯
          </p>
        </div>
        {/* Legend */}
        <div className="flex gap-4 text-xs text-[#9898b0]">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#0ea5e9]" />新聞
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm bg-[#10b981] rotate-45 inline-block" />Repo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-2 rounded-sm bg-[#8b5cf6]" />筆記
          </span>
        </div>
      </div>

      <div className="relative">
        {/* Graph canvas */}
        <div
          ref={containerRef}
          className="glass w-full rounded-2xl overflow-hidden"
          style={{ height: "calc(100vh - 180px)" }}
        />

        {/* Status overlay */}
        {status && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[#0f0f18]/60 backdrop-blur-sm">
            <p className="text-sm text-[#9898b0]">{status}</p>
          </div>
        )}

        {/* Selected panel */}
        {selected && (
          <div className="absolute right-4 top-4 w-72 glass rounded-xl p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-[#e8e8f0] line-clamp-2">{selected.title}</p>
              <button onClick={() => setSelected(null)} className="text-[#9898b0] hover:text-[#e8e8f0] shrink-0 text-lg leading-none">×</button>
            </div>
            {selected.summary && (
              <p className="text-xs text-[#9898b0] line-clamp-4">{selected.summary}</p>
            )}
            <a href={`/items/${selected.id}`} className="text-xs text-[#6366f1] hover:text-[#818cf8]">
              查看詳情 →
            </a>
          </div>
        )}

        {/* Help */}
        <div className="absolute left-4 bottom-4 text-[10px] text-[#9898b0]/50 space-y-0.5">
          <p>滾輪縮放 · 拖曳移動 · 點擊查看</p>
        </div>
      </div>
    </div>
  );
}
