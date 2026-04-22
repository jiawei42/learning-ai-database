"""
weekly_github.py v2 — 每週抓 GitHub AI trending repos
用 Claude 3.5 Haiku 深度分析（code 理解能力強），存入 Supabase。

改進：
  - Claude 3.5 Haiku（claude-3-5-haiku-20241022）：技術 / code 理解最佳選擇
  - 抓 README（最多 6000 字）+ 最新 Release notes（最近 3 條）
  - 嚴格 JSON 輸出契約 + 逐欄驗證
  - Claude / GitHub API 錯誤均有 retry + exponential backoff
  - 重複跳過（URL 精確 + 標題相似度）

環境變數：ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
可選：GITHUB_TOKEN（提高 API rate limit）
"""

import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

# ── 環境變數 ──────────────────────────────────────────────────────────────────
ANTHROPIC_KEY = os.environ["ANTHROPIC_API_KEY"]
SUPABASE_URL  = os.environ["SUPABASE_URL"]
SUPABASE_KEY  = os.environ["SUPABASE_SERVICE_KEY"]
GITHUB_TOKEN  = os.environ.get("GITHUB_TOKEN", "")

# Fallback chain：從最新最強開始試，400 Invalid Model 就換下一個
CLAUDE_MODELS = [
    "claude-haiku-4-5",            # Claude 4.5 Haiku（最新，若可用優先）
    "claude-3-5-sonnet-20241022",  # Claude 3.5 Sonnet（品質更好的 fallback）
    "claude-3-5-haiku-20241022",   # Claude 3.5 Haiku（保底，確定可用）
]
CLAUDE_URL = "https://api.anthropic.com/v1/messages"

MAX_REPOS     = 10     # 每週最多儲存幾個
DUP_THRESHOLD = 0.65

SEARCH_QUERIES = [
    "AI agent LLM autonomous",
    "large language model framework",
    "RAG retrieval augmented generation",
    "AI inference serving deployment",
    "machine learning training tools",
]


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
                "q":        f"{query} pushed:>2025-01-01",
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
# model 不存在 → 直接換下一個，不重試
_INVALID_MODEL = {400, 404}


def claude_analyze(repo: dict, readme: str, releases: str) -> dict:
    """
    Fallback chain：依序試 CLAUDE_MODELS。
    - 429/503/529（過載）→ 同 model retry（最多 3 次，5/15/40s backoff）
    - 400（model 不存在的特定訊息）→ 換下一個
    - 其他 400（request 格式錯誤）→ 直接 raise，不換 model
    """
    prompt = build_prompt(repo, readme, releases)
    last_error = "（未嘗試）"

    for model in CLAUDE_MODELS:
        print(f"    嘗試模型：{model}")
        retry_delays = [5, 15, 40]

        for attempt in range(3):
            resp = httpx.post(
                CLAUDE_URL,
                headers={
                    "x-api-key":         ANTHROPIC_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type":      "application/json",
                },
                json={
                    "model":      model,
                    "max_tokens": 1200,
                    "messages":   [{"role": "user", "content": prompt}],
                },
                timeout=90,
            )

            # 暫時過載 → 同 model retry
            if resp.status_code in _RETRYABLE:
                if attempt < 2:
                    wait = retry_delays[attempt]
                    print(f"    Claude {resp.status_code}，等待 {wait}s 後重試...")
                    time.sleep(wait)
                    continue
                else:
                    last_error = f"{model} 過載超過重試次數"
                    break  # 換下一個 model

            # 非 2xx → 印出 body，判斷是否換 model
            if not resp.ok:
                body = resp.text[:400]
                print(f"    Claude {resp.status_code}: {body}")

                # 只有明確 "model not found/supported" 才換下一個
                if resp.status_code in {400, 404} and any(
                    kw in body.lower()
                    for kw in ("model", "not found", "not support", "invalid model", "unknown model")
                ):
                    last_error = f"{model} → {resp.status_code} model not found"
                    print(f"    ✗ Model 不存在，換下一個")
                    break

                # 其他 400（API key 錯、格式錯、content policy）→ 直接 raise
                raise RuntimeError(
                    f"Claude {resp.status_code} ({model}): {body}"
                )

            # ✅ 成功
            raw = resp.json()["content"][0]["text"].strip()
            raw = re.sub(r"^```json\s*", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"^```\s*", "", raw)
            raw = re.sub(r"```\s*$", "", raw).strip()
            result = json.loads(raw)
            result["_model_used"] = model
            print(f"    ✓ 使用模型：{model}")
            return result

    raise RuntimeError(f"所有 Claude 模型均失敗，最後錯誤：{last_error}")


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
    print(f"[{datetime.now().date()}] 開始分析 GitHub AI Trending（Claude fallback: {' → '.join(CLAUDE_MODELS)}）...")

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
            analysis = claude_analyze(repo, readme, releases)
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
                "model":        analysis.get("_model_used", CLAUDE_MODELS[-1]),
            },
        }

        try:
            supabase_req("POST", "/items", item)
            inserted += 1
            dup_flag = " ⚠ [重複嫌疑]" if is_suspect else ""
            print(f"    ✓ Q{analysis['quality']}/5 [{repo['language']}]{dup_flag}")
        except Exception as e:
            print(f"    ✗ 插入失敗: {e}")

        time.sleep(2)  # Claude rate limit 緩衝

    print(f"\n完成！分析並儲存 {inserted} 個 repos")


if __name__ == "__main__":
    main()
