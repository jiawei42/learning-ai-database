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

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

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
    "gemini-2.0-flash-lite",      # 輕量備用
    "gemini-1.5-flash-latest",   # 保底
]

MAX_REPOS     = 6      # 每週最多儲存幾個（免費 API quota 考量）
BATCH_SIZE    = 2      # 每批分析幾個 repo（減少 Gemini 呼叫次數）
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
_GEMINI_MIN_INTERVAL = 12.0  # 秒（5 RPM，安全緩衝空間 5 RPM）


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
        elif in_str and ord(ch) < 0x20:
            out.append(f"\\u{ord(ch):04x}")
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


def _call_gemini_text(prompt: str, max_tokens: int = 1400) -> tuple[str, str]:
    """
    Gemini Fallback chain：每個 model 只嘗試一次，回傳 (raw_text, model_used)。
    - 429/503/529 → 直接換下一個 model（各 model 配額獨立）
    - 404 → 換下一個 model
    """
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
            last_error = f"{model} 404 not found"
            print(f"    ⚠ {model} 不存在，換下一個 model")
            continue

        if not resp.is_success:
            body = resp.text[:400]
            raise RuntimeError(f"Gemini {resp.status_code} ({model}): {body}")

        try:
            raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        except (KeyError, IndexError, TypeError) as e:
            last_error = f"{model} response 結構異常: {e}"
            print(f"    ⚠ {model} 結構異常，換下一個 model")
            continue

        raw = re.sub(r"^```json\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"^```\s*", "", raw)
        raw = re.sub(r"```\s*$", "", raw).strip()
        print(f"    ✓ 使用模型：{model}")
        return raw, model

    raise RuntimeError(f"所有 Gemini 模型均失敗，最後錯誤：{last_error}")


def _call_gemini_once(prompt: str, max_tokens: int = 1400) -> dict:
    """Gemini 呼叫 → dict（單一 JSON 物件）。"""
    raw, model = _call_gemini_text(prompt, max_tokens)
    try:
        result = _safe_json_loads(raw)
        result["_model_used"] = model
        return result
    except (ValueError, Exception) as e:
        raise RuntimeError(f"JSON 解析失敗 ({model}): {e}")


def gemini_analyze(repo: dict, readme: str, releases: str) -> dict:
    """單一 repo 分析（使用共用 fallback chain）。"""
    prompt = build_prompt(repo, readme, releases)
    return _call_gemini_once(prompt, max_tokens=1400)


def gemini_analyze_batch(repos_data: list[tuple[dict, str, str]]) -> list[dict | None]:
    """批次分析 2-3 個 repo，單次 Gemini 呼叫，回傳與輸入等長的結果 list。"""
    n = len(repos_data)
    sections: list[str] = []
    for i, (repo, readme, releases) in enumerate(repos_data):
        section_lines = [
            "=== 專案 " + str(i + 1) + " ===",
            "名稱：" + repo["full_name"],
            "Stars：" + str(repo["stars"]) + "  Forks：" + str(repo["forks"]),
            "語言：" + repo["language"],
            "Topics：" + ", ".join(repo["topics"][:10]),
            "描述：" + (repo["description"] or "（無）"),
            "",
            "README（前 3000 字）：",
            (readme or "（無）")[:3000],
            "",
            "Release Notes：",
            (releases or "（無）")[:800],
        ]
        sections.append("\n".join(section_lines))

    prompt = (
        "你是 AI 技術策展人，請深度分析以下 " + str(n) + " 個 GitHub 開源專案，"
        "用**繁體中文**撰寫知識卡片。\n\n"
        "嚴格輸出 JSON array，長度必須 = " + str(n) + "（順序對應專案編號）：\n"
        '[\n'
        '  {\n'
        '    "title":       "直接用專案全名即可",\n'
        '    "summary":     "繁體中文一句話說明（30-80字）",\n'
        '    "highlights":  "3-5個技術亮點，Markdown 條列（- 開頭），每點 20-50字",\n'
        '    "architecture":"架構概述：核心技術、設計模式（50-120字）",\n'
        '    "use_case":    "最適合的使用場景（30-70字）",\n'
        '    "compared_to": "與同類工具差異（30-70字），無明顯對比則空字串",\n'
        '    "quality":     5\n'
        '  }\n'
        ']\n\n'
        + "\n\n".join(sections)
        + "\n\n只回傳 JSON array，不要 markdown code fence，不要其他文字。"
    )

    try:
        raw, model = _call_gemini_text(prompt, max_tokens=n * 1500)
        results = json.loads(raw)
        if not isinstance(results, list) or len(results) != n:
            print(f"  ✗ 批次回傳格式錯誤（expected list[{n}], got {type(results).__name__}[{len(results) if isinstance(results, list) else '?'}]）")
            return [None] * n
        for r in results:
            r["_model_used"] = model
        return results
    except Exception as e:
        print(f"  ✗ 批次分析失敗: {e}")
        return [None] * n


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

    # ── Step 3：批次深度分析 + 存入 DB ──────────────────────────────────────
    inserted = 0
    for batch_start in range(0, len(new_repos), BATCH_SIZE):
        batch = new_repos[batch_start:batch_start + BATCH_SIZE]
        print(f"\n  ── 批次 {batch_start // BATCH_SIZE + 1}：{', '.join(r['full_name'] for r in batch)}")

        # Fetch 補充資料（不消耗 Gemini 配額，可連續 fetch）
        repos_data: list[tuple[dict, str, str]] = []
        for repo in batch:
            readme   = fetch_readme(repo["full_name"])
            releases = fetch_releases(repo["full_name"])
            print(f"    {repo['full_name']}: README {len(readme)} 字 | Releases {'有' if releases else '無'}")
            repos_data.append((repo, readme, releases))

        # 單次 Gemini 呼叫分析整批
        analyses = gemini_analyze_batch(repos_data)

        for (repo, _, _), analysis in zip(repos_data, analyses):
            if analysis is None:
                print(f"    ✗ {repo['full_name']} 分析失敗，跳過")
                continue

            err = validate_analysis(analysis)
            if err:
                print(f"    ✗ {repo['full_name']} 輸出不合規（{err}），跳過")
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
                print(f"    ✓ {repo['full_name']} Q{analysis['quality']}/5 [{repo['language']}]{dup_flag}")
            except Exception as e:
                print(f"    ✗ {repo['full_name']} 插入失敗: {e}")

        # rate limit 由 _gemini_wait() 統一處理，此處不額外 sleep

    print(f"\n完成！分析並儲存 {inserted} 個 repos")


if __name__ == "__main__":
    main()
