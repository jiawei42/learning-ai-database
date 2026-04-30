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

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── 環境變數 ──────────────────────────────────────────────────────────────────
GEMINI_KEY   = os.environ["GEMINI_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

# Fallback chain：全免費
GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash-latest",
]

MAX_NEWS      = 6     # 一般新聞上限（Priority 不計）；降低以節省 Gemini 配額
BATCH_SIZE    = 3     # 每次 Gemini 呼叫分析的文章數
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


def fetch_text(url: str, max_chars: int = 8000) -> tuple[str, bool, str]:
    """Fetch URL，回傳 (純文字, 是否成功, 最終 URL)。follow_redirects 自動解析代理 URL。"""
    try:
        resp = httpx.get(
            url, headers=_HEADERS,
            timeout=15, follow_redirects=True,
        )
        final_url = str(resp.url)
        if resp.status_code == 200:
            return strip_html(resp.text)[:max_chars], True, final_url
    except Exception as e:
        print(f"    fetch_text 失敗 ({url[:60]}): {e}")
    return "", False, url


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


# ── Gemini Rate Limiter（免費版 ~10 RPM）────────────────────────────────────────
_gemini_last_call: float = 0.0
_GEMINI_MIN_INTERVAL = 12.0  # 秒（5 RPM，安全緩衝空間 5 RPM）


def _gemini_wait() -> None:
    """每次 Gemini call 前呼叫，確保不超過 RPM 限制。"""
    global _gemini_last_call
    elapsed = time.time() - _gemini_last_call
    if elapsed < _GEMINI_MIN_INTERVAL:
        time.sleep(_GEMINI_MIN_INTERVAL - elapsed)
    _gemini_last_call = time.time()


# ── Gemini 呼叫（三模型 fallback，全免費）────────────────────────────────────
def _extract_text(resp_json: dict) -> str:
    """安全地從 Gemini response 取出文字，避免 KeyError。"""
    candidates = resp_json.get("candidates", [])
    if not candidates:
        raise ValueError(f"Gemini response 無 candidates | {str(resp_json)[:200]}")
    candidate = candidates[0]
    finish_reason = candidate.get("finishReason", "")
    content = candidate.get("content", {})
    parts = content.get("parts", [])
    if not parts:
        raise ValueError(
            f"Gemini response 無 parts (finishReason={finish_reason}) | {str(resp_json)[:200]}"
        )
    return parts[0].get("text", "").strip()


def _safe_json_loads(raw: str) -> list | dict:
    """解析 JSON，自動修復字串內未跳脫的控制字元（Gemini 常見問題）。"""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    # Character-by-character fix: escape ALL control chars inside strings
    out: list[str] = []
    in_str = False
    esc = False
    for ch in raw:
        if esc:
            out.append(ch)
            esc = False
        elif ch == "\\" and in_str:
            out.append(ch)
            esc = True
        elif ch == '"':
            out.append(ch)
            in_str = not in_str
        elif in_str and ord(ch) < 0x20:
            out.append(f"\\u{ord(ch):04x}")
        else:
            out.append(ch)
    try:
        return json.loads("".join(out))
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 解析失敗（修復後仍無效）: {e}\n原始: {raw[:300]}")


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

    last_error = "（未嘗試）"

    for model in GEMINI_MODELS:
        # gemini-1.5 不支援 google_search grounding，跳過
        if use_search and model.startswith("gemini-1.5"):
            continue

        url = f"{GEMINI_BASE}/{model}:generateContent?key={GEMINI_KEY}"
        _gemini_wait()
        resp = httpx.post(url, json=payload, timeout=120)

        # 限流／過載 → 直接換下一個 model（不重試同 model，各 model 配額獨立）
        if resp.status_code in {429, 503, 529}:
            last_error = f"{model} 限流 ({resp.status_code})"
            print(f"  ⚠ {model} {resp.status_code}，換下一個 model")
            time.sleep(3)
            continue

        # model 不存在 → 換下一個
        if resp.status_code == 404:
            last_error = f"{model} 404 not found"
            print(f"  ⚠ {model} 不存在，換下一個 model")
            continue

        # 其他非 2xx
        if not resp.is_success:
            body = resp.text[:300]
            raise RuntimeError(f"Gemini {resp.status_code} ({model}): {body}")

        # ✅ 成功
        try:
            return _extract_text(resp.json())
        except ValueError as ve:
            last_error = str(ve)
            print(f"  ⚠ {model} 回應結構異常，換下一個 model")
            continue

    raise RuntimeError(f"所有 Gemini 模型均失敗，最後錯誤：{last_error}")


def parse_json_from_text(raw: str) -> list | dict:
    """從 Gemini 回應萃取 JSON（容錯解析 + 控制字元修復 + 截斷恢復）。"""
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
    try:
        return _safe_json_loads(raw)
    except ValueError:
        pass
    # 最後防線：string-aware bracket-counting，逐一提取完整 {...} 物件
    # 適用於截斷的 JSON array，且正確跳過字串內的 { } 字元
    extracted: list[dict] = []
    depth = 0
    start = -1
    in_str = False
    esc = False
    for i, ch in enumerate(raw):
        if esc:
            esc = False
            continue
        if ch == "\\" and in_str:
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                try:
                    obj = _safe_json_loads(raw[start : i + 1])
                    if isinstance(obj, dict):
                        extracted.append(obj)
                except (ValueError, Exception):
                    pass
                start = -1
    if extracted:
        print(f"  ⚠ JSON 截斷，regex 恢復 {len(extracted)} 個物件")
        return extracted
    raise ValueError(f"JSON 解析完全失敗: {raw[:200]}")


# ── Phase 1：Gemini + Google Search 搜尋今日一般新聞 ──────────────────────────
_DISCOVER_PROMPT = (
    "Today is {today}. Use Google Search to find AI news published TODAY ({today}) "
    "or in the past 24 hours (AI models, LLM research, AI tools, industry news). "
    "List each article as a numbered markdown item with its full URL:\n"
    "1. [Article Title](URL)\n"
    "2. [Article Title](URL)\n"
    "Include up to {limit} articles. Only include articles from today."
)


def discover_news_via_search(today: str) -> list[dict]:
    """
    Phase 1：Gemini + Google Search，三條備援路徑：
    1. groundingMetadata.groundingChunks（結構化，最可靠）
    2. regex 提取文字中的 markdown 連結 [title](url)
    3. JSON 解析（若 Gemini 偶爾返回 JSON 格式）
    """
    print("  [Google Search] 搜尋今日 AI 新聞...")
    payload = {
        "contents": [{"parts": [{"text": _DISCOVER_PROMPT.format(today=today, limit=MAX_NEWS)}]}],
        "generationConfig": {"maxOutputTokens": 2000, "temperature": 0.1},
        "tools": [{"google_search": {}}],
    }

    for model in GEMINI_MODELS:
        if model.startswith("gemini-1.5"):
            continue  # 1.5 不支援 google_search grounding

        api_url = f"{GEMINI_BASE}/{model}:generateContent?key={GEMINI_KEY}"
        _gemini_wait()
        try:
            resp = httpx.post(api_url, json=payload, timeout=120)
        except Exception as e:
            print(f"  ⚠ 請求失敗 ({model}): {e}")
            continue

        if resp.status_code in {429, 503, 529}:
            print(f"  ⚠ {model} {resp.status_code}，換下一個 model")
            time.sleep(3)
            continue
        if resp.status_code == 404:
            print(f"  ⚠ {model} 不存在，換下一個 model")
            continue
        if not resp.is_success:
            print(f"  ⚠ {model} {resp.status_code}，停止搜尋")
            break

        data = resp.json()
        try:
            candidate = data["candidates"][0]
        except (KeyError, IndexError):
            break

        grounding = candidate.get("groundingMetadata", {})
        print(f"    groundingMetadata keys: {list(grounding.keys())}")

        # ── 路徑 1：groundingChunks（結構化 API 欄位）─────────────────────
        chunks = grounding.get("groundingChunks", [])
        if chunks:
            seen: set[str] = set()
            articles: list[dict] = []
            for chunk in chunks:
                web = chunk.get("web", {})
                uri   = web.get("uri", "").strip()
                title = web.get("title", "").strip()
                if uri and title and uri not in seen:
                    seen.add(uri)
                    articles.append({"title": title, "url": uri, "source": "Web Search"})
            if articles:
                print(f"    找到 {len(articles)} 篇候選（groundingChunks）")
                return articles[:MAX_NEWS]

        # ── 取文字回應（路徑 2 & 3 共用）─────────────────────────────────
        try:
            text = _extract_text(data)
        except Exception:
            text = ""

        if text:
            # 路徑 2：regex 提取 markdown 連結 [title](url)
            seen2: set[str] = set()
            md_articles: list[dict] = []
            for title, url in re.findall(
                r'\[([^\]]{5,200})\]\((https?://\S{15,})\)', text
            ):
                url = url.rstrip(').,;')
                if url not in seen2:
                    seen2.add(url)
                    md_articles.append({"title": title.strip(), "url": url, "source": "Web Search"})
            if md_articles:
                print(f"    找到 {len(md_articles)} 篇候選（文字 markdown 連結）")
                return md_articles[:MAX_NEWS]

            # 路徑 3：JSON 解析
            try:
                parsed = parse_json_from_text(text)
                if isinstance(parsed, list):
                    valid = [a for a in parsed if a.get("url") and a.get("title")]
                    if valid:
                        print(f"    找到 {len(valid)} 篇候選（JSON 解析）")
                        return valid[:MAX_NEWS]
            except Exception:
                pass

            print(f"    未找到有效連結（回應前 120 字：{text[:120]!r}）")

        break  # 已取得 response，不需再換 model

    print("    Google Search 未找到今日文章")
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
    content, ok, _ = fetch_text(source["url"], max_chars=6000)
    if not ok or not content:
        print(f"    ✗ 無法取得頁面")
        return []

    try:
        raw = call_gemini(
            _PRIORITY_SCAN_PROMPT.format(
                today=today,
                source_name=source["name"],
                url=source["url"],
                content=content.replace("{", "{{").replace("}", "}}"),
                base_url=source["base_url"],
            ),
            max_tokens=1500,
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

    # Fetch 原文（follow_redirects 自動解析 vertexaisearch 代理 URL）
    content, ok, final_url = fetch_text(url, max_chars=7000)
    real_netloc = urlparse(final_url).netloc
    source = article.get("source") or real_netloc or urlparse(url).netloc or ""
    if source == "vertexaisearch.cloud.google.com":
        source = real_netloc  # 已重導向，取真實網域

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
                title=title.replace("{", "{{").replace("}", "}}"),
                url=url,
                source=source,
                content=content.replace("{", "{{").replace("}", "}}"),
            ),
            max_tokens=1200,
        )
        result = parse_json_from_text(raw)
        if isinstance(result, dict):
            return result
    except Exception as e:
        print(f"    ✗ 分析失敗: {e}")
    return None


def analyze_articles_batch(articles: list[dict]) -> list[dict | None]:
    """Fetch 並批次分析多篇文章（最多 BATCH_SIZE 篇），回傳與輸入等長的結果 list。"""
    n = len(articles)

    sections: list[str] = []
    for i, article in enumerate(articles):
        url    = article.get("url", "")
        title  = article.get("title", "")
        content, ok, final_url = fetch_text(url, max_chars=2200)
        real_netloc = urlparse(final_url).netloc
        source = article.get("source") or real_netloc or urlparse(url).netloc or ""
        if source == "vertexaisearch.cloud.google.com":
            source = real_netloc
        if not ok or len(content) < 80:
            content = "（無法取得完整頁面內容，請根據標題與來源推測分析）"
        sections.append(
            "文章 " + str(i + 1) + "：" + title + "\n"
            + "來源：" + source + "\n"
            + "內容：" + content
        )

    prompt = (
        "你是 AI 知識管理員，請分析以下 " + str(n) + " 篇文章，"
        "各自生成一張繁體中文知識卡片。\n\n"
        "嚴格輸出 JSON array，長度必須 = " + str(n) + "（順序對應文章編號）：\n"
        '[\n'
        '  {\n'
        '    "title":      "保留原文標題；若非中文可補副標：原標題 — 繁中副標",\n'
        '    "summary_zh": "繁體中文摘要 40-100 字，純文字",\n'
        '    "content_zh": "繁體中文重點筆記，Markdown 格式，100-350 字",\n'
        '    "category":   "ai-models|tools-frameworks|research|industry|open-source|learning|notes",\n'
        '    "quality":    1,\n'
        '    "tags":       ["tag1","tag2","tag3"]\n'
        '  }\n'
        ']\n\n'
        "--- 文章列表 ---\n"
        + "\n\n".join(sections)
        + "\n--- END ---\n\n"
        "只回傳 JSON array，不要 markdown code fence，不要其他文字。"
    )

    try:
        raw = call_gemini(prompt, max_tokens=2800)
        results = parse_json_from_text(raw)
        if isinstance(results, list) and len(results) == n:
            return [r if isinstance(r, dict) else None for r in results]
        got = len(results) if isinstance(results, list) else type(results).__name__
        print(f"  ⚠ 批次分析回傳數量不符 (期待 {n}，得到 {got})")
    except Exception as e:
        print(f"  ✗ 批次分析失敗: {e}")
    return [None] * n


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

    # ── Step 3：批次深度分析 + 存入 DB ──────────────────────────────────────
    inserted = 0
    for batch_start in range(0, len(final_list), BATCH_SIZE):
        batch = final_list[batch_start:batch_start + BATCH_SIZE]
        print(f"\n  ▶ 批次分析 {len(batch)} 篇 "
              f"[{', '.join(a.get('title','')[:25] for a in batch)}]")

        analyses = analyze_articles_batch(batch)

        for article, analysis in zip(batch, analyses):
            url    = article.get("url", "")
            title  = article.get("title", "")
            raw_source = article.get("source", "")
            source = (raw_source if raw_source and raw_source != "Web Search"
                      else urlparse(url).netloc or "Daily AI News")

            if not analysis:
                print(f"    ✗ 跳過（分析失敗）: {title[:50]}")
                continue

            err = validate_analysis(analysis)
            if err:
                print(f"    ✗ 跳過（{err}）: {title[:50]}")
                continue

            _, is_suspect, dup_of = check_duplicate(url, analysis["title"])

            cat_slug = analysis.get("category", "")
            cat_id   = cat_ids.get(cat_slug)
            if not cat_id:
                print(f"    ⚠ category '{cat_slug}' 找不到對應 ID，category_id 將為 null")

            item = {
                "type":              "news",
                "title":             analysis["title"],
                "url":               url or None,
                "summary":           analysis["summary_zh"],
                "content":           analysis.get("content_zh") or None,
                "category_id":       cat_id,
                "source":            source,
                "quality":           analysis["quality"],
                "is_pinned":         False,
                "duplicate_suspect": is_suspect,
                "duplicate_of":      dup_of,
                "metadata": {
                    "tags":          analysis.get("tags", []),
                    "fetched_at":    datetime.now(timezone.utc).isoformat(),
                    "ai_processed":  True,
                    "is_priority":   article.get("is_priority", False),
                },
            }

            try:
                supabase_req("POST", "/items", item)
                inserted += 1
                priority_flag = " [⭐Priority]" if article.get("is_priority") else ""
                dup_flag      = " ⚠ [重複嫌疑]" if is_suspect else ""
                print(f"    ✓ {title[:40]} Q{analysis['quality']} [{cat_slug}]{priority_flag}{dup_flag}")
            except Exception as e:
                print(f"    ✗ 插入失敗: {e}")

    print(f"\n完成！插入 {inserted} 篇（含 Priority 來源）")


if __name__ == "__main__":
    main()
