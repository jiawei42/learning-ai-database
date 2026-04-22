"""
daily_news.py — 每天抓 AI 新聞，Gemini 2.5 Flash 智慧分析後存入 Supabase。

資料來源：
  - HN Algolia API（主要，乾淨 JSON，無 HTML）
  - TLDR AI RSS（補充）

AI 輸出契約（嚴格 JSON schema，不合規自動丟棄）：
  {
    "articles": [
      {
        "index":       <int>   原始文章 index，
        "summary_zh":  <str>   繁體中文摘要 10–80字，純文字不含 HTML tags，
        "category":    <str>   ai-models | tools-frameworks | research | industry | open-source | learning,
        "quality":     <int>   1–5（5=必讀），
        "tags":        <str[]> 2–4 個英文小寫標籤，如 ["llm","rag"]
      }
    ]
  }

重複判斷策略：
  1. URL 完全相符 → 直接跳過
  2. 標題詞組相似度 > 0.65 → 標記 duplicate_suspect=true，duplicate_of=相似文章 id
"""

import html
import json
import os
import re
import time
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from urllib.parse import quote

import httpx

# ── 環境變數 ─────────────────────────────────────────────────
GEMINI_KEY   = os.environ["GEMINI_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

GEMINI_URL    = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
MAX_ARTICLES  = 10   # 每天最多存幾篇
BATCH_LIMIT   = 20   # 送給 Gemini 的候選上限
DUP_THRESHOLD = 0.65 # 標題相似度閾值

VALID_CATEGORIES = {
    "ai-models", "tools-frameworks", "research",
    "industry", "open-source", "learning",
}

# ── HTML 清理 ────────────────────────────────────────────────
class _Stripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, d: str) -> None:
        self._parts.append(d)

    def get_text(self) -> str:
        return " ".join(" ".join(self._parts).split())


def strip_html(text: str) -> str:
    """移除 HTML tags，解碼 HTML entities，合併多餘空白。"""
    if not text:
        return ""
    try:
        s = _Stripper()
        s.feed(html.unescape(text))
        return s.get_text()
    except Exception:
        return re.sub(r"<[^>]+>", " ", html.unescape(text or "")).strip()


# ── Supabase ─────────────────────────────────────────────────
def supabase_req(method: str, path: str, body=None):
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    resp = httpx.request(
        method, f"{SUPABASE_URL}/rest/v1{path}",
        headers=headers, json=body, timeout=30,
    )
    resp.raise_for_status()
    return resp.json() if resp.content else None


def get_category_ids() -> dict[str, str]:
    rows = supabase_req("GET", "/categories?select=id,slug") or []
    return {r["slug"]: r["id"] for r in rows}


# ── 重複判斷 ─────────────────────────────────────────────────
def _word_overlap(a: str, b: str) -> float:
    wa = set(re.findall(r"\w+", a.lower()))
    wb = set(re.findall(r"\w+", b.lower()))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def check_duplicate(url: str, title: str) -> tuple[bool, bool, str | None]:
    """
    回傳 (skip_entirely, is_suspect, duplicate_of_id)
    - skip_entirely=True  → URL 完全相符，不存
    - is_suspect=True     → 標題相似，標記 duplicate_suspect
    - duplicate_of_id     → 相似文章的 ID（或 None）
    """
    # 1. URL 完全相符
    rows = supabase_req(
        "GET", f"/items?url=eq.{quote(url, safe='')}&select=id&limit=1"
    )
    if rows:
        return True, False, None

    # 2. 標題相似度（抓最近 200 筆）
    recent = supabase_req(
        "GET", "/items?select=id,title&order=created_at.desc&limit=200"
    ) or []
    for item in recent:
        if _word_overlap(title, item["title"]) >= DUP_THRESHOLD:
            return False, True, item["id"]

    return False, False, None


# ── 資料來源 ─────────────────────────────────────────────────
def fetch_hn_algolia(query: str, hours_back: int = 26, limit: int = 25) -> list[dict]:
    """HN Algolia API — 乾淨 JSON，無 HTML，直接拿到原始文章 URL。"""
    since = int(time.time()) - hours_back * 3600
    try:
        resp = httpx.get(
            "https://hn.algolia.com/api/v1/search",
            params={
                "query": query,
                "tags": "story",
                "hitsPerPage": limit,
                "numericFilters": f"created_at_i>{since}",
            },
            timeout=20,
        )
        resp.raise_for_status()
        items = []
        for hit in resp.json().get("hits", []):
            title = hit.get("title", "").strip()
            url   = (hit.get("url") or
                     f"https://news.ycombinator.com/item?id={hit['objectID']}")
            points = hit.get("points", 0)
            if title and url:
                items.append({"title": title, "url": url, "snippet": "", "points": points})
        return items
    except Exception as e:
        print(f"  HN Algolia 錯誤 ({query}): {e}")
        return []


def fetch_tldr_rss(limit: int = 15) -> list[dict]:
    """TLDR AI RSS — 用 feedparser，strip HTML snippet。"""
    try:
        import feedparser
        feed = feedparser.parse("https://tldr.tech/api/rss/ai")
        items = []
        for entry in feed.entries[:limit]:
            title   = strip_html(getattr(entry, "title", "")).strip()
            link    = getattr(entry, "link", "").strip()
            summary = strip_html(getattr(entry, "summary", ""))[:400]
            if title and link:
                items.append({"title": title, "url": link, "snippet": summary, "points": 0})
        return items
    except Exception as e:
        print(f"  TLDR RSS 錯誤: {e}")
        return []


# ── Gemini ───────────────────────────────────────────────────
_SCHEMA_DOC = """
輸出格式：嚴格 JSON，不要 markdown code fence，不要任何其他文字。

{
  "articles": [
    {
      "index":      <int>,
      "summary_zh": <string, 繁體中文摘要 10–80 字，純文字，不含任何 HTML tag>,
      "category":   <string, 必須是: ai-models | tools-frameworks | research | industry | open-source | learning>,
      "quality":    <int, 1–5>,
      "tags":       <array of 2–4 lowercase strings>
    }
  ]
}
"""


def call_gemini(prompt: str, retries: int = 3) -> str:
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 1200, "temperature": 0.2},
    }
    for attempt in range(retries):
        try:
            resp = httpx.post(
                f"{GEMINI_URL}?key={GEMINI_KEY}",
                json=payload, timeout=90,
            )
            if resp.status_code == 429:
                wait = 60 * (attempt + 1)
                print(f"  Gemini 429，等待 {wait}s... ({attempt+1}/{retries})")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        except httpx.HTTPStatusError as e:
            if attempt == retries - 1:
                raise
            print(f"  Gemini HTTP {e.response.status_code}，重試...")
            time.sleep(20)
    raise RuntimeError("Gemini 超過重試次數")


def validate_article(article: dict, total: int) -> str | None:
    """回傳錯誤訊息，None 代表合法。"""
    idx = article.get("index")
    if not isinstance(idx, int) or idx < 0 or idx >= total:
        return f"index 超出範圍: {idx}"
    summary = article.get("summary_zh", "")
    if not isinstance(summary, str) or len(summary) < 5:
        return "summary_zh 過短或缺失"
    if re.search(r"<[^>]+>", summary):
        return "summary_zh 含 HTML tags"
    if article.get("category") not in VALID_CATEGORIES:
        return f"category 不合法: {article.get('category')}"
    if not isinstance(article.get("quality"), int) or not (1 <= article["quality"] <= 5):
        return "quality 不在 1–5 範圍"
    tags = article.get("tags", [])
    if not isinstance(tags, list) or not (1 <= len(tags) <= 6):
        return "tags 數量不合法"
    return None


def analyze_articles(candidates: list[dict], cat_ids: dict) -> list[dict]:
    """Gemini 分析候選文章，回傳可直接插入 DB 的 list。"""
    batch = candidates[:BATCH_LIMIT]
    candidate_json = json.dumps(
        [{"index": i, "title": c["title"], "snippet": c["snippet"][:100]}
         for i, c in enumerate(batch)],
        ensure_ascii=False,
    )
    prompt = f"""你是 AI 知識管理員。以下是今天的 AI 相關文章（JSON）：
{candidate_json}

任務：
1. 選出最值得閱讀的 {MAX_ARTICLES} 篇（新穎、有技術深度、AI 領域相關）
2. 對每篇填寫分析結果

{_SCHEMA_DOC}
"""
    raw = call_gemini(prompt)
    raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Gemini 回傳無效 JSON: {e}\n原始：{raw[:300]}")

    articles_raw = data.get("articles", [])
    result = []
    for art in articles_raw:
        err = validate_article(art, len(batch))
        if err:
            print(f"  ⚠ 丟棄文章（{err}）: index={art.get('index')}")
            continue

        orig = batch[art["index"]]
        result.append({
            "title":       orig["title"],
            "url":         orig["url"],
            "summary_zh":  art["summary_zh"],
            "category":    art["category"],
            "quality":     art["quality"],
            "tags":        art["tags"],
            "cat_id":      cat_ids.get(art["category"]),
        })

    return result[:MAX_ARTICLES]


# ── 主流程 ───────────────────────────────────────────────────
def main() -> None:
    print(f"[{date.today()}] 開始抓取 AI 新聞...")
    cat_ids = get_category_ids()
    print(f"  分類: {list(cat_ids.keys())}")

    # 1. 收集候選
    candidates: list[dict] = []

    hn_queries = ["AI LLM large language model", "machine learning deep learning", "GPT Claude Gemini"]
    for q in hn_queries:
        candidates.extend(fetch_hn_algolia(q, limit=20))

    candidates.extend(fetch_tldr_rss(limit=15))

    # 依 HN points 排序（熱門在前），去重 URL
    seen_urls: set[str] = set()
    unique: list[dict] = []
    for c in sorted(candidates, key=lambda x: x.get("points", 0), reverse=True):
        if c["url"] not in seen_urls:
            seen_urls.add(c["url"])
            unique.append(c)

    print(f"  候選總計 {len(unique)} 篇（去重後）")

    # 2. 重複預篩（URL 精確比對）
    new_candidates: list[dict] = []
    for c in unique:
        skip, _, _ = check_duplicate(c["url"], c["title"])
        if not skip:
            new_candidates.append(c)

    print(f"  排除已存在 URL，剩 {len(new_candidates)} 篇")

    if len(new_candidates) < 3:
        print("  新文章不足，跳過")
        return

    # 3. Gemini 分析
    try:
        analyzed = analyze_articles(new_candidates, cat_ids)
    except Exception as e:
        print(f"\n  Gemini 失敗（{e}），fallback：直接存前 {MAX_ARTICLES} 篇原始標題")
        analyzed = [
            {
                "title":      c["title"],
                "url":        c["url"],
                "summary_zh": c["snippet"][:200] or "",
                "category":   None,
                "quality":    3,
                "tags":       [],
                "cat_id":     None,
            }
            for c in new_candidates[:MAX_ARTICLES]
        ]

    # 4. 重複嫌疑標記 + 插入
    inserted = 0
    for art in analyzed:
        _, is_suspect, dup_of = check_duplicate(art["url"], art["title"])

        item = {
            "type":             "news",
            "title":            art["title"],
            "url":              art["url"],
            "summary":          art["summary_zh"] or None,
            "content":          None,
            "category_id":      art["cat_id"],
            "source":           "Daily AI News",
            "quality":          art["quality"],
            "is_pinned":        False,
            "duplicate_suspect": is_suspect,
            "duplicate_of":     dup_of,
            "metadata": {
                "tags":         art["tags"],
                "fetched_at":   datetime.now(timezone.utc).isoformat(),
                "ai_processed": True,
            },
        }

        try:
            supabase_req("POST", "/items", item)
            inserted += 1
            flag = " ⚠ [重複嫌疑]" if is_suspect else ""
            print(f"  ✓ Q{art['quality']} [{art['category'] or '-'}] {art['title'][:55]}{flag}")
        except Exception as e:
            print(f"  ✗ 插入失敗: {e}")

    print(f"\n完成！插入 {inserted} 篇（含重複嫌疑標記）")


if __name__ == "__main__":
    main()
