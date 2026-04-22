"""
weekly_github.py — 每週抓 GitHub AI trending repos，用 Gemini 2.5 Flash 深度分析，存入 Supabase。
執行：python scripts/weekly_github.py
環境變數：GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
"""
import os
import json
import httpx
from urllib.parse import quote
from datetime import datetime, timezone

GEMINI_KEY   = os.environ["GEMINI_API_KEY"]
GEMINI_URL   = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

SEARCH_QUERIES = [
    "AI LLM language model",
    "machine learning framework",
    "RAG retrieval augmented",
    "AI agent autonomous",
]


def supabase_req(method, path, body=None):
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    resp = httpx.request(method, f"{SUPABASE_URL}/rest/v1{path}",
                         headers=headers, json=body, timeout=30)
    resp.raise_for_status()
    return resp.json() if resp.content else None


def get_category_id(slug: str) -> str | None:
    rows = supabase_req("GET", f"/categories?slug=eq.{slug}&select=id&limit=1")
    return rows[0]["id"] if rows else None


def github_search(query: str, limit=10) -> list[dict]:
    headers = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"

    resp = httpx.get(
        "https://api.github.com/search/repositories",
        params={
            "q": f"{query} pushed:>2025-01-01",
            "sort": "stars",
            "order": "desc",
            "per_page": limit,
        },
        headers=headers,
        timeout=30,
    )
    if resp.status_code != 200:
        print(f"GitHub API error {resp.status_code}: {resp.text[:200]}")
        return []

    items = resp.json().get("items", [])
    return [
        {
            "name": r["full_name"],
            "url": r["html_url"],
            "description": r.get("description") or "",
            "stars": r["stargazers_count"],
            "language": r.get("language") or "unknown",
            "topics": r.get("topics", []),
            "readme_url": f"https://api.github.com/repos/{r['full_name']}/readme",
        }
        for r in items
    ]


def fetch_readme(readme_url: str) -> str:
    headers = {"Accept": "application/vnd.github.raw"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    try:
        resp = httpx.get(readme_url, headers=headers, timeout=20, follow_redirects=True)
        if resp.status_code == 200:
            return resp.text[:3000]  # 限制 token 用量
    except Exception:
        pass
    return ""


def already_exists(url: str) -> bool:
    rows = supabase_req("GET", f"/items?url=eq.{quote(url, safe='')}&select=id&limit=1")
    return bool(rows)


def gemini_analyze(repo: dict, readme: str) -> dict:
    prompt = f"""分析這個 GitHub AI 開源專案，用繁體中文回答。

Repo: {repo['name']}
Stars: {repo['stars']:,}
Language: {repo['language']}
Topics: {', '.join(repo['topics'][:10])}
Description: {repo['description']}

README（前 3000 字）:
{readme or '（無 README）'}

嚴格 JSON 輸出（不要 markdown code fence，不要任何其他文字）：
{{
  "summary": "一句話說明這個專案是什麼（<=80字）",
  "why_popular": "為什麼這個 repo 受歡迎，技術亮點是什麼（<=150字）",
  "architecture": "架構概述，核心技術組件（<=150字）",
  "use_case": "適合什麼場景使用（<=80字）",
  "quality": <1-5 整體評分，integer>
}}"""

    resp = httpx.post(
        f"{GEMINI_URL}?key={GEMINI_KEY}",
        headers={"Content-Type": "application/json"},
        json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": 700, "temperature": 0.2},
        },
        timeout=60,
    )
    resp.raise_for_status()
    raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
    raw = raw.lstrip("```json").lstrip("```").rstrip("```").strip()
    return json.loads(raw)


def main():
    print(f"[{datetime.now().date()}] 開始分析 GitHub AI Trending...")
    open_source_cat_id = get_category_id("open-source")

    # Collect repos from multiple queries
    all_repos: dict[str, dict] = {}
    for query in SEARCH_QUERIES:
        print(f"  搜尋: {query}")
        repos = github_search(query, limit=8)
        for r in repos:
            if r["url"] not in all_repos:
                all_repos[r["url"]] = r

    # Sort by stars, take top 10 new ones
    sorted_repos = sorted(all_repos.values(), key=lambda x: x["stars"], reverse=True)
    new_repos = [r for r in sorted_repos if not already_exists(r["url"])][:10]

    print(f"\n共找到 {len(sorted_repos)} 個 repos，{len(new_repos)} 個是新的")

    for repo in new_repos:
        print(f"\n分析: {repo['name']} ({repo['stars']:,} ⭐)")
        try:
            readme = fetch_readme(repo["readme_url"])
            analysis = gemini_analyze(repo, readme)

            content_parts = []
            if analysis.get("why_popular"):
                content_parts.append(f"## 為何受歡迎\n{analysis['why_popular']}")
            if analysis.get("architecture"):
                content_parts.append(f"## 架構概述\n{analysis['architecture']}")
            if analysis.get("use_case"):
                content_parts.append(f"## 適用場景\n{analysis['use_case']}")

            item = {
                "type": "repo",
                "title": repo["name"],
                "url": repo["url"],
                "summary": analysis.get("summary", repo["description"][:80]),
                "content": "\n\n".join(content_parts),
                "category_id": open_source_cat_id,
                "source": "GitHub Trending",
                "quality": analysis.get("quality", 3),
                "is_pinned": analysis.get("quality", 0) >= 5,
                "metadata": {
                    "stars": repo["stars"],
                    "language": repo["language"],
                    "topics": repo["topics"],
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                },
            }
            supabase_req("POST", "/items", item)
            print(f"  ✓ 已儲存（品質 {analysis.get('quality')}/5）")

        except Exception as e:
            print(f"  ✗ 分析失敗: {e}")

    print(f"\n完成！分析並儲存 {len(new_repos)} 個 repos")


if __name__ == "__main__":
    main()
