-- Migration 002: 新增子分類
-- Run in Supabase SQL Editor
-- 注意：頂層分類 slug 不變（AI scripts 仍使用這些 slug）
-- 子分類讓使用者手動細分，AI 繼續打頂層

insert into categories (name, slug, parent_id, color, icon, description)
select
  sub.name,
  sub.slug,
  (select id from categories where slug = sub.parent_slug),
  sub.color,
  sub.icon,
  sub.descr
from (values
  -- ── AI 模型 子分類 ────────────────────────────────────────
  ('前沿閉源模型',    'llm-frontier',   'ai-models',       '#6366f1', '🤖', 'GPT-4o、Claude、Gemini 等最新版本'),
  ('開源 / 開放權重', 'open-weights',   'ai-models',       '#818cf8', '🦙', 'Llama、Mistral、Qwen 等開源模型'),
  ('多模態',          'multimodal',     'ai-models',       '#a78bfa', '🎨', '視覺、音訊、影片理解模型'),
  ('語音 / TTS',      'speech-audio',   'ai-models',       '#c4b5fd', '🎙️', '語音辨識、TTS、音樂生成'),

  -- ── 工具與框架 子分類 ────────────────────────────────────
  ('RAG / 向量資料庫','rag-vector',     'tools-frameworks','#0ea5e9', '🗄️', 'Retrieval、Embedding、Vector DB'),
  ('Agent 框架',      'agent-framework','tools-frameworks','#38bdf8', '🕹️', 'LangChain、AutoGen、CrewAI 等'),
  ('Fine-tuning',     'fine-tuning',    'tools-frameworks','#7dd3fc', '🎛️', 'LoRA、PEFT、全參數微調工具'),
  ('推理加速',        'inference',      'tools-frameworks','#bae6fd', '⚡', 'vLLM、TensorRT-LLM、量化'),
  ('開發平台 / IDE',  'dev-platform',   'tools-frameworks','#e0f2fe', '💻', 'Cursor、Copilot、Claude Code'),

  -- ── 研究論文 子分類 ────────────────────────────────────────
  ('推理 / Reasoning','reasoning',      'research',        '#10b981', '🧩', 'Chain-of-thought、o1 系列研究'),
  ('對齊 / Safety',   'alignment',      'research',        '#34d399', '🛡️', 'RLHF、Constitutional AI、紅隊'),
  ('效率 / 壓縮',     'efficiency',     'research',        '#6ee7b7', '🗜️', 'Quantization、Pruning、Knowledge Distillation'),

  -- ── 產業動態 子分類 ────────────────────────────────────────
  ('融資 / 新創',     'startup',        'industry',        '#f59e0b', '💰', 'AI 新創融資、收購'),
  ('政策 / 法規',     'policy',         'industry',        '#fbbf24', '⚖️', 'AI 法規、監管政策'),
  ('大廠動態',        'big-tech',       'industry',        '#fcd34d', '🏢', 'OpenAI、Google、Meta、微軟 動態'),

  -- ── 學習資源 子分類 ────────────────────────────────────────
  ('教學 / 課程',     'course',         'learning',        '#8b5cf6', '🎓', 'Coursera、YouTube 教學'),
  ('實作 / 範例',     'tutorial',       'learning',        '#a78bfa', '🔨', 'Notebook、Code 範例、Hands-on')

) as sub(name, slug, parent_slug, color, icon, descr)
where (select id from categories where slug = sub.parent_slug) is not null
on conflict (slug) do update set description = excluded.description;
