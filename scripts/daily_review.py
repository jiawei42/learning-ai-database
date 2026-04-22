"""
daily_review.py — 每天隨機抽一個分類，Gemini Flash 審查內容品質，存審查紀錄。
執行：python scripts/daily_review.py
環境變數：GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
"""
import os
import json
import random
import httpx
from datetime import datetime, timezone, timedelta

GEMINI_KEY   = os.environ["GEMINI_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
REVIEW_MODEL = "gemini-2.0-flash"
SAMPLE_SIZE = 8  # 每次抽查筆數（省 token）


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


def gemini(prompt: str) -> str:
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 800, "temperature": 0.3},
    }
    resp = httpx.post(
        f"{GEMINI_URL}?key={GEMINI_KEY}",
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()


def main():
    print(f"[{datetime.now().date()}] 開始每日審查...")

    # Get all categories that have items
    categories = supabase_req("GET", "/categories?select=id,name,slug") or []
    if not categories:
        print("沒有分類，跳過")
        return

    # Pick random category
    cat = random.choice(categories)
    print(f"本次抽查分類：{cat['name']}")

    # Fetch recent items from this category
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    items = supabase_req(
        "GET",
        f"/items?category_id=eq.{cat['id']}&created_at=gte.{since}"
        f"&select=id,title,summary,quality,type&order=created_at.desc&limit=30"
    ) or []

    if len(items) < 2:
        print(f"分類 [{cat['name']}] 內容不足，跳過")
        return

    # Random sample
    sample = random.sample(items, min(SAMPLE_SIZE, len(items)))
    print(f"抽查 {len(sample)} 筆（分類共 {len(items)} 筆近 30 天內容）")

    sample_json = json.dumps(
        [{"title": i["title"], "summary": i.get("summary",""), "type": i["type"], "quality": i.get("quality")}
         for i in sample],
        ensure_ascii=False,
    )

    prompt = f"""你是 AI 學習資料庫的品質審查員。請審查以下「{cat['name']}」分類的內容品質。

抽查內容（JSON）：
{sample_json}

請以繁體中文回答，回傳 JSON：
{{
  "avg_quality": <這批內容的平均品質 1.0~5.0>,
  "notes": "審查總結（150字以內）：整體品質評估、有無重複/過時內容、建議改進方向"
}}

只回傳 JSON，不要其他文字。"""

    try:
        raw = gemini(prompt)
        raw = raw.lstrip("```json").lstrip("```").rstrip("```").strip()
        result = json.loads(raw)
    except Exception as e:
        print(f"Gemini 回應解析失敗: {e}")
        result = {"avg_quality": None, "notes": "審查失敗，請手動確認"}

    # Save review record
    review = {
        "category_id": cat["id"],
        "model": REVIEW_MODEL,
        "items_checked": len(sample),
        "avg_quality": result.get("avg_quality"),
        "notes": result.get("notes"),
    }
    supabase_req("POST", "/reviews", review)

    print(f"\n審查完成！")
    print(f"  平均品質: {result.get('avg_quality', 'N/A')}/5")
    print(f"  審查備注: {result.get('notes', '')[:100]}")


if __name__ == "__main__":
    main()
