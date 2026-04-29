"""
research.py — 本地互動式研究工具
輸入任意主題，讓 Gemini 幫你找 GitHub repos + 相關文件，分析後存入 Supabase。

使用方式：
  python scripts/research.py "playwright 瀏覽器自動化"
  python scripts/research.py "RAG vector database"
  python scripts/research.py        # 互動模式，可連續輸入

環境變數：GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
可選：GITHUB_TOKEN（提高 GitHub API rate limit）
"""

import html
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import quote, urlparse

import httpx

# 自動載入 .env 檔（本地開發用，不影響 GitHub Actions）
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # 沒裝 python-dotenv 也能用（GitHub Actions 直接注入環境變數）

# ── 環境變數 ──────────────────────────────────────────────────────────────────
GEMINI_KEY   = os.environ["GEMINI_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
]

MAX_REPOS = 5   # 每次最多分析幾個 GitHub repos
MAX_DOCS  = 3   # 每次最多分析幾篇文件/文章
REPO_BATCH_SIZE = 2  # 每批 Gemini 呼叫分析幾個 repo

_gemini_last_call: float = 0.0
_GEMINI_MIN_INTERVAL = 12.0  # 秒（5 RPM，安全緩衝）
_RETRYABLE = {429, 503, 529}


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


# ── Gemini Rate Limiter ────────────────────────────────────────────────────────
def _gemini_wait() -> None:
    global _gemini_last_call
    elapsed = time.time() - _gemini_last_call
    if elapsed < _GEMINI_MIN_INTERVAL:
        time.sleep(_GEMINI_MIN_INTERVAL - elapsed)
    _gemini_last_call = time.time()


def _safe_json_loads(raw: str) -> list | dict:
    """解析 JSON，自動修復字串內未跳脫的控制字元。"""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
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
        raise ValueError(f"JSON 解析失敗: {e}\n原始: {raw[:300]}")


def _call_gemini_text(prompt: str, max_tokens: int = 1400) -> tuple[str, str]:
    """Gemini Fallback chain，回傳 (raw_text, model_used)。每個 model 只試一次。"""
    last_error = "（未嘗試）"
    for model in GEMINI_MODELS:
        url = f"{GEMINI_BASE}/{model}:generateContent?key={GEMINI_KEY}"
        _gemini_wait()
        resp = httpx.post(
            url,
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.2},
            },
            timeout=90,
        )
        if resp.status_code in _RETRYABLE:
            last_error = f"{model} 限流 ({resp.status_code})"
            print(f"    ⚠ {model} {resp.status_code}，換下一個 model")
            time.sleep(3)
            continue
        if resp.status_code == 404:
            print(f"    ⚠ {model} 不存在，換下一個 model")
            continue
        if not resp.is_success:
            raise RuntimeError(f"Gemini {resp.status_code} ({model}): {resp.text[:400]}")
        try:
            raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        except (KeyError, IndexError, TypeError) as e:
            last_error = f"{model} 結構異常: {e}"
            continue
        raw = re.sub(r"^```json\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"^```\s*", "", raw)
        raw = re.sub(r"```\s*$", "", raw).strip()
        print(f"    ✓ 使用模型：{model}")
        return raw, model
    raise RuntimeError(f"所有 Gemini 模型均失敗，最後錯誤：{last_error}")


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


def check_duplicate(url: str) -> bool:
    if not url:
        return False
    rows = supabase_req("GET", f"/items?url=eq.{quote(url, safe='')}&select=id&limit=1")
    return bool(rows)


# ── GitHub API ─────────────────────────────────────────────────────────────────
def _gh_headers() -> dict:
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return h


def search_github(query: str, limit: int = 8) -> list[dict]:
    print(f"  [GitHub] 搜尋：{query}")
    try:
        resp = httpx.get(
            "https://api.github.com/search/repositories",
            params={"q": query, "sort": "stars", "order": "desc", "per_page": limit},
            headers=_gh_headers(),
            timeout=30,
        )
        if resp.status_code == 403:
            print("  ⚠ GitHub rate limit，跳過此查詢")
            return []
        resp.raise_for_status()
        items = []
        for r in resp.json().get("items", []):
            items.append({
                "full_name":   r["full_name"],
                "url":         r["html_url"],
                "description": r.get("description") or "",
                "stars":       r["stargazers_count"],
                "forks":       r.get("forks_count", 0),
                "language":    r.get("language") or "unknown",
                "topics":      r.get("topics", []),
                "license":     (r.get("license") or {}).get("spdx_id", ""),
            })
        return items
    except Exception as e:
        print(f"  ⚠ GitHub 搜尋錯誤: {e}")
        return []


def fetch_readme(full_name: str) -> str:
    try:
        resp = httpx.get(
            f"https://api.github.com/repos/{full_name}/readme",
            headers={**_gh_headers(), "Accept": "application/vnd.github.raw"},
            timeout=20, follow_redirects=True,
        )
        if resp.status_code == 200:
            return resp.text[:5000]
    except Exception:
        pass
    return ""


# ── Web Fetch ──────────────────────────────────────────────────────────────────
_WEB_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/124 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
}


def fetch_webpage(url: str, max_chars: int = 5000) -> str:
    try:
        resp = httpx.get(
            url, headers=_WEB_HEADERS, timeout=15, follow_redirects=True,
        )
        if resp.status_code == 200:
            return strip_html(resp.text)[:max_chars]
    except Exception as e:
        print(f"    ⚠ fetch 失敗 ({url[:60]}): {e}")
    return ""


# ── Step 1：Gemini 規劃研究策略 ────────────────────────────────────────────────
def plan_research(topic: str, cat_slugs: list[str]) -> dict:
    """讓 Gemini 根據主題決定 GitHub 搜尋詞 + 推薦文件 URL + 最佳分類。"""
    prompt = (
        f"你是技術研究助手。用戶想研究主題：「{topic}」。\n\n"
        f"請回傳研究計畫 JSON（不要 markdown code fence，不要其他文字）：\n"
        f"{{\n"
        f'  "github_queries": ["搜尋詞1", "搜尋詞2"],\n'
        f'  "doc_urls": ["https://official-docs-url", "..."],\n'
        f'  "category": "最適合的分類 slug（從以下選一個）: {", ".join(cat_slugs)}"\n'
        f"}}\n\n"
        f"github_queries：2-3 個英文搜尋關鍵字，精準找到最相關的開源專案。\n"
        f"doc_urls：0-3 個官方文件、入門教學、或重要文章的 URL（確定存在的才填）。\n"
        f"category：最適合分類的 slug，必須從列表中選。\n"
        f"只回傳 JSON，不要任何其他文字。"
    )
    print("  [Gemini] 規劃研究策略...")
    raw, _ = _call_gemini_text(prompt, max_tokens=500)
    return _safe_json_loads(raw)


# ── Step 2：批次分析 GitHub Repos ──────────────────────────────────────────────
def analyze_repos_batch(repos: list[dict]) -> list[dict | None]:
    """批次分析 2-3 個 repo，單次 Gemini 呼叫。"""
    n = len(repos)
    sections: list[str] = []
    for i, repo in enumerate(repos):
        readme = fetch_readme(repo["full_name"])
        sections.append(
            f"=== 專案 {i + 1} ===\n"
            f"名稱：{repo['full_name']}\n"
            f"Stars：{repo['stars']}  Forks：{repo['forks']}\n"
            f"語言：{repo['language']}\n"
            f"Topics：{', '.join(repo['topics'][:10]) or '無'}\n"
            f"描述：{repo['description'] or '（無）'}\n\n"
            f"README（前 5000 字）：\n{readme or '（無）'}"
        )

    prompt = (
        f"你是技術知識策展人，請深度分析以下 {n} 個 GitHub 開源專案，"
        f"用**繁體中文**撰寫知識卡片。\n\n"
        f"嚴格輸出 JSON array，長度必須 = {n}（順序對應專案編號）：\n"
        '[\n'
        '  {\n'
        '    "title":   "直接用專案全名即可",\n'
        '    "summary": "繁體中文一句話說明（30-80字）",\n'
        '    "content": "繁體中文重點筆記，Markdown 格式（## 技術亮點\\n## 架構概述\\n## 適用場景），150-500字",\n'
        '    "quality": 5,\n'
        '    "tags":    ["tag1","tag2","tag3"]\n'
        '  }\n'
        ']\n\n'
        + "\n\n".join(sections)
        + "\n\n只回傳 JSON array，不要 markdown code fence，不要其他文字。"
    )

    try:
        raw, model = _call_gemini_text(prompt, max_tokens=n * 1200)
        results = json.loads(raw)
        if isinstance(results, list) and len(results) == n:
            for r in results:
                r["_model"] = model
            return results
        print(f"  ⚠ 批次長度不符（期待 {n}，得 {len(results) if isinstance(results, list) else '?'}）")
    except Exception as e:
        print(f"  ✗ Repo 批次分析失敗: {e}")
    return [None] * n


# ── Step 3：批次分析文件/文章 ──────────────────────────────────────────────────
def analyze_docs_batch(docs: list[dict]) -> list[dict | None]:
    """批次分析文件頁面，單次 Gemini 呼叫。"""
    n = len(docs)
    sections: list[str] = []
    for i, doc in enumerate(docs):
        content = fetch_webpage(doc["url"])
        sections.append(
            f"=== 文件 {i + 1} ===\n"
            f"URL：{doc['url']}\n"
            f"內容：{content or '（無法取得頁面內容）'}"
        )

    prompt = (
        f"你是技術知識策展人，請分析以下 {n} 篇技術文件/文章，"
        f"用**繁體中文**撰寫知識卡片。\n\n"
        f"嚴格輸出 JSON array，長度必須 = {n}（順序對應文件編號）：\n"
        '[\n'
        '  {\n'
        '    "title":   "文件標題（繁體中文）",\n'
        '    "summary": "繁體中文摘要（40-100字）",\n'
        '    "content": "繁體中文重點筆記，Markdown 格式（100-400字）",\n'
        '    "quality": 3,\n'
        '    "tags":    ["tag1","tag2"]\n'
        '  }\n'
        ']\n\n'
        + "\n\n".join(sections)
        + "\n\n只回傳 JSON array，不要 markdown code fence，不要其他文字。"
    )

    try:
        raw, model = _call_gemini_text(prompt, max_tokens=n * 1000)
        results = json.loads(raw)
        if isinstance(results, list) and len(results) == n:
            for r in results:
                r["_model"] = model
            return results
        print(f"  ⚠ 文件批次長度不符")
    except Exception as e:
        print(f"  ✗ 文件批次分析失敗: {e}")
    return [None] * n


# ── 主研究流程 ─────────────────────────────────────────────────────────────────
def research(topic: str) -> None:
    print(f"\n{'─' * 50}")
    print(f"  研究主題：{topic}")
    print(f"{'─' * 50}")

    cat_ids = get_category_ids()
    cat_slugs = list(cat_ids.keys())

    # Step 1：Gemini 規劃
    try:
        plan = plan_research(topic, cat_slugs)
    except Exception as e:
        print(f"  ✗ 規劃失敗（{e}），使用預設策略")
        plan = {"github_queries": [topic], "doc_urls": [], "category": "tools-frameworks"}

    github_queries: list[str] = plan.get("github_queries", [topic])[:3]
    doc_urls: list[str]       = [u for u in plan.get("doc_urls", []) if u.startswith("http")][:MAX_DOCS]
    category: str             = plan.get("category", "tools-frameworks")
    cat_id: str | None        = cat_ids.get(category) or cat_ids.get("tools-frameworks")

    print(f"  GitHub 搜尋詞：{github_queries}")
    print(f"  文件 URL：{doc_urls or '（無）'}")
    print(f"  分類：{category}")

    # Step 2：收集 GitHub repos
    seen_urls: set[str] = set()
    candidates: list[dict] = []
    for query in github_queries:
        for repo in search_github(query, limit=6):
            if repo["url"] not in seen_urls:
                seen_urls.add(repo["url"])
                candidates.append(repo)
        time.sleep(1)

    # 去重 + 限量
    new_repos: list[dict] = []
    for repo in sorted(candidates, key=lambda x: x["stars"], reverse=True):
        if check_duplicate(repo["url"]):
            print(f"  skip (已存在): {repo['full_name']}")
        else:
            new_repos.append(repo)
    new_repos = new_repos[:MAX_REPOS]
    print(f"  待分析 repos：{len(new_repos)} 個")

    # Step 3：批次分析 repos
    inserted = 0
    for i in range(0, len(new_repos), REPO_BATCH_SIZE):
        batch = new_repos[i : i + REPO_BATCH_SIZE]
        print(f"\n  ── Repo 批次 {i // REPO_BATCH_SIZE + 1}：{', '.join(r['full_name'] for r in batch)}")
        analyses = analyze_repos_batch(batch)

        for repo, analysis in zip(batch, analyses):
            if not analysis:
                print(f"    ✗ {repo['full_name']} 分析失敗，跳過")
                continue
            item = {
                "type":        "repo",
                "title":       repo["full_name"],
                "url":         repo["url"],
                "summary":     analysis.get("summary", ""),
                "content":     analysis.get("content", ""),
                "category_id": cat_id,
                "source":      "Research CLI",
                "quality":     int(analysis.get("quality", 3)),
                "is_pinned":   int(analysis.get("quality", 3)) >= 5,
                "metadata": {
                    "stars":        repo["stars"],
                    "forks":        repo["forks"],
                    "language":     repo["language"],
                    "topics":       repo["topics"],
                    "tags":         analysis.get("tags", []),
                    "research_topic": topic,
                    "fetched_at":   datetime.now(timezone.utc).isoformat(),
                    "ai_processed": True,
                    "model":        analysis.get("_model", GEMINI_MODELS[0]),
                },
            }
            try:
                supabase_req("POST", "/items", item)
                inserted += 1
                print(f"    ✓ {repo['full_name']:<40} Q{analysis.get('quality')}/5 [{category}]")
            except Exception as e:
                print(f"    ✗ 儲存失敗: {e}")

    # Step 4：分析文件/文章
    new_docs = [{"url": u} for u in doc_urls if not check_duplicate(u)]
    if new_docs:
        print(f"\n  ── 文件分析：{len(new_docs)} 篇")
        analyses = analyze_docs_batch(new_docs)

        for doc, analysis in zip(new_docs, analyses):
            if not analysis:
                print(f"    ✗ {doc['url'][:60]} 分析失敗，跳過")
                continue
            item = {
                "type":        "note",
                "title":       analysis.get("title") or doc["url"],
                "url":         doc["url"],
                "summary":     analysis.get("summary", ""),
                "content":     analysis.get("content", ""),
                "category_id": cat_id,
                "source":      urlparse(doc["url"]).netloc or "Research CLI",
                "quality":     int(analysis.get("quality", 3)),
                "metadata": {
                    "tags":           analysis.get("tags", []),
                    "research_topic": topic,
                    "fetched_at":     datetime.now(timezone.utc).isoformat(),
                    "ai_processed":   True,
                    "model":          analysis.get("_model", GEMINI_MODELS[0]),
                },
            }
            try:
                supabase_req("POST", "/items", item)
                inserted += 1
                print(f"    ✓ {analysis.get('title', doc['url'])[:50]:<50} Q{analysis.get('quality')}/5 [note]")
            except Exception as e:
                print(f"    ✗ 儲存失敗: {e}")

    print(f"\n  完成！共儲存 {inserted} 筆（主題：{topic}）\n")


# ── Entry Point ────────────────────────────────────────────────────────────────
def main() -> None:
    if len(sys.argv) > 1:
        research(" ".join(sys.argv[1:]))
    else:
        print("=== AI 知識庫研究工具 ===")
        print("輸入主題讓 Gemini 搜尋 GitHub + 文件並存入知識庫")
        print("按 Ctrl+C 或直接 Enter 退出\n")
        while True:
            try:
                topic = input("主題> ").strip()
            except (KeyboardInterrupt, EOFError):
                print("\n再見！")
                break
            if not topic:
                break
            research(topic)


if __name__ == "__main__":
    main()
