"""
weekly_github.py v2 — 每週抓 GitHub AI trending repos
用 Gemini 免費模型深度分析，存入 Supabase。

Gemini Fallback chain（全免費）：
  gemini-2.5-flash → gemini-2.0-flash → gemini-1.5-flash

環境變數：GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
可選：GITHUB_TOKEN（提高 GitHub API rate limit）
"""

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

# ── 環境變數 ──────────────────────────────────────────────────────────────────
GEMINI_KEY   = os.environ["GEMINI_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

# Fallback chain：全免費，從最新最強開始試
GEMINI_MODELS = [
    "gemini-2.5-flash",   # 最新最強（免費額度）
    "gemini-2.0-flash",   # 穩定備用
    "gemini-1.5-flash",   # 保底，最穩定
]

MAX_REPOS     = 6      # 每週最多儲存幾個（免費 API quota 考量）
DUP_THRESHOLD = 0.65

SEARCH_QUERIES = [
    "AI agent LLM autonomous",
    "large language model framework",
    "RAG retrieval augmented generation",
    "AI inference serving deployment",
    "machine learning training tools",
]


# ── Gemini Rate Limiter（免費版 ~10 RPM）────────────────────────────────────────
_gemini_last_call: float = 0.0
_GEMINI_MIN_INTERVAL = 7.0  # 秒（10 RPM = 6s/call，留 1s buffer）


def _gemini_wait() -> None:
    """每次 Gemini call 前呼叫，確保不超過 RPM 限制。"""
    global _gemini_last_call
    elapsed = time.time() - _gemini_last_call
    if elapsed < _GEMINI_MIN_INTERVAL:
        wait = _GEMINI_MIN_INTERVAL - elapsed
        time.sleep(wait)
    _gemini_last_call = time.time()


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


def get_category_id(slug: str) -> str | None:
    rows = supabase_req("GET", f"/categories?slug=eq.{slug}&select=id&limit=1")
    return rows[0]["id"] if rows else None


# ── 重複判斷 ───────────────────────────────────────────────────────────────────
def _word_overlap(a: str, b: str) -> float:
    wa = set(re.findall(r"\w+", a.lower()))
    wb = set(re.findall(r"\w+", b.lower()))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def check_duplicate(url: str, title: str) -> tuple[bool, bool, str | None]:
    """(skip_entirely, is_suspect, dup_id)"""
    rows = supabase_req("GET", f"/items?url=eq.{quote(url, safe='')}&select=id&limit=1")
    if rows:
        return True, False, None

    recent = supabase_req("GET", "/items?select=id,title&order=created_at.desc&limit=300") or []
    for item in recent:
        if _word_overlap(title, item["title"]) >= DUP_THRESHOLD:
            return False, True, item["id"]
    return False, False, None


# ── JSON 容錯解析 ──────────────────────────────────────────────────────────────
def _safe_json_loads(raw: str) -> dict:
    """解析 JSON，自動修復字串內未跳脫的換行／Tab（Gemini markdown 欄位常見問題）。"""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    # Character-by-character fix
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
        elif in_str and ch == "\n":
            out.append("\\n")
        elif in_str and ch == "\r":
            out.append("\\r")
        elif in_str and ch == "\t":
            out.append("\\t")
        else:
            out.append(ch)
    try:
        return json.loads("".join(out))
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 解析失敗（修復後仍無效）: {e}\n原始: {raw[:300]}")


# ── GitHub API ─────────────────────────────────────────────────────────────────
def _gh_headers() -> dict:
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return h


def github_search(query: str, limit: int = 10) -> list[dict]:
    """搜尋 GitHub repos，回傳基本資料。"""
    try:
        resp = httpx.get(
            "https://api.github.com/search/repositories",
            params={
                "q":        f"{query} pushed:>{(datetime.now() - timedelta(days=180)).strftime('%Y-%m-%d')}",
                "sort":     "stars",
                "order":    "desc",
                "per_page": limit,
            },
            headers=_gh_headers(),
            timeout=30,
        )
        if resp.status_code == 403:
            print(f"  GitHub rate limit 超過，跳過查詢: {query[:40]}")
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
                "created_at":  r.get("created_at", ""),
                "updated_at":  r.get("updated_at", ""),
            })
        return items
    except Exception as e:
        print(f"  GitHub search 錯誤 ({query[:30]}): {e}")
        return []


def fetch_readme(full_name: str) -> str:
    """取得 README 原文（最多 6000 字）。"""
    try:
        resp = httpx.get(
            f"https://api.github.com/repos/{full_name}/readme",
            headers={**_gh_headers(), "Accept": "application/vnd.github.raw"},
            timeout=20,
            follow_redirects=True,
        )
        if resp.status_code == 200:
            return resp.text[:6000]
    except Exception:
        pass
    return ""


def fetch_releases(full_name: str) -> str:
    """取得最近 3 條 release notes，整合成字串。"""
    try:
        resp = httpx.get(
            f"https://api.github.com/repos/{full_name}/releases",
            params={"per_page": 3},
            headers=_gh_headers(),
            timeout=15,
        )
        if resp.status_code != 200:
            return ""
        releases = resp.json()
        parts = []
        for r in releases:
            name = r.get("name") or r.get("tag_name", "")
            body = (r.get("body") or "")[:300]
            if name:
                parts.append(f"### {name}\n{body}")
        return "\n\n".join(parts)[:1500]
    except Exception:
        return ""


# ── Claude 分析 ────────────────────────────────────────────────────────────────
_ANALYSIS_SCHEMA = """
嚴格 JSON 輸出（不要 markdown code fence，不要任何其他文字）：
{
  "title":       <string, 直接用專案全名即可>,
  "summary":     <string, 繁體中文一句話說明這個專案（30–80字）>,
  "highlights":  <string, 3–5 個技術亮點，Markdown 條列格式（- 開頭），每點 20–50 字>,
  "architecture":<string, 架構概述：核心技術組件、設計模式、與其他工具整合方式（50–150字）>,
  "use_case":    <string, 最適合的使用場景，舉具體例子（30–80字）>,
  "compared_to": <string, 與同類工具相比的差異或優勢（30–80字），若無明顯對比則留空字串>,
  "quality":     <integer, 1–5（5=AI 領域必知、極具影響力；4=值得收藏；3=普通）>
}
"""


def build_prompt(repo: dict, readme: str, releases: str) -> str:
    """
    用字串拼接而非 .format()，避免 README/release notes 中的
    大括號 { } 被 Python format engine 誤判為 template key。
    """
    lines = [
        "你是 AI 技術策展人，請深度分析以下 GitHub 開源專案並用**繁體中文**撰寫知識卡片。",
        "",
        "## 專案基本資訊",
        f"- **名稱**: {repo['full_name']}",
        f"- **Stars**: {repo['stars']:,} ⭐  Forks: {repo['forks']:,}",
        f"- **語言**: {repo['language']}",
        f"- **License**: {repo['license'] or '未知'}",
        f"- **Topics**: {', '.join(repo['topics'][:15]) or '（無）'}",
        f"- **描述**: {repo['description'] or '（無描述）'}",
        "",
        "## README（前 6000 字）",
        readme or "（無 README）",
        "",
        "## 最新 Release Notes",
        releases or "（無 Release）",
        "",
        "---",
        _ANALYSIS_SCHEMA,
    ]
    return "\n".join(lines)

# 可 retry 的暫時性錯誤（過載/限流）
_RETRYABLE = {429, 503, 529}


def gemini_analyze(repo: dict, readme: str, releases: str) -> dict:
    """
    Gemini Fallback chain：依序試 GEMINI_MODELS（全免費）。
    - 429/503/529（過載）→ 同 model retry（最多 3 次，60/120/240s backoff）
    - 404（model 不存在）→ 換下一個
    - 其他非 2xx → 印出 body，直接 raise
    """
    prompt = build_prompt(repo, readme, releases)
    last_error = "（未嘗試）"

    for model in GEMINI_MODELS:
        print(f"    嘗試模型：{model}")
        url = f"{GEMINI_BASE}/{model}:generateContent?key={GEMINI_KEY}"
        retry_delays = [60, 120, 240]  # 429 需要等夠久

        for attempt in range(3):
            _gemini_wait()  # ← 全域 rate limit：確保每次至少間隔 7s
            resp = httpx.post(
                url,
                headers={"Content-Type": "application/json"},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"maxOutputTokens": 1400, "temperature": 0.2},
                },
                timeout=90,
            )

            # 過載 → 同 model retry
            if resp.status_code in _RETRYABLE:
                if attempt < 2:
                    wait = retry_delays[attempt]
                    print(f"    Gemini {resp.status_code}，等待 {wait}s 後重試...")
                    time.sleep(wait)
                    continue
                else:
                    last_error = f"{model} 過載超過重試次數"
                    break

            # 404 → model 不存在，換下一個
            if resp.status_code == 404:
                last_error = f"{model} → 404 not found"
                print(f"    ✗ Model 不存在，換下一個")
                break

            # 其他非 2xx → 印出 body，raise
            if not resp.is_success:
                body = resp.text[:400]
                print(f"    Gemini {resp.status_code}: {body}")
                raise RuntimeError(f"Gemini {resp.status_code} ({model}): {body}")

            # ✅ 成功 — 取出文字
            try:
                raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
            except (KeyError, IndexError, TypeError) as e:
                last_error = f"{model} response 結構異常: {e}"
                print(f"    ✗ Response 結構異常，換下一個 model: {e}")
                break  # 換下一個 model

            raw = re.sub(r"^```json\s*", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"^```\s*", "", raw)
            raw = re.sub(r"```\s*$", "", raw).strip()

            try:
                result = _safe_json_loads(raw)
            except (ValueError, Exception) as e:
                last_error = f"{model} JSON 解析失敗: {e}"
                print(f"    ✗ JSON 解析失敗，換下一個 model")
                break  # 換下一個 model

            result["_model_used"] = model
            print(f"    ✓ 使用模型：{model}")
            return result

    raise RuntimeError(f"所有 Gemini 模型均失敗，最後錯誤：{last_error}")


def validate_analysis(out: dict) -> str | None:
    """回傳錯誤訊息，None 代表合法。"""
    if not isinstance(out.get("summary"), str) or len(out["summary"]) < 10:
        return "summary 過短"
    q = out.get("quality")
    if not isinstance(q, int) or not (1 <= q <= 5):
        return "quality 不在 1–5"
    return None


def build_content(analysis: dict) -> str:
    """把分析結果組成 Markdown 詳細筆記。"""
    parts = []
    if analysis.get("highlights"):
        parts.append(f"## 技術亮點\n{analysis['highlights']}")
    if analysis.get("architecture"):
        parts.append(f"## 架構概述\n{analysis['architecture']}")
    if analysis.get("use_case"):
        parts.append(f"## 適用場景\n{analysis['use_case']}")
    if analysis.get("compared_to"):
        parts.append(f"## 與同類工具比較\n{analysis['compared_to']}")
    return "\n\n".join(parts)


# ── 主流程 ─────────────────────────────────────────────────────────────────────
def main() -> None:
    print(f"[{datetime.now().date()}] 開始分析 GitHub AI Trending（Gemini fallback: {' → '.join(GEMINI_MODELS)}）...")

    open_source_cat_id = get_category_id("open-source")
    if not open_source_cat_id:
        print("  ⚠ 找不到 open-source 分類，category_id 將為 null")

    # ── Step 1：蒐集候選 repo ────────────────────────────────────────────────
    all_repos: dict[str, dict] = {}

    for query in SEARCH_QUERIES:
        print(f"  搜尋: {query}")
        results = github_search(query, limit=8)
        for r in results:
            if r["url"] not in all_repos:
                all_repos[r["url"]] = r
        time.sleep(1)  # GitHub rate limit 緩衝

    sorted_repos = sorted(all_repos.values(), key=lambda x: x["stars"], reverse=True)
    print(f"\n  收集 {len(sorted_repos)} 個 repos（去重後）")

    # ── Step 2：過濾已存在的 URL ─────────────────────────────────────────────
    new_repos = []
    for r in sorted_repos:
        skip, _, _ = check_duplicate(r["url"], r["full_name"])
        if skip:
            print(f"  skip (已存在): {r['full_name']}")
        else:
            new_repos.append(r)

    new_repos = new_repos[:MAX_REPOS]
    print(f"  待分析: {len(new_repos)} 個")

    if not new_repos:
        print("  沒有新 repos，結束。")
        return

    # ── Step 3：逐個深度分析 + 存入 DB ──────────────────────────────────────
    inserted = 0
    for repo in new_repos:
        print(f"\n  ▶ {repo['full_name']} ({repo['stars']:,} ⭐)")

        # Fetch 補充資料
        readme   = fetch_readme(repo["full_name"])
        releases = fetch_releases(repo["full_name"])
        print(f"    README: {len(readme)} 字 | Releases: {'有' if releases else '無'}")

        # Claude 分析
        try:
            analysis = gemini_analyze(repo, readme, releases)
        except Exception as e:
            print(f"    ✗ 分析失敗: {e}")
            continue

        err = validate_analysis(analysis)
        if err:
            print(f"    ✗ 輸出不合規（{err}），跳過")
            continue

        # 標題相似度重複檢查
        _, is_suspect, dup_of = check_duplicate(repo["url"], repo["full_name"])

        item = {
            "type":             "repo",
            "title":            repo["full_name"],
            "url":              repo["url"],
            "summary":          analysis["summary"],
            "content":          build_content(analysis),
            "category_id":      open_source_cat_id,
            "source":           "GitHub Trending",
            "quality":          analysis["quality"],
            "is_pinned":        analysis["quality"] >= 5,
            "duplicate_suspect": is_suspect,
            "duplicate_of":     dup_of,
            "metadata": {
                "stars":        repo["stars"],
                "forks":        repo["forks"],
                "language":     repo["language"],
                "topics":       repo["topics"],
                "license":      repo["license"],
                "tags":         [t.lower() for t in repo["topics"][:4]],
                "fetched_at":   datetime.now(timezone.utc).isoformat(),
                "ai_processed": True,
                "model":        analysis.get("_model_used", GEMINI_MODELS[-1]),
            },
        }

        try:
            supabase_req("POST", "/items", item)
            inserted += 1
            dup_flag = " ⚠ [重複嫌疑]" if is_suspect else ""
            print(f"    ✓ Q{analysis['quality']}/5 [{repo['language']}]{dup_flag}")
        except Exception as e:
            print(f"    ✗ 插入失敗: {e}")

        # rate limit 由 _gemini_wait() 統一處理，此處不額外 sleep

    print(f"\n完成！分析並儲存 {inserted} 個 repos")


if __name__ == "__main__":
    main()
