"""
daily_news.py — 每天抓 10 篇 AI 新聞，用 Gemini Flash 摘要，存入 Supabase。
執行：python scripts/daily_news.py
環境變數：GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
"""
import os
import json
import time
import httpx
import feedparser
from urllib.parse import quote
from datetime import date, datetime, timezone

GEMINI_KEY   = os.environ["GEMINI_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"

NEWS_SOURCES = [
    "https://hnrss.org/newest?q=AI+LLM&count=30",
    "https://hnrss.org/newest?q=machine+learning&count=20",
    "https://hnrss.org/newest?q=GPT+Claude+Gemini&count=20",
    "https://tldr.tech/ai/rss",
]

CATEGORY_SLUGS = ["ai-models", "tools-frameworks", "research", "industry", "open-source"]


# ── Supabase ────────────────────────────────────────────────
def supabase_req(method: str, path: str, body=None):
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


def get_category_ids() -> dict:
    rows = supabase_req("GET", "/categories?select=id,slug") or []
    return {r["slug"]: r["id"] for r in rows}


def already_exists(url: str) -> bool:
    rows = supabase_req("GET", f"/items?url=eq.{quote(url, safe='')}&select=id&limit=1")
    return bool(rows)


# ── RSS fetch (feedparser handles malformed XML natively) ────
def fetch_rss_links(url: str, limit: int = 25) -> list[dict]:
    try:
        feed = feedparser.parse(url)
        items = []
        for entry in feed.entries[:limit]:
            title   = getattr(entry, "title", "").strip()
            link    = getattr(entry, "link", "").strip()
            summary = getattr(entry, "summary", "").strip()[:400]
            if title and link:
                items.append({"title": title, "url": link, "snippet": summary})
        print(f"  [{url[:50]}] 取得 {len(items)} 篇")
        return items
    except Exception as e:
        print(f"  RSS error {url}: {e}")
        return []


# ── Gemini with retry ────────────────────────────────────────
def gemini(prompt: str, retries: int = 4) -> str:
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 800, "temperature": 0.3},
    }
    for attempt in range(retries):
        try:
            resp = httpx.post(
                f"{GEMINI_URL}?key={GEMINI_KEY}",
                json=payload,
                timeout=90,
            )
            if resp.status_code == 429:
                wait = 60 * (attempt + 1)   # 60s / 120s / 180s / 240s
                print(f"  Gemini 429，等待 {wait}s 後重試 ({attempt+1}/{retries})...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        except httpx.HTTPStatusError as e:
            if attempt == retries - 1:
                raise
            print(f"  Gemini 錯誤 {e.response.status_code}，重試...")
            time.sleep(30)
    raise RuntimeError("Gemini 請求失敗，已超過重試次數")


# ── Main logic ───────────────────────────────────────────────
def select_and_analyze(candidates: list[dict], cat_ids: dict) -> list[dict]:
    # 限制 15 篇以縮小 prompt，節省 token
    candidates = candidates[:15]
    candidate_json = json.dumps(
        [{"i": i, "title": c["title"], "snippet": c["snippet"][:80]}
         for i, c in enumerate(candidates)],
        ensure_ascii=False,
    )
    categories_str = ", ".join(CATEGORY_SLUGS)

    prompt = f"""你是 AI 知識管理員。以下是今天的 AI 相關文章候選清單（JSON）：
{candidate_json}

請選出最值得閱讀的 10 篇（新穎、有深度、貼近 AI 技術趨勢）。
對每篇文章：
1. 用繁體中文寫一句話摘要（<= 80 字）
2. 從以下分類中選最合適的一個：{categories_str}
3. 給品質分 1~5（5=必讀）

只回傳 JSON array，格式：
[{{"i": <原始index>, "summary": "...", "category": "<slug>", "quality": <1-5>}}, ...]

不要任何其他文字。"""

    raw = gemini(prompt)
    raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
    picks = json.loads(raw)

    result = []
    for pick in picks[:10]:
        idx = pick.get("i", 0)
        if idx >= len(candidates):
            continue
        orig = candidates[idx]
        result.append({
            "type": "news",
            "title": orig["title"],
            "url": orig["url"],
            "summary": pick.get("summary", ""),
            "category_id": cat_ids.get(pick.get("category", ""), None),
            "source": "Daily AI News",
            "quality": pick.get("quality", 3),
            "is_pinned": False,
            "metadata": {"fetched_at": datetime.now(timezone.utc).isoformat()},
        })
    return result


def main():
    print(f"[{date.today()}] 開始抓取 AI 新聞...")
    cat_ids = get_category_ids()
    print(f"分類 IDs: {list(cat_ids.keys())}")

    # Collect from RSS sources
    candidates: list[dict] = []
    for src in NEWS_SOURCES:
        candidates.extend(fetch_rss_links(src))

    # Deduplicate by URL
    seen: set[str] = set()
    unique = []
    for c in candidates:
        if c["url"] not in seen:
            seen.add(c["url"])
            unique.append(c)

    print(f"RSS 共取得 {len(unique)} 篇（去重後）")

    # Filter already-saved
    new_candidates = [c for c in unique if not already_exists(c["url"])]
    print(f"排除已存在，剩 {len(new_candidates)} 篇新文章")

    if len(new_candidates) < 3:
        print("新文章不足，跳過今日更新")
        return

    # Gemini select + summarize
    try:
        articles = select_and_analyze(new_candidates, cat_ids)
    except Exception as e:
        print(f"\nGemini 失敗（{e}），使用 fallback：直接存前 10 篇原始標題")
        articles = [
            {
                "type": "news",
                "title": c["title"],
                "url": c["url"],
                "summary": c["snippet"][:200] or None,
                "category_id": None,
                "source": "Daily AI News",
                "quality": 3,
                "is_pinned": False,
                "metadata": {"fetched_at": datetime.now(timezone.utc).isoformat(), "ai_processed": False},
            }
            for c in new_candidates[:10]
        ]

    # Insert
    inserted = 0
    for article in articles:
        try:
            supabase_req("POST", "/items", article)
            inserted += 1
            print(f"  ✓ {article['title'][:60]}")
        except Exception as e:
            print(f"  ✗ insert error: {e}")

    print(f"\n完成！插入 {inserted} 篇新聞")


if __name__ == "__main__":
    main()
