"""
daily_news.py — 每天抓 10 篇 AI 新聞，用 Gemini Flash 摘要，存入 Supabase。
執行：python scripts/daily_news.py
環境變數：GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
"""
import os
import json
import httpx
from urllib.parse import quote
from datetime import date, datetime, timezone

GEMINI_KEY    = os.environ["GEMINI_API_KEY"]
SUPABASE_URL  = os.environ["SUPABASE_URL"]
SUPABASE_KEY  = os.environ["SUPABASE_SERVICE_KEY"]

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"

NEWS_SOURCES = [
    "https://hnrss.org/newest?q=AI+LLM+machine+learning&count=30",
    "https://feeds.feedburner.com/oreilly/radar/atom",
]

CATEGORY_SLUGS = {
    "ai-models": None,
    "tools-frameworks": None,
    "research": None,
    "industry": None,
    "open-source": None,
}


def supabase_req(method: str, path: str, body=None):
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    url = f"{SUPABASE_URL}/rest/v1{path}"
    resp = httpx.request(method, url, headers=headers, json=body, timeout=30)
    resp.raise_for_status()
    return resp.json() if resp.content else None


def get_category_ids():
    rows = supabase_req("GET", "/categories?select=id,slug")
    return {r["slug"]: r["id"] for r in (rows or [])}


def fetch_rss_links(url: str, limit=20) -> list[dict]:
    """Fetch RSS feed and return list of {title, link, description}."""
    try:
        resp = httpx.get(url, timeout=20, follow_redirects=True)
        import xml.etree.ElementTree as ET
        import re

        # Strip control characters that break the XML parser
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', resp.text)

        try:
            root = ET.fromstring(text)
        except ET.ParseError:
            # fallback: wrap in a root tag and retry
            root = ET.fromstring(f"<root>{text}</root>")

        ns = {"atom": "http://www.w3.org/2005/Atom"}
        items = []

        # RSS 2.0
        for item in root.findall(".//item")[:limit]:
            title = item.findtext("title", "").strip()
            link  = item.findtext("link", "").strip()
            desc  = item.findtext("description", "").strip()[:500]
            if title and link:
                items.append({"title": title, "url": link, "snippet": desc})

        # Atom
        for entry in root.findall(".//atom:entry", ns)[:limit]:
            title = entry.findtext("atom:title", "", ns).strip()
            link_el = entry.find("atom:link", ns)
            link = link_el.get("href", "") if link_el is not None else ""
            summary = entry.findtext("atom:summary", "", ns).strip()[:500]
            if title and link:
                items.append({"title": title, "url": link, "snippet": summary})

        return items
    except Exception as e:
        print(f"RSS fetch error {url}: {e}")
        return []


def gemini(prompt: str) -> str:
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 1024, "temperature": 0.3},
    }
    resp = httpx.post(
        f"{GEMINI_URL}?key={GEMINI_KEY}",
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()


def select_and_analyze(candidates: list[dict], cat_ids: dict) -> list[dict]:
    """Ask Gemini to pick top 10 and categorize + summarize them."""
    candidate_json = json.dumps(
        [{"i": i, "title": c["title"], "snippet": c["snippet"][:200]} for i, c in enumerate(candidates)],
        ensure_ascii=False,
    )
    categories_str = ", ".join(CATEGORY_SLUGS.keys())

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
    # strip markdown code fences if any
    raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
    picks = json.loads(raw)

    result = []
    for pick in picks[:10]:
        idx = pick["i"]
        orig = candidates[idx]
        result.append({
            "type": "news",
            "title": orig["title"],
            "url": orig["url"],
            "summary": pick["summary"],
            "category_id": cat_ids.get(pick.get("category", ""), None),
            "source": "Daily AI News",
            "quality": pick.get("quality", 3),
            "is_pinned": False,
            "metadata": {"fetched_at": datetime.now(timezone.utc).isoformat()},
        })
    return result


def already_exists(url: str) -> bool:
    rows = supabase_req("GET", f"/items?url=eq.{quote(url, safe='')}&select=id&limit=1")
    return bool(rows)


def main():
    print(f"[{date.today()}] 開始抓取 AI 新聞...")
    cat_ids = get_category_ids()

    # Collect from all RSS sources
    candidates = []
    for src in NEWS_SOURCES:
        candidates.extend(fetch_rss_links(src, limit=25))

    # Deduplicate by URL
    seen = set()
    unique = []
    for c in candidates:
        if c["url"] not in seen:
            seen.add(c["url"])
            unique.append(c)

    print(f"RSS 共取得 {len(unique)} 篇候選文章")

    # Filter already-saved
    new_candidates = [c for c in unique if not already_exists(c["url"])]
    print(f"過濾重複後剩 {len(new_candidates)} 篇")

    if len(new_candidates) < 5:
        print("新文章不足，跳過今日更新")
        return

    # Gemini select + summarize
    articles = select_and_analyze(new_candidates[:40], cat_ids)

    # Insert into Supabase
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
