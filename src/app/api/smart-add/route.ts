/**
 * POST /api/smart-add
 *
 * 輸入（任一）：
 *   { url: string }           → server-side fetch 頁面內容後送 Gemini
 *   { text: string }          → 直接送 Gemini（web clipper 貼上的 HTML / Markdown / 純文字）
 *   { url, text: string }     → 兩者都有，text 優先（已有完整內容）
 *
 * Gemini 輸出契約（嚴格 JSON，不合規回傳 400）：
 *   {
 *     "title":       string,          // 原文標題或 AI 生成
 *     "summary_zh":  string,          // 繁體中文摘要 20–150 字，純文字
 *     "content_zh":  string,          // 繁體中文重點筆記，支援 Markdown，200–800 字
 *     "category":    string,          // ai-models | tools-frameworks | research | industry | open-source | learning | notes
 *     "quality":     number,          // 1–5
 *     "tags":        string[],        // 2–5 lowercase English tags
 *     "source":      string           // 來源網域或名稱
 *   }
 */

import { NextRequest, NextResponse } from "next/server";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const VALID_CATEGORIES = new Set([
  "ai-models", "tools-frameworks", "research",
  "industry", "open-source", "learning", "notes",
]);

// ── HTML 清理（server-side，不依賴 DOM）──────────────────────
function stripHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── 擷取頁面純文字（server fetch）───────────────────────────
async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return stripHtml(html).slice(0, 6000);
}

// ── Gemini 呼叫 ──────────────────────────────────────────────
const SCHEMA_DOC = `
嚴格 JSON 輸出（不要 markdown code fence，不要任何其他文字）：
{
  "title":      <string, 文章原始標題（若無則由你生成）>,
  "summary_zh": <string, 繁體中文摘要 20–150 字，純文字不含 HTML>,
  "content_zh": <string, 繁體中文重點筆記，Markdown 格式，200–800 字。包含：核心論點、技術要點、值得記錄的細節>,
  "category":   <string, 必須是: ai-models | tools-frameworks | research | industry | open-source | learning | notes>,
  "quality":    <integer, 1–5（5=必讀必收藏）>,
  "tags":       <array of 2–5 lowercase English strings>,
  "source":     <string, 來源網域或媒體名稱>
}
`;

async function callGemini(
  content: string,
  url?: string,
): Promise<Record<string, unknown>> {
  const urlHint = url ? `\n原始 URL：${url}` : "";
  const prompt = `你是 AI 知識管理員，請分析以下文章內容並輸出結構化知識卡片。${urlHint}

--- 文章內容 ---
${content.slice(0, 5500)}
--- END ---

${SCHEMA_DOC}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 1600, temperature: 0.2 },
  });

  // 503 / 429 自動重試（最多 3 次，指數退避）
  const RETRYABLE = new Set([429, 503, 502]);
  const DELAYS    = [2000, 6000, 15000]; // ms

  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(90000),
    });

    if (resp.ok) {
      const data = await resp.json();
      let raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      raw = raw.trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      return JSON.parse(raw) as Record<string, unknown>;
    }

    const errText = await resp.text();

    // 可重試的錯誤
    if (RETRYABLE.has(resp.status) && attempt < 2) {
      await new Promise((r) => setTimeout(r, DELAYS[attempt]));
      continue;
    }

    throw new Error(`Gemini ${resp.status}: ${errText.slice(0, 300)}`);
  }

  throw new Error("Gemini 重試三次均失敗");
}

// ── 驗證 Gemini 輸出 ─────────────────────────────────────────
function validateOutput(out: Record<string, unknown>): string | null {
  if (!out.title || typeof out.title !== "string") return "title 缺失";
  if (!out.summary_zh || typeof out.summary_zh !== "string" || (out.summary_zh as string).length < 10)
    return "summary_zh 過短";
  if (/<[^>]+>/.test(out.summary_zh as string)) return "summary_zh 含 HTML tags";
  if (!VALID_CATEGORIES.has(out.category as string)) return `category 不合法: ${out.category}`;
  if (typeof out.quality !== "number" || out.quality < 1 || out.quality > 5) return "quality 不在 1–5";
  if (!Array.isArray(out.tags) || out.tags.length < 1) return "tags 為空";
  return null;
}

// ── Route Handler ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!GEMINI_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY 未設定" }, { status: 500 });
  }

  let body: { url?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "無效的 JSON body" }, { status: 400 });
  }

  const { url, text } = body;
  if (!url && !text) {
    return NextResponse.json({ error: "請提供 url 或 text" }, { status: 400 });
  }

  // 決定傳給 Gemini 的內容
  let content = "";
  let fetchError: string | null = null;

  if (text) {
    content = stripHtml(text).slice(0, 6000);
  } else if (url) {
    try {
      content = await fetchPageText(url);
    } catch (e) {
      fetchError = String(e);
      // fallback: 只傳 URL 讓 Gemini 憑標題推測
      content = `無法擷取頁面內容（${fetchError}）。請根據 URL 推測：${url}`;
    }
  }

  // 呼叫 Gemini
  let geminiOut: Record<string, unknown>;
  try {
    geminiOut = await callGemini(content, url);
  } catch (e) {
    return NextResponse.json(
      { error: `Gemini 分析失敗：${String(e)}` },
      { status: 502 },
    );
  }

  // 驗證
  const validErr = validateOutput(geminiOut);
  if (validErr) {
    return NextResponse.json(
      { error: `AI 輸出格式不合規：${validErr}`, raw: geminiOut },
      { status: 422 },
    );
  }

  return NextResponse.json({
    title:      geminiOut.title,
    summary:    geminiOut.summary_zh,
    content:    geminiOut.content_zh ?? null,
    category:   geminiOut.category,
    quality:    geminiOut.quality,
    tags:       geminiOut.tags,
    source:     geminiOut.source ?? (url ? new URL(url).hostname : ""),
    url:        url ?? null,
    fetch_note: fetchError ?? null,
  });
}
