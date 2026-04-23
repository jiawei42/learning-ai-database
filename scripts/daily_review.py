"""
daily_review.py — 每天隨機抽一個分類，Gemini Flash 審查內容品質，存審查紀錄。
執行：python scripts/daily_review.py
環境變數：GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
"""
import os
import json
import random
import re
import time
import httpx
from datetime import datetime, timezone, timedelta

GEMINI_KEY   = os.environ["GEMINI_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]
SAMPLE_SIZE = 8


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


def _safe_json_loads(raw: str) -> list | dict:
    """解析 JSON，自動修復字串內未跳脫的換行／Tab（Gemini markdown 常見問題）。"""
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


def gemini(prompt: str) -> str:
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 800, "temperature": 0.3},
    }
    retry_delays = [10, 30, 60]
    last_error = "（未嘗試）"
    for model in GEMINI_MODELS:
        url = f"{GEMINI_BASE}/{model}:generateContent?key={GEMINI_KEY}"
        for attempt in range(3):
            resp = httpx.post(url, json=payload, timeout=60)
            if resp.status_code in {429, 503, 529}:
                if attempt < 2:
                    wait = retry_delays[attempt]
                    print(f"  Gemini {resp.status_code}，等待 {wait}s 後重試 ({model})...")
                    time.sleep(wait)
                    continue
                last_error = f"{model} 過載超過重試次數"
                break  # 換下一個 model
            if resp.status_code == 404:
                last_error = f"{model} 404 not found"
                print(f"  Model {model} 不存在，換下一個")
                break
            if not resp.is_success:
                raise RuntimeError(f"Gemini {resp.status_code}: {resp.text[:200]}")
            # 取出文字，結構異常時換下一個 model
            try:
                return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
            except (KeyError, IndexError, TypeError) as e:
                last_error = f"{model} response 結構異常: {e}"
                print(f"  Model {model} response 結構異常，換下一個")
                break  # ← break 換下一個 model，不 raise
    raise RuntimeError(f"所有 Gemini 模型均失敗，最後錯誤：{last_error}")


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
        raw = re.sub(r"^```json\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"^```\s*", "", raw)
        raw = re.sub(r"```\s*$", "", raw).strip()
        result = _safe_json_loads(raw)
    except Exception as e:
        print(f"Gemini 回應解析失敗: {e}")
        result = {"avg_quality": None, "notes": "審查失敗，請手動確認"}

    # Save review record
    review = {
        "category_id": cat["id"],
        "model": GEMINI_MODELS[0],
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
