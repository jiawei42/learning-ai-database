"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { CategoryChip, TypeBadge } from "@/components/ui/Badge";
import type { Category, Item, ItemRelation } from "@/types/database";
import {
  GitMerge, Zap, X, ExternalLink, Filter, Eye, EyeOff, ZoomIn, ZoomOut,
  Maximize2, Link2, CheckCircle2, RefreshCw,
} from "lucide-react";

/* ── 顏色常數 ─────────────────────────────────────────────────── */
const TYPE_COLORS = {
  news: { border: "#0ea5e9", bg: "#0c2340" },
  repo: { border: "#10b981", bg: "#0c2018" },
  note: { border: "#8b5cf6", bg: "#1c1030" },
};

const RELATION_TYPES = [
  { value: "related",     label: "相關",   color: "#6366f1" },
  { value: "references",  label: "引用",   color: "#0ea5e9" },
  { value: "extends",     label: "延伸",   color: "#10b981" },
  { value: "contradicts", label: "相矛盾", color: "#ef4444" },
];

/* ── Types ───────────────────────────────────────────────────── */
type ItemType = "news" | "repo" | "note";

interface GraphItem extends Item {
  category?: Category;
}

interface GraphState {
  items:      GraphItem[];
  relations:  ItemRelation[];
  categories: Category[];
}

/* ── 從 metadata.tags 提取標籤 ──────────────────────────────── */
function getTags(item: GraphItem): string[] {
  const meta = (item.metadata ?? {}) as Record<string, unknown>;
  return Array.isArray(meta.tags) ? (meta.tags as string[]) : [];
}

/* ── 主元件 ─────────────────────────────────────────────────── */
export default function GraphPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const networkRef   = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodesRef     = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edgesRef     = useRef<any>(null);

  const [graphData, setGraphData]       = useState<GraphState | null>(null);
  const [status, setStatus]             = useState("載入資料中...");
  const [stats, setStats]               = useState({ nodes: 0, edges: 0 });

  // Filters
  const [showFilter, setShowFilter]     = useState(false);
  const [typeFilter, setTypeFilter]     = useState<Set<ItemType>>(new Set(["news","repo","note"]));
  const [catFilter, setCatFilter]       = useState<string>("");
  const [onlyConnected, setOnlyConnected] = useState(false);

  // Selection
  const [selected, setSelected]         = useState<GraphItem | null>(null);
  const [selectedRels, setSelectedRels] = useState<GraphItem[]>([]);

  // Connect mode
  const [connectFrom, setConnectFrom]   = useState<GraphItem | null>(null);
  const [connectModal, setConnectModal] = useState<{ a: GraphItem; b: GraphItem } | null>(null);
  const [connectType, setConnectType]   = useState("related");
  const [connecting, setConnecting]     = useState(false);

  // Auto-tag modal
  const [autoBuilding, setAutoBuilding] = useState(false);
  const [autoResult, setAutoResult]     = useState<string | null>(null);

  /* ── 載入資料 ──────────────────────────────────────────────── */
  const loadData = useCallback(async () => {
    setStatus("載入資料中...");
    const [{ data: items }, { data: relations }, { data: categories }] = await Promise.all([
      supabase.from("items").select("id,title,type,category_id,summary,url,metadata,quality,is_pinned,source,created_at,updated_at,content"),
      supabase.from("item_relations").select("source_id,target_id,relation_type,note"),
      supabase.from("categories").select("*"),
    ]);

    // 把 category join 進 item
    const catMap: Record<string, Category> = Object.fromEntries(
      (categories ?? []).map((c) => [c.id, c as Category])
    );
    const enriched: GraphItem[] = (items ?? []).map((item) => ({
      ...(item as Item),
      category: item.category_id ? catMap[item.category_id] : undefined,
    }));

    setGraphData({
      items:      enriched,
      relations:  (relations ?? []) as ItemRelation[],
      categories: (categories ?? []) as Category[],
    });
    setStatus("");
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── 建立/更新圖 ───────────────────────────────────────────── */
  useEffect(() => {
    if (!graphData || !containerRef.current) return;

    let cancelled = false;

    async function buildGraph() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { DataSet } = await import("vis-data") as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { Network } = await import("vis-network") as any;
      if (cancelled) return;

      // 篩選
      const connectedIds = new Set<string>();
      graphData!.relations.forEach((r) => {
        connectedIds.add(r.source_id);
        connectedIds.add(r.target_id);
      });

      const visibleItems = graphData!.items.filter((item) => {
        if (!typeFilter.has(item.type as ItemType)) return false;
        if (catFilter) {
          const cat = item.category;
          if (!cat) return false;
          // 支援選父分類（含子分類）
          if (cat.id !== catFilter && cat.parent_id !== catFilter) return false;
        }
        if (onlyConnected && !connectedIds.has(item.id)) return false;
        return true;
      });

      const visibleIds = new Set(visibleItems.map((i) => i.id));

      const nodeData = visibleItems.map((item) => {
        const colors = TYPE_COLORS[item.type as ItemType] ?? TYPE_COLORS.note;
        const catColor = item.category?.color;
        return {
          id:    item.id,
          label: item.title.length > 28 ? item.title.slice(0, 26) + "…" : item.title,
          title: item.summary ?? item.title,
          color: {
            background: catColor ? catColor + "28" : colors.bg,
            border:     catColor ?? colors.border,
            highlight:  { background: catColor ? catColor + "55" : "#2a2a3a", border: catColor ?? colors.border },
            hover:      { background: catColor ? catColor + "40" : "#2a2a3a", border: catColor ?? colors.border },
          },
          font:        { color: "#e8e8f0", size: 12, face: "Inter, sans-serif" },
          shape:       item.type === "repo" ? "diamond" : item.type === "news" ? "dot" : "box",
          size:        item.is_pinned ? 16 : (item.type === "repo" ? 13 : 10),
          borderWidth: item.is_pinned ? 2.5 : 1.5,
          _data:       item,
        };
      });

      const edgeData = graphData!.relations
        .filter((r) => visibleIds.has(r.source_id) && visibleIds.has(r.target_id))
        .map((r, i) => {
          const rel = RELATION_TYPES.find((t) => t.value === r.relation_type);
          return {
            id:     `e-${i}`,
            from:   r.source_id,
            to:     r.target_id,
            color:  { color: rel?.color ?? "#3a3a52", highlight: rel?.color ?? "#6366f1", opacity: 0.7 },
            width:  1.5,
            label:  r.relation_type !== "related" ? rel?.label : undefined,
            font:   { color: "#9898b0", size: 10, background: "#1a1a28" },
            arrows: { to: { enabled: true, scaleFactor: 0.5 } },
            smooth: { enabled: true, type: "curvedCW", roundness: 0.15 },
          };
        });

      if (networkRef.current) networkRef.current.destroy();

      const nodes = new DataSet(nodeData);
      const edges = new DataSet(edgeData);
      nodesRef.current = nodes;
      edgesRef.current = edges;

      setStats({ nodes: nodes.length, edges: edges.length });

      const network = new Network(
        containerRef.current!,
        { nodes, edges },
        {
          physics: {
            stabilization: { iterations: 200 },
            barnesHut: {
              gravitationalConstant: -4000,
              centralGravity:        0.3,
              springLength:          160,
              springConstant:        0.04,
            },
          },
          interaction: {
            hover:        true,
            tooltipDelay: 200,
            zoomView:     true,
            dragView:     true,
          },
          layout: { improvedLayout: nodes.length < 100 },
        }
      );

      networkRef.current = network;
      network.on("stabilized", () => setStatus(""));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      network.on("click", (params: any) => {
        if (params.nodes.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const node = nodes.get(params.nodes[0]) as any;
          if (!node) return;
          const item = node._data as GraphItem;

          setConnectFrom((prev) => {
            if (prev) {
              // Connect mode — clicked second node
              if (prev.id !== item.id) {
                setConnectModal({ a: prev, b: item });
              }
              return null;
            }
            // Normal select
            setSelected(item);

            // Find connected items
            const rels = graphData!.relations.filter(
              (r) => r.source_id === item.id || r.target_id === item.id
            );
            const connIds = rels.map((r) => r.source_id === item.id ? r.target_id : r.source_id);
            const connItems = graphData!.items.filter((i) => connIds.includes(i.id));
            setSelectedRels(connItems);
            return null;
          });
        } else {
          setSelected(null);
          setConnectFrom(null);
        }
      });
    }

    buildGraph();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, typeFilter, catFilter, onlyConnected]);

  /* ── 更新游標（connect mode）───────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.style.cursor = connectFrom ? "crosshair" : "default";
  }, [connectFrom]);

  /* ── 儲存關聯 ──────────────────────────────────────────────── */
  async function saveRelation() {
    if (!connectModal) return;
    setConnecting(true);
    await supabase.from("item_relations").upsert({
      source_id:     connectModal.a.id,
      target_id:     connectModal.b.id,
      relation_type: connectType,
    });
    setConnectModal(null);
    setConnecting(false);
    loadData();
  }

  /* ── 刪除關聯 ──────────────────────────────────────────────── */
  async function deleteRelation(targetId: string) {
    if (!selected) return;
    await supabase.from("item_relations").delete()
      .or(`and(source_id.eq.${selected.id},target_id.eq.${targetId}),and(source_id.eq.${targetId},target_id.eq.${selected.id})`);
    loadData();
  }

  /* ── 從標籤自動建立關聯 ─────────────────────────────────────── */
  async function autoTagRelations() {
    if (!graphData) return;
    setAutoBuilding(true);
    setAutoResult(null);

    // 找有相同標籤的 items，建立 related 關聯
    const tagMap: Record<string, string[]> = {}; // tag → item ids
    graphData.items.forEach((item) => {
      getTags(item).forEach((tag) => {
        if (!tagMap[tag]) tagMap[tag] = [];
        tagMap[tag].push(item.id);
      });
    });

    const pairs = new Set<string>();
    Object.values(tagMap).forEach((ids) => {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const [a, b] = [ids[i], ids[j]].sort();
          pairs.add(`${a}|${b}`);
        }
      }
    });

    // 排除已存在的關聯
    const existingPairs = new Set(
      graphData.relations.map((r) => [r.source_id, r.target_id].sort().join("|"))
    );
    const newPairs = [...pairs].filter((p) => !existingPairs.has(p));

    if (newPairs.length === 0) {
      setAutoResult("沒有新的標籤關聯可建立");
      setAutoBuilding(false);
      return;
    }

    const toInsert = newPairs.slice(0, 50).map((p) => {
      const [source_id, target_id] = p.split("|");
      return { source_id, target_id, relation_type: "related" };
    });

    const { error } = await supabase.from("item_relations").upsert(toInsert);
    setAutoBuilding(false);
    if (error) {
      setAutoResult(`失敗：${error.message}`);
    } else {
      setAutoResult(`✓ 建立了 ${toInsert.length} 條標籤關聯`);
      loadData();
    }
  }

  /* ── Zoom controls ──────────────────────────────────────────── */
  function zoomIn()  { networkRef.current?.moveTo({ scale: (networkRef.current.getScale() ?? 1) * 1.3 }); }
  function zoomOut() { networkRef.current?.moveTo({ scale: (networkRef.current.getScale() ?? 1) / 1.3 }); }
  function fitAll()  { networkRef.current?.fit({ animation: true }); }

  const topLevelCats = graphData?.categories.filter((c) => !c.parent_id) ?? [];

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] gap-0">
      {/* Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1 pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[#e8e8f0] flex items-center gap-2">
              <GitMerge size={20} className="text-[#6366f1]" />
              關聯圖
            </h1>
            <p className="text-xs text-[#9898b0] mt-0.5">
              {stats.nodes} 個節點 · {stats.edges} 條關聯
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto tag button */}
          <button
            onClick={autoTagRelations}
            disabled={autoBuilding}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                       bg-[#6366f1]/15 text-[#818cf8] hover:bg-[#6366f1]/25 transition-smooth disabled:opacity-50"
          >
            <Zap size={12} />
            {autoBuilding ? "建立中..." : "從標籤自動建立關聯"}
          </button>
          {autoResult && (
            <span className="text-xs text-[#9898b0]">{autoResult}</span>
          )}

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilter((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-smooth
              ${showFilter ? "bg-[#6366f1] text-white" : "bg-white/5 text-[#9898b0] hover:text-[#e8e8f0]"}`}
          >
            <Filter size={12} />
            篩選
          </button>
        </div>
      </div>

      {/* Filter panel ─────────────────────────────────────────── */}
      {showFilter && (
        <div className="flex items-center gap-6 px-4 py-3 mb-3 glass rounded-xl text-xs shrink-0 flex-wrap">
          {/* Type */}
          <div className="flex items-center gap-3">
            <span className="text-[#9898b0] font-medium">類型</span>
            {(["news","repo","note"] as ItemType[]).map((t) => (
              <label key={t} className="flex items-center gap-1.5 cursor-pointer text-[#e8e8f0]">
                <input
                  type="checkbox"
                  checked={typeFilter.has(t)}
                  onChange={(e) => {
                    const next = new Set(typeFilter);
                    e.target.checked ? next.add(t) : next.delete(t);
                    setTypeFilter(next);
                  }}
                  className="accent-[#6366f1]"
                />
                {t === "news" ? "新聞" : t === "repo" ? "Repo" : "筆記"}
              </label>
            ))}
          </div>

          <div className="w-px h-4 bg-white/10" />

          {/* Category */}
          <div className="flex items-center gap-2">
            <span className="text-[#9898b0] font-medium">分類</span>
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="bg-[#1e1e2c] border border-white/10 rounded-lg px-2 py-1 text-xs
                         text-[#e8e8f0] focus:outline-none focus:border-[#6366f1]/60"
            >
              <option value="">全部</option>
              {topLevelCats.map((c) => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
          </div>

          <div className="w-px h-4 bg-white/10" />

          {/* Only connected */}
          <label className="flex items-center gap-1.5 cursor-pointer text-[#e8e8f0]">
            <input
              type="checkbox"
              checked={onlyConnected}
              onChange={(e) => setOnlyConnected(e.target.checked)}
              className="accent-[#6366f1]"
            />
            只顯示有關聯的節點
          </label>

          {/* Legend */}
          <div className="ml-auto flex items-center gap-3 text-[#9898b0]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#0ea5e9]"/>新聞</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#10b981] rotate-45 inline-block"/>Repo</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-[#8b5cf6]"/>筆記</span>
          </div>
        </div>
      )}

      {/* Graph area ─────────────────────────────────────────── */}
      <div className="relative flex-1 min-h-0">
        {/* Canvas */}
        <div
          ref={containerRef}
          className="glass w-full h-full rounded-2xl overflow-hidden"
        />

        {/* Status overlay */}
        {status && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[#0f0f18]/70 backdrop-blur-sm pointer-events-none">
            <div className="flex items-center gap-2 text-sm text-[#9898b0]">
              <RefreshCw size={14} className="animate-spin" />
              {status}
            </div>
          </div>
        )}

        {/* Connect mode banner */}
        {connectFrom && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2
                          bg-[#6366f1] text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg">
            <Link2 size={13} />
            點擊另一個節點以建立關聯（目標：{connectFrom.title.slice(0, 30)}...）
            <button onClick={() => setConnectFrom(null)} className="ml-1 opacity-70 hover:opacity-100">
              <X size={13} />
            </button>
          </div>
        )}

        {/* Zoom controls */}
        <div className="absolute right-4 bottom-4 flex flex-col gap-1.5">
          <button onClick={zoomIn}  className="w-8 h-8 rounded-lg glass flex items-center justify-center text-[#9898b0] hover:text-[#e8e8f0] transition-smooth"><ZoomIn size={14}/></button>
          <button onClick={zoomOut} className="w-8 h-8 rounded-lg glass flex items-center justify-center text-[#9898b0] hover:text-[#e8e8f0] transition-smooth"><ZoomOut size={14}/></button>
          <button onClick={fitAll}  className="w-8 h-8 rounded-lg glass flex items-center justify-center text-[#9898b0] hover:text-[#e8e8f0] transition-smooth"><Maximize2 size={14}/></button>
        </div>

        {/* Help */}
        <div className="absolute left-4 bottom-4 text-[10px] text-[#9898b0]/40">
          滾輪縮放 · 拖曳移動 · 點擊查看節點
        </div>

        {/* Selected panel */}
        {selected && !connectFrom && (
          <div className="absolute right-4 top-4 w-72 glass rounded-xl overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-white/6">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex gap-1.5 flex-wrap">
                  <TypeBadge type={selected.type as "news"|"repo"|"note"} />
                  {selected.category && (
                    <CategoryChip
                      name={selected.category.name}
                      color={selected.category.color}
                      icon={selected.category.icon}
                    />
                  )}
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="text-[#9898b0] hover:text-[#e8e8f0] shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
              <p className="text-sm font-medium text-[#e8e8f0] line-clamp-2">{selected.title}</p>
              {selected.summary && (
                <p className="text-xs text-[#9898b0] mt-1.5 line-clamp-3">{selected.summary}</p>
              )}
              <div className="flex gap-2 mt-3">
                <Link
                  href={`/items/${selected.id}`}
                  className="flex items-center gap-1 text-[10px] text-[#6366f1] hover:text-[#818cf8]"
                >
                  <ExternalLink size={10} /> 查看詳情
                </Link>
                <button
                  onClick={() => { setConnectFrom(selected); setSelected(null); }}
                  className="flex items-center gap-1 text-[10px] text-[#10b981] hover:text-[#34d399] ml-auto"
                >
                  <Link2 size={10} /> 建立關聯
                </button>
              </div>
            </div>

            {/* Relations */}
            <div className="p-3 max-h-56 overflow-y-auto">
              {selectedRels.length === 0 ? (
                <p className="text-xs text-[#9898b0]/60 text-center py-3">暫無關聯</p>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-medium text-[#9898b0] uppercase tracking-wider mb-2">
                    關聯節點 ({selectedRels.length})
                  </p>
                  {selectedRels.map((rel) => (
                    <div key={rel.id} className="flex items-center gap-2 group">
                      <Link
                        href={`/items/${rel.id}`}
                        className="flex-1 text-[11px] text-[#e8e8f0] hover:text-[#818cf8] line-clamp-1"
                      >
                        {rel.title}
                      </Link>
                      <button
                        onClick={() => deleteRelation(rel.id)}
                        className="opacity-0 group-hover:opacity-100 text-[#9898b0] hover:text-red-400 transition-smooth"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Connect modal ─────────────────────────────────────────── */}
      {connectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass rounded-2xl p-6 w-96 space-y-4">
            <h2 className="text-base font-semibold text-[#e8e8f0] flex items-center gap-2">
              <Link2 size={16} className="text-[#6366f1]" /> 建立關聯
            </h2>

            <div className="space-y-1.5 text-xs text-[#9898b0]">
              <p className="truncate"><span className="text-[#e8e8f0]">A：</span>{connectModal.a.title}</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-[#6366f1]">↔</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>
              <p className="truncate"><span className="text-[#e8e8f0]">B：</span>{connectModal.b.title}</p>
            </div>

            <div>
              <p className="text-xs text-[#9898b0] mb-2">關聯類型</p>
              <div className="grid grid-cols-2 gap-2">
                {RELATION_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setConnectType(t.value)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium border transition-smooth
                      ${connectType === t.value
                        ? "border-[#6366f1] bg-[#6366f1]/20 text-white"
                        : "border-white/10 text-[#9898b0] hover:border-white/20"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setConnectModal(null)}
                className="px-4 py-2 rounded-xl text-xs text-[#9898b0] hover:text-[#e8e8f0] transition-smooth"
              >
                取消
              </button>
              <button
                onClick={saveRelation}
                disabled={connecting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium
                           bg-[#6366f1] text-white hover:bg-[#4f52c4] transition-smooth disabled:opacity-50"
              >
                <CheckCircle2 size={13} />
                {connecting ? "儲存中..." : "建立關聯"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
