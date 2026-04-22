"""
daily_news.py v2 — 每天抓 AI 新聞，Gemini 2.5 Flash + Google Search Tool 智慧尋找並深度分析

架構：
  1. Gemini + Google Search Tool → 搜尋今日最新 AI 新聞（一般新聞 ≤ MAX_NEWS 篇）
  2. Priority 固定來源掃描（OpenAI, HuggingFace, DeepMind, MIT）→ 不計入 MAX_NEWS
  3. 每篇文章 server-side fetch 原文 → Gemini 生成 summary_zh + content_zh + 分類 + 品質
  4. 重複判斷：URL 完全相符 skip；標題相似度 > 0.65 → duplicate_suspect=true

環境變數：GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import html
import json
import os
import re
import time
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from urllib.parse import quote, urlparse

import httpx

# ── 環境變數 ──────────────────────────────────────────────────────────────────
GEMINI_KEY   = os.environ["GEMINI_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

# Fallback chain：全免費
GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
]

MAX_NEWS      = 10    # 一般新聞上限（Priority 不計）
DUP_THRESHOLD = 0.65  # 標題相似度閾值

VALID_CATEGORIES = {
    "ai-models", "tools-frameworks", "research",
    "industry", "open-source", "learning", "notes",
}

# ── Priority 必看來源（不計入 MAX_NEWS，當日新文章才存）────────────────────────
PRIORITY_SOURCES = [
    {
        "name":     "OpenAI Blog",
        "url":      "https://openai.com/zh-Hant/news/",
        "base_url": "https://openai.com",
    },
    {
        "name":     "HuggingFace Blog",
        "url":      "https://huggingface.co/blog",
        "base_url": "https://huggingface.co",
    },
    {
        "name":     "MIT Technology Review AI",
        "url":      "https://www.technologyreview.com/topic/artificial-intelligence/",
        "base_url": "https://www.technologyreview.com",
    },
    {
        "name":     "DeepMind Blog",
        "url":      "https://deepmind.google/",
        "base_url": "https://deepmind.google",
    },
]


# ── HTML 清理 ──────────────────────────────────────────────────────────────────
class _Stripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, d: str) -> None:
        self._parts.append(d)

    def get_text(self) -> str:
        return " ".join(" ".join(self._parts).split())


def strip_html(text: str) -> str:
    if not text:
        return ""
    try:
        s = _Stripper()
        s.feed(html.unescape(text))
        return s.get_text()
    except Exception:
        return re.sub(r"<[^>]+>", " ", html.unescape(text or "")).strip()


# ── HTTP fetch ─────────────────────────────────────────────────────────────────
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/124 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}


def fetch_text(url: str, max_chars: int = 8000) -> tuple[str, bool]:
    """Fetch URL，回傳 (純文字, 是否成功)。"""
    try:
        resp = httpx.get(
            url, headers=_HEADERS,
            timeout=15, follow_redirects=True,
        )
        if resp.status_code == 200:
            return strip_html(resp.text)[:max_chars], True
    except Exception as e:
        print(f"    fetch_text 失敗 ({url[:60]}): {e}")
    return "", False


# ── Supabase ───────────────────────────────────────────────────────────────────
def supabase_req(method: str, path: str, body=None):
    headers = {
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "return=representation",
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


# ── 重複判斷 ───────────────────────────────────────────────────────────────────
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
    """
    # 1. URL 完全相符
    if url:
        rows = supabase_req(
            "GET", f"/items?url=eq.{quote(url, safe='')}&select=id&limit=1"
        )
        if rows:
            return True, False, None

    # 2. 標題相似度
    recent = supabase_req(
        "GET", "/items?select=id,title&order=created_at.desc&limit=300"
    ) or []
    for item in recent:
        if _word_overlap(title, item["title"]) >= DUP_THRESHOLD:
            return False, True, item["id"]

    return False, False, None


# ── Gemini 呼叫（三模型 fallback，全免費）────────────────────────────────────
def _extract_text(resp_json: dict) -> str:
    """安全地從 Gemini response 取出文字，避免 KeyError。"""
    try:
        return resp_json["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError, TypeError) as e:
        raise ValueError(f"Gemini response 結構異常: {e} | {str(resp_json)[:200]}")


def call_gemini(
    prompt: str,
    use_search: bool = False,
    max_tokens: int = 2048,
) -> str:
    """
    依序試 GEMINI_MODELS（fallback chain）。
    - 503/429 → 同 model retry（最多 3 次，10/30/60s backoff）
    - 404 → model 不存在，換下一個
    - use_search=True 時只用第一個支援 Search 的 model（2.x+）
    """
    payload: dict = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.2},
    }
    if use_search:
        payload["tools"] = [{"google_search": {}}]

    retry_delays = [10, 30, 60]
    last_error = "（未嘗試）"

    for model in GEMINI_MODELS:
        # gemini-1.5 不支援 google_search grounding，跳過
        if use_search and model.startswith("gemini-1.5"):
            continue

        url = f"{GEMINI_BASE}/{model}:generateContent?key={GEMINI_KEY}"

        for attempt in range(3):
            resp = httpx.post(url, json=payload, timeout=120)

            # 過載 / 限流 → 重試
            if resp.status_code in {429, 503}:
                if attempt < 2:
                    wait = retry_delays[attempt]
                    print(f"  Gemini {model} {resp.status_code}，等待 {wait}s...")
                    time.sleep(wait)
                    continue
                last_error = f"{model} 過載超過重試次數"
                break

            # model 不存在 → 換下一個
            if resp.status_code == 404:
                last_error = f"{model} 404 not found"
                print(f"  Gemini {model} 不存在，換下一個")
                break

            # 其他非 2xx
            if not resp.is_success:
                body = resp.text[:300]
                raise RuntimeError(f"Gemini {resp.status_code} ({model}): {body}")

            # ✅ 成功
            return _extract_text(resp.json())

    raise RuntimeError(f"所有 Gemini 模型均失敗，最後錯誤：{last_error}")


def parse_json_from_text(raw: str) -> list | dict:
    """從 Gemini 回應萃取 JSON（容錯解析）。"""
    raw = raw.strip()
    # 移除 markdown code fence
    raw = re.sub(r"^```json\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"^```\s*", "", raw)
    raw = re.sub(r"```\s*$", "", raw).strip()
    # 有時 Gemini 會在 JSON 前後加說明文字，嘗試找 JSON 區塊
    if not raw.startswith(("[", "{")):
        m = re.search(r"(\[[\s\S]*\]|\{[\s\S]*\})", raw)
        if m:
            raw = m.group(1)
    return json.loads(raw)


# ── Phase 1：Gemini + Google Search 搜尋今日一般新聞 ──────────────────────────
_DISCOVER_PROMPT = """\
Today is {today}.

你是 AI 新聞策展人。請用 Google Search 搜尋 **今天（{today}）或過去 24 小時內**的最新 AI 新聞，重點關注：
1. https://www.technice.com.tw/category/issues/ai/ （台灣科技新聞）
2. https://technews.tw/category/ai/ （TechNews 科技新報）
3. 其他重大 AI 新聞：模型發布、重要研究、產業動態

重要規則：
- **只回傳今天（{today}）或過去 24 小時發布的文章**
- 如果真的沒有新文章，回傳空陣列 []
- 不要回傳超過 {limit} 篇
- 優先選擇有實質內容的文章（非廣告、非轉載）

嚴格 JSON 輸出（不要 markdown code fence，不要任何其他文字）：
[
  {{
    "title": "文章標題（保留原文語言）",
    "url": "完整文章 URL",
    "source": "媒體名稱或網域"
  }}
]
"""


def discover_news_via_search(today: str) -> list[dict]:
    """Phase 1：用 Gemini Google Search 找今日一般新聞。"""
    print("  [Google Search] 搜尋今日 AI 新聞...")
    try:
        raw = call_gemini(
            _DISCOVER_PROMPT.format(today=today, limit=MAX_NEWS),
            use_search=True,
            max_tokens=1500,
        )
        articles = parse_json_from_text(raw)
        if isinstance(articles, list):
            valid = [a for a in articles if a.get("url") and a.get("title")]
            print(f"    找到 {len(valid)} 篇候選")
            return valid[:MAX_NEWS]
    except Exception as e:
        print(f"    Google Search 搜尋失敗: {e}")
    return []


# ── Phase 2：Priority 來源掃描 ─────────────────────────────────────────────────
_PRIORITY_SCAN_PROMPT = """\
Today is {today}.

我抓到了 {source_name}（{url}）的首頁內容。請找出所有看起來是 **今天（{today}）或過去 48 小時內** 發布的文章連結。

頁面內容（前 6000 字）：
{content}

嚴格 JSON 輸出（不要 markdown code fence，不要任何其他文字）：
[
  {{
    "title": "文章標題",
    "url": "完整 URL（若是相對路徑請補上 {base_url}）"
  }}
]

若沒有最新文章，回傳 []。
"""


def scan_priority_source(source: dict, today: str) -> list[dict]:
    """Phase 2：Fetch Priority 來源首頁，找今日文章。"""
    print(f"  [Priority] 掃描 {source['name']}...")
    content, ok = fetch_text(source["url"], max_chars=6000)
    if not ok or not content:
        print(f"    ✗ 無法取得頁面")
        return []

    try:
        raw = call_gemini(
            _PRIORITY_SCAN_PROMPT.format(
                today=today,
                source_name=source["name"],
                url=source["url"],
                content=content,
                base_url=source["base_url"],
            ),
            max_tokens=800,
        )
        articles = parse_json_from_text(raw)
        if isinstance(articles, list):
            valid = [
                {**a, "source": source["name"], "is_priority": True}
                for a in articles
                if a.get("url") and a.get("title")
            ]
            print(f"    找到 {len(valid)} 篇今日文章")
            return valid
    except Exception as e:
        print(f"    ✗ 掃描失敗: {e}")
    return []


# ── Phase 3：深度分析單篇文章 ──────────────────────────────────────────────────
_ANALYZE_PROMPT = """\
你是 AI 知識管理員，請分析以下文章並生成繁體中文知識卡片。

文章標題: {title}
來源 URL: {url}
來源媒體: {source}

--- 文章內容 ---
{content}
--- END ---

嚴格 JSON 輸出（不要 markdown code fence，不要任何其他文字）：
{{
  "title":      <string, 保留原文標題。若原文非中文，可加繁中副標題，格式: "原標題 — 繁中副標">,
  "summary_zh": <string, 繁體中文摘要 40–120 字，純文字不含 HTML，說明報導核心內容>,
  "content_zh": <string, 繁體中文重點筆記，Markdown 格式，150–600 字。結構：## 核心要點、## 技術細節（若有）、## 影響分析>,
  "category":   <string, 必須是: ai-models | tools-frameworks | research | industry | open-source | learning | notes>,
  "quality":    <integer, 1–5（5=重大突破必讀，4=很重要，3=普通，2=偏弱，1=差）>,
  "tags":       <array of 2–4 lowercase English strings>
}}
"""


def analyze_article(article: dict) -> dict | None:
    """Fetch 原文 + Gemini 深度分析，生成結構化知識卡片。"""
    url     = article.get("url", "")
    title   = article.get("title", "")
    source  = article.get("source", urlparse(url).netloc if url else "")

    # Fetch 原文
    content, ok = fetch_text(url, max_chars=7000)
    if not ok or len(content) < 80:
        # Fallback：用 title + source 讓 Gemini 憑知識推測
        content = (
            f"標題：{title}\n"
            f"來源：{source}\n"
            f"（無法取得完整頁面內容，請根據標題和你對此來源的知識進行分析）"
        )

    try:
        raw = call_gemini(
            _ANALYZE_PROMPT.format(
                title=title,
                url=url,
                source=source,
                content=content,
            ),
            max_tokens=1200,
        )
        result = parse_json_from_text(raw)
        if isinstance(result, dict):
            return result
    except Exception as e:
        print(f"    ✗ 分析失敗: {e}")
    return None


def validate_analysis(out: dict) -> str | None:
    """回傳錯誤訊息，None 代表合法。"""
    if not isinstance(out.get("title"), str) or not out["title"]:
        return "title 缺失"
    summary = out.get("summary_zh", "")
    if not isinstance(summary, str) or len(summary) < 10:
        return "summary_zh 過短"
    if re.search(r"<[^>]+>", summary):
        return "summary_zh 含 HTML tags"
    if out.get("category") not in VALID_CATEGORIES:
        return f"category 不合法: {out.get('category')}"
    quality = out.get("quality")
    if not isinstance(quality, int) or not (1 <= quality <= 5):
        return "quality 不在 1–5"
    return None


# ── 主流程 ─────────────────────────────────────────────────────────────────────
def main() -> None:
    today = str(date.today())
    print(f"[{today}] 開始抓取 AI 新聞 v2...")

    cat_ids = get_category_ids()
    print(f"  分類 IDs: {list(cat_ids.keys())}")
    if not cat_ids:
        print("  ⚠ 警告：分類表為空！請先在 Supabase 執行 schema.sql 的 seed。")

    # ── Step 1：收集候選文章 ──────────────────────────────────────────────────
    url_to_article: dict[str, dict] = {}

    # 1a. Google Search 搜尋一般新聞
    news_articles = discover_news_via_search(today)
    for a in news_articles:
        url = a.get("url", "")
        if url and url not in url_to_article:
            url_to_article[url] = {**a, "is_priority": False}

    # 1b. Priority 來源掃描
    priority_urls: set[str] = set()
    for source in PRIORITY_SOURCES:
        found = scan_priority_source(source, today)
        for a in found:
            url = a.get("url", "")
            if url:
                url_to_article[url] = a   # Priority 可覆蓋（優先）
                priority_urls.add(url)
        time.sleep(2)  # Rate limit

    print(f"\n  候選總計 {len(url_to_article)} 篇"
          f"（{len(priority_urls)} Priority + {len(url_to_article) - len(priority_urls)} 一般）")

    # ── Step 2：URL 重複預篩 ──────────────────────────────────────────────────
    to_process_priority: list[dict] = []
    to_process_news:     list[dict] = []

    for url, article in url_to_article.items():
        skip, _, _ = check_duplicate(url, article.get("title", ""))
        if skip:
            print(f"  skip (已存在): {article.get('title', url)[:55]}")
            continue
        if url in priority_urls:
            to_process_priority.append(article)
        else:
            to_process_news.append(article)

    # 一般新聞限制數量
    to_process_news = to_process_news[:MAX_NEWS]

    final_list = to_process_priority + to_process_news
    print(f"  待深度分析: {len(final_list)} 篇"
          f"（{len(to_process_priority)} Priority + {len(to_process_news)} 一般）")

    if not final_list:
        print("  沒有新文章，結束。")
        return

    # ── Step 3：深度分析 + 存入 DB ───────────────────────────────────────────
    inserted = 0
    for article in final_list:
        url    = article.get("url", "")
        title  = article.get("title", "")
        source = article.get("source", urlparse(url).netloc if url else "Daily AI News")

        print(f"\n  ▶ {title[:65]}...")

        # 深度分析
        analysis = analyze_article(article)
        if not analysis:
            print("    ✗ 跳過（分析失敗）")
            continue

        err = validate_analysis(analysis)
        if err:
            print(f"    ✗ 跳過（{err}）")
            continue

        # 標題相似度重複檢查
        _, is_suspect, dup_of = check_duplicate(url, analysis["title"])

        # 分類 ID
        cat_slug = analysis.get("category", "")
        cat_id   = cat_ids.get(cat_slug)
        if not cat_id:
            print(f"    ⚠ category '{cat_slug}' 找不到對應 ID，category_id 將為 null")

        item = {
            "type":             "news",
            "title":            analysis["title"],
            "url":              url or None,
            "summary":          analysis["summary_zh"],
            "content":          analysis.get("content_zh") or None,
            "category_id":      cat_id,
            "source":           source,
            "quality":          analysis["quality"],
            "is_pinned":        False,
            "duplicate_suspect": is_suspect,
            "duplicate_of":     dup_of,
            "metadata": {
                "tags":         analysis.get("tags", []),
                "fetched_at":   datetime.now(timezone.utc).isoformat(),
                "ai_processed": True,
                "is_priority":  article.get("is_priority", False),
            },
        }

        try:
            supabase_req("POST", "/items", item)
            inserted += 1
            priority_flag = " [⭐Priority]" if article.get("is_priority") else ""
            dup_flag      = " ⚠ [重複嫌疑]" if is_suspect else ""
            print(
                f"    ✓ Q{analysis['quality']} "
                f"[{cat_slug}]{priority_flag}{dup_flag}"
            )
        except Exception as e:
            print(f"    ✗ 插入失敗: {e}")

        time.sleep(1)  # 避免 Gemini rate limit

    print(f"\n完成！插入 {inserted} 篇（含 Priority 來源）")


if __name__ == "__main__":
    main()
