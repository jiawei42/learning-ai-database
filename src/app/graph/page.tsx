"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { CategoryChip, TypeBadge } from "@/components/ui/Badge";
import type { Category, Item, ItemRelation } from "@/types/database";
import {
  GitMerge, Zap, X, ExternalLink, Filter, ZoomIn, ZoomOut,
  Maximize2, Link2, CheckCircle2, RefreshCw, ChevronDown,
} from "lucide-react";

/* ── Colour constants ──────────────────────────────────────────── */
const TYPE_COLORS = {
  news: { border: "#0ea5e9", bg: "#071c2f", glow: "#0ea5e940" },
  repo: { border: "#10b981", bg: "#071a12", glow: "#10b98140" },
  note: { border: "#8b5cf6", bg: "#110b1f", glow: "#8b5cf640" },
};

const RELATION_TYPES = [
  { value: "related",     label: "相關",    color: "#6366f1" },
  { value: "references",  label: "引用",    color: "#0ea5e9" },
  { value: "extends",     label: "延伸",    color: "#10b981" },
  { value: "contradicts", label: "矛盾",    color: "#ef4444" },
];

type ItemType = "news" | "repo" | "note";

interface GraphItem extends Item {
  category?: Category;
}

interface GraphState {
  items:      GraphItem[];
  relations:  ItemRelation[];
  categories: Category[];
}

function getTags(item: GraphItem): string[] {
  const meta = (item.metadata ?? {}) as Record<string, unknown>;
  return Array.isArray(meta.tags) ? (meta.tags as string[]) : [];
}

/* ── Main component ─────────────────────────────────────────────── */
export default function GraphPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const networkRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodesRef  = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edgesRef  = useRef<any>(null);

  const [graphData, setGraphData]   = useState<GraphState | null>(null);
  const [status, setStatus]         = useState("載入資料中...");
  const [stats, setStats]           = useState({ nodes: 0, edges: 0 });

  const [showFilter, setShowFilter] = useState(false);
  const [typeFilter, setTypeFilter] = useState<Set<ItemType>>(new Set(["news","repo","note"]));
  const [catFilter, setCatFilter]   = useState<string>("");
  const [onlyConnected, setOnlyConnected] = useState(false);

  const [selected, setSelected]         = useState<GraphItem | null>(null);
  const [selectedRels, setSelectedRels] = useState<GraphItem[]>([]);

  const [connectFrom, setConnectFrom]   = useState<GraphItem | null>(null);
  const [connectModal, setConnectModal] = useState<{ a: GraphItem; b: GraphItem } | null>(null);
  const [connectType, setConnectType]   = useState("related");
  const [connecting, setConnecting]     = useState(false);

  const [autoBuilding, setAutoBuilding] = useState(false);
  const [autoResult, setAutoResult]     = useState<string | null>(null);

  /* ── Load data ──────────────────────────────────────────────── */
  const loadData = useCallback(async () => {
    setStatus("載入資料中...");
    const [{ data: items }, { data: relations }, { data: categories }] = await Promise.all([
      supabase.from("items").select("id,title,type,category_id,summary,url,metadata,quality,is_pinned,source,created_at,updated_at,content"),
      supabase.from("item_relations").select("source_id,target_id,relation_type,note"),
      supabase.from("categories").select("*"),
    ]);

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

  /* ── Build/update graph ─────────────────────────────────────── */
  useEffect(() => {
    if (!graphData || !containerRef.current) return;
    let cancelled = false;

    async function buildGraph() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { DataSet } = await import("vis-data") as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { Network } = await import("vis-network") as any;
      if (cancelled) return;

      /* Connection count per node (for sizing) */
      const connCount: Record<string, number> = {};
      graphData!.relations.forEach((r) => {
        connCount[r.source_id] = (connCount[r.source_id] ?? 0) + 1;
        connCount[r.target_id] = (connCount[r.target_id] ?? 0) + 1;
      });

      const connectedIds = new Set(Object.keys(connCount));

      const visibleItems = graphData!.items.filter((item) => {
        if (!typeFilter.has(item.type as ItemType)) return false;
        if (catFilter) {
          const cat = item.category;
          if (!cat) return false;
          if (cat.id !== catFilter && cat.parent_id !== catFilter) return false;
        }
        if (onlyConnected && !connectedIds.has(item.id)) return false;
        return true;
      });

      const visibleIds = new Set(visibleItems.map((i) => i.id));

      const nodeData = visibleItems.map((item) => {
        const colors  = TYPE_COLORS[item.type as ItemType] ?? TYPE_COLORS.note;
        const catColor = item.category?.color;
        const degree  = connCount[item.id] ?? 0;
        const isPinned = item.is_pinned;

        const borderColor = catColor ?? colors.border;
        const bgColor     = catColor ? catColor + "20" : colors.bg;
        const glowColor   = catColor ? catColor + "50" : colors.glow;
        const nodeSize    = isPinned ? 22 : Math.max(10, Math.min(20, 9 + degree * 1.8));

        return {
          id:    item.id,
          label: item.title.length > 26 ? item.title.slice(0, 24) + "…" : item.title,
          title: item.summary ?? item.title,
          color: {
            background: bgColor,
            border:     borderColor,
            highlight:  { background: catColor ? catColor + "45" : "#1e1e35", border: borderColor },
            hover:      { background: catColor ? catColor + "30" : "#1a1a2e", border: borderColor },
          },
          shadow: {
            enabled: true,
            color:   glowColor,
            size:    isPinned ? 22 : 12,
            x: 0,
            y: 0,
          },
          font: {
            color: "#eeeef8",
            size:  isPinned ? 13 : 11,
            face:  "Inter, system-ui, sans-serif",
            strokeWidth: 3,
            strokeColor: "#0c0c16",
          },
          shape:       item.type === "repo" ? "diamond" : item.type === "news" ? "ellipse" : "box",
          shapeProperties: { borderRadius: 4 },
          size:        nodeSize,
          borderWidth: isPinned ? 2.5 : 1.8,
          borderWidthSelected: 3,
          _data:       item,
        };
      });

      const edgeData = graphData!.relations
        .filter((r) => visibleIds.has(r.source_id) && visibleIds.has(r.target_id))
        .map((r, i) => {
          const rel = RELATION_TYPES.find((t) => t.value === r.relation_type);
          const edgeColor = rel?.color ?? "#32324a";
          return {
            id:    `e-${i}`,
            from:  r.source_id,
            to:    r.target_id,
            color: {
              color:     edgeColor + "90",
              highlight: edgeColor,
              hover:     edgeColor + "cc",
              opacity:   0.75,
            },
            width:         1.6,
            selectionWidth: 2.8,
            label: r.relation_type !== "related" ? rel?.label : undefined,
            font:  { color: "#9898b0", size: 9, background: "#13131e", strokeWidth: 0 },
            arrows: { to: { enabled: true, scaleFactor: 0.55, type: "arrow" } },
            smooth: { enabled: true, type: "dynamic", roundness: 0.25 },
            dashes: r.relation_type === "contradicts",
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
          nodes: {
            borderWidth: 1.8,
            borderWidthSelected: 3,
          },
          edges: {
            hoverWidth: 2.5,
          },
          physics: {
            stabilization: {
              iterations:     280,
              updateInterval: 15,
            },
            barnesHut: {
              gravitationalConstant: -5500,
              centralGravity:        0.12,
              springLength:          230,
              springConstant:        0.025,
              damping:               0.09,
              avoidOverlap:          0.85,
            },
            minVelocity: 0.4,
          },
          interaction: {
            hover:        true,
            tooltipDelay: 150,
            zoomView:     true,
            dragView:     true,
            multiselect:  false,
          },
          layout: {
            improvedLayout: nodes.length < 120,
            randomSeed:     42,
          },
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
              if (prev.id !== item.id) setConnectModal({ a: prev, b: item });
              return null;
            }
            setSelected(item);
            const rels = graphData!.relations.filter(
              (r) => r.source_id === item.id || r.target_id === item.id
            );
            const connIds = rels.map((r) =>
              r.source_id === item.id ? r.target_id : r.source_id
            );
            setSelectedRels(graphData!.items.filter((i) => connIds.includes(i.id)));
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

  /* ── Cursor for connect mode ────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.style.cursor = connectFrom ? "crosshair" : "default";
  }, [connectFrom]);

  /* ── Save relation ─────────────────────────────────────────── */
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

  /* ── Delete relation ────────────────────────────────────────── */
  async function deleteRelation(targetId: string) {
    if (!selected) return;
    await supabase.from("item_relations").delete()
      .or(`and(source_id.eq.${selected.id},target_id.eq.${targetId}),and(source_id.eq.${targetId},target_id.eq.${selected.id})`);
    loadData();
  }

  /* ── Auto-tag from shared tags ──────────────────────────────── */
  async function autoTagRelations() {
    if (!graphData) return;
    setAutoBuilding(true);
    setAutoResult(null);

    const tagMap: Record<string, string[]> = {};
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

    const existingPairs = new Set(
      graphData.relations.map((r) => [r.source_id, r.target_id].sort().join("|"))
    );
    const newPairs = [...pairs].filter((p) => !existingPairs.has(p));

    if (newPairs.length === 0) {
      setAutoResult("沒有新的標籤關聯");
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
      setAutoResult(`已建立 ${toInsert.length} 條關聯`);
      loadData();
    }
  }

  /* ── Zoom ────────────────────────────────────────────────────── */
  function zoomIn()  { networkRef.current?.moveTo({ scale: (networkRef.current.getScale() ?? 1) * 1.3, animation: { duration: 200 } }); }
  function zoomOut() { networkRef.current?.moveTo({ scale: (networkRef.current.getScale() ?? 1) / 1.3, animation: { duration: 200 } }); }
  function fitAll()  { networkRef.current?.fit({ animation: { duration: 400, easingFunction: "easeInOutQuad" } }); }

  const topLevelCats = graphData?.categories.filter((c) => !c.parent_id) ?? [];

  return (
    <div className="flex flex-col animate-fade-in"
         style={{ height: "calc(100dvh - 56px - 3.5rem)", minHeight: 0 }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pb-3 shrink-0 gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-[#eeeef8] flex items-center gap-2">
            <GitMerge size={18} className="text-[#6366f1]" />
            關聯圖
          </h1>
          <p className="text-xs text-[#9898b0] mt-0.5 text-mono">
            {stats.nodes} nodes · {stats.edges} edges
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={autoTagRelations}
            disabled={autoBuilding}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                       bg-[#6366f1]/15 text-[#818cf8] border border-[#6366f1]/20
                       hover:bg-[#6366f1]/25 transition-smooth disabled:opacity-50"
          >
            <Zap size={11} />
            {autoBuilding ? "建立中…" : "標籤自動建立"}
          </button>
          {autoResult && (
            <span className="text-xs text-[#9898b0] bg-white/5 px-2.5 py-1 rounded-lg border border-white/8">
              {autoResult}
            </span>
          )}
          <button
            onClick={() => setShowFilter((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-smooth
              ${showFilter
                ? "bg-[#6366f1] text-white shadow-[0_0_14px_rgba(99,102,241,0.4)]"
                : "bg-white/6 border border-white/10 text-[#9898b0] hover:text-[#eeeef8]"}`}
          >
            <Filter size={11} />
            篩選
            <ChevronDown size={10} className={`transition-transform ${showFilter ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Filter panel ────────────────────────────────────────── */}
      {showFilter && (
        <div className="glass rounded-xl px-4 py-3 mb-3 shrink-0 animate-slide-in-up">
          <div className="flex items-center gap-6 flex-wrap text-xs">
            {/* Type checkboxes */}
            <div className="flex items-center gap-3">
              <span className="text-[#9898b0] font-medium text-[11px] uppercase tracking-wider">類型</span>
              {(["news","repo","note"] as ItemType[]).map((t) => {
                const colors = TYPE_COLORS[t];
                const checked = typeFilter.has(t);
                return (
                  <label
                    key={t}
                    className="flex items-center gap-1.5 cursor-pointer select-none"
                    style={{ color: checked ? colors.border : "#9898b0" }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(typeFilter);
                        e.target.checked ? next.add(t) : next.delete(t);
                        setTypeFilter(next);
                      }}
                      className="accent-[#6366f1] w-3.5 h-3.5"
                    />
                    {t === "news" ? "新聞" : t === "repo" ? "Repo" : "筆記"}
                  </label>
                );
              })}
            </div>

            <div className="w-px h-4 bg-white/10 hidden sm:block" />

            {/* Category */}
            <div className="flex items-center gap-2">
              <span className="text-[#9898b0] font-medium text-[11px] uppercase tracking-wider">分類</span>
              <select
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                className="bg-[#1a1a28] border border-white/10 rounded-lg px-2.5 py-1 text-xs
                           text-[#eeeef8] focus:outline-none focus:border-[#6366f1]/60 transition-smooth"
              >
                <option value="">全部分類</option>
                {topLevelCats.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>

            <div className="w-px h-4 bg-white/10 hidden sm:block" />

            {/* Only connected */}
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-[#eeeef8]">
              <input
                type="checkbox"
                checked={onlyConnected}
                onChange={(e) => setOnlyConnected(e.target.checked)}
                className="accent-[#6366f1] w-3.5 h-3.5"
              />
              只顯示有關聯的節點
            </label>

            {/* Legend */}
            <div className="ml-auto flex items-center gap-3 text-[#9898b0] text-[10px]">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0ea5e9] shadow-[0_0_5px_#0ea5e9]" />
                新聞
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#10b981] rotate-45 inline-block shadow-[0_0_5px_#10b981]" />
                Repo
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-[#8b5cf6] shadow-[0_0_5px_#8b5cf6]" />
                筆記
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Graph canvas ────────────────────────────────────────── */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={containerRef}
          className="graph-canvas w-full h-full rounded-2xl overflow-hidden
                     border border-white/6"
        />

        {/* Status overlay */}
        {status && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl
                          bg-[#0c0c16]/75 backdrop-blur-sm pointer-events-none">
            <div className="flex items-center gap-2.5 text-sm text-[#9898b0]
                            glass px-4 py-2.5 rounded-xl">
              <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />
              {status}
            </div>
          </div>
        )}

        {/* Connect mode banner */}
        {connectFrom && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10
                          flex items-center gap-2 bg-[#6366f1]
                          text-white text-xs font-medium px-4 py-2 rounded-full
                          shadow-[0_4px_20px_rgba(99,102,241,0.5)]
                          max-w-[90vw] animate-fade-in">
            <Link2 size={12} />
            <span className="truncate">點擊另一節點建立關聯 — {connectFrom.title.slice(0, 24)}…</span>
            <button onClick={() => setConnectFrom(null)}
                    className="ml-1 opacity-70 hover:opacity-100 flex-shrink-0">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Zoom controls */}
        <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
          {[
            { fn: zoomIn,  icon: <ZoomIn size={13} />,    tip: "放大" },
            { fn: zoomOut, icon: <ZoomOut size={13} />,   tip: "縮小" },
            { fn: fitAll,  icon: <Maximize2 size={13} />, tip: "適合視窗" },
          ].map(({ fn, icon, tip }) => (
            <button
              key={tip}
              onClick={fn}
              title={tip}
              className="w-8 h-8 rounded-lg glass flex items-center justify-center
                         text-[#9898b0] hover:text-[#eeeef8] hover:bg-white/10 transition-smooth"
            >
              {icon}
            </button>
          ))}
        </div>

        {/* Help hint */}
        <div className="absolute left-3 bottom-3 text-[10px] text-[#9898b0]/40 text-mono hidden sm:block">
          滾輪縮放 · 拖曳移動 · 點擊節點
        </div>

        {/* ── Selected node panel ─────────────────────────────── */}
        {selected && !connectFrom && (
          <div className="absolute right-3 top-3 w-72 glass rounded-xl overflow-hidden
                          animate-slide-in-right shadow-[0_8px_32px_rgba(0,0,0,0.35)]
                          max-h-[calc(100%-24px)] flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-white/6 flex-shrink-0">
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
                  className="text-[#9898b0] hover:text-[#eeeef8] shrink-0 p-0.5"
                >
                  <X size={14} />
                </button>
              </div>
              <p className="text-sm font-semibold text-[#eeeef8] line-clamp-2 leading-snug">
                {selected.title}
              </p>
              {selected.summary && (
                <p className="text-xs text-[#9898b0] mt-1.5 line-clamp-3 leading-relaxed">
                  {selected.summary}
                </p>
              )}
              <div className="flex items-center gap-3 mt-3">
                <Link
                  href={`/items/${selected.id}`}
                  className="flex items-center gap-1 text-[11px] text-[#6366f1]
                             hover:text-[#818cf8] transition-smooth"
                >
                  <ExternalLink size={10} /> 查看詳情
                </Link>
                <button
                  onClick={() => { setConnectFrom(selected); setSelected(null); }}
                  className="flex items-center gap-1 text-[11px] text-[#10b981]
                             hover:text-[#34d399] transition-smooth ml-auto"
                >
                  <Link2 size={10} /> 建立關聯
                </button>
              </div>
            </div>

            {/* Relations list */}
            <div className="p-3 overflow-y-auto flex-1">
              {selectedRels.length === 0 ? (
                <p className="text-xs text-[#9898b0]/50 text-center py-4">暫無關聯節點</p>
              ) : (
                <>
                  <p className="text-[10px] font-semibold text-[#9898b0]/70 uppercase
                                tracking-widest mb-2 text-mono">
                    關聯 ({selectedRels.length})
                  </p>
                  <div className="space-y-0.5">
                    {selectedRels.map((rel) => (
                      <div key={rel.id}
                           className="flex items-center gap-2 group px-2 py-1.5 rounded-lg
                                      hover:bg-white/5 transition-smooth">
                        <Link
                          href={`/items/${rel.id}`}
                          className="flex-1 text-[11px] text-[#eeeef8] hover:text-[#818cf8]
                                     line-clamp-1 transition-smooth"
                        >
                          {rel.title}
                        </Link>
                        <button
                          onClick={() => deleteRelation(rel.id)}
                          className="opacity-0 group-hover:opacity-100 text-[#9898b0]
                                     hover:text-red-400 transition-smooth flex-shrink-0"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Connect modal ────────────────────────────────────────── */}
      {connectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center
                        bg-black/60 backdrop-blur-sm p-4">
          <div className="glass rounded-2xl p-6 w-full max-w-sm space-y-5
                          shadow-[0_20px_60px_rgba(0,0,0,0.5)] animate-slide-in-up">
            <h2 className="text-base font-semibold text-[#eeeef8] flex items-center gap-2">
              <Link2 size={16} className="text-[#6366f1]" />
              建立節點關聯
            </h2>

            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/4 border border-white/6">
                <span className="text-[#9898b0] flex-shrink-0 w-4">A</span>
                <span className="text-[#eeeef8] truncate">{connectModal.a.title}</span>
              </div>
              <div className="flex items-center justify-center text-[#6366f1] text-base">↔</div>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/4 border border-white/6">
                <span className="text-[#9898b0] flex-shrink-0 w-4">B</span>
                <span className="text-[#eeeef8] truncate">{connectModal.b.title}</span>
              </div>
            </div>

            <div>
              <p className="text-[11px] text-[#9898b0] uppercase tracking-wider font-medium mb-2.5">
                關聯類型
              </p>
              <div className="grid grid-cols-2 gap-2">
                {RELATION_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setConnectType(t.value)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium border transition-smooth
                      ${connectType === t.value
                        ? "text-white"
                        : "border-white/10 text-[#9898b0] hover:border-white/20 hover:text-[#eeeef8]"}`}
                    style={connectType === t.value
                      ? { background: t.color + "25", borderColor: t.color + "60", color: t.color }
                      : {}}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setConnectModal(null)}
                className="px-4 py-2 rounded-xl text-xs text-[#9898b0]
                           hover:text-[#eeeef8] hover:bg-white/6 transition-smooth"
              >
                取消
              </button>
              <button
                onClick={saveRelation}
                disabled={connecting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold
                           bg-[#6366f1] text-white hover:bg-[#4f46e5] transition-smooth
                           disabled:opacity-50 shadow-[0_0_14px_rgba(99,102,241,0.4)]"
              >
                <CheckCircle2 size={13} />
                {connecting ? "儲存中…" : "建立關聯"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
