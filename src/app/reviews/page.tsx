"use client";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Bot, Calendar, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { CategoryChip, QualityDots } from "@/components/ui/Badge";
import type { Review } from "@/types/database";

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("reviews")
      .select("*, category:categories(*)")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setReviews((data as Review[]) ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#e8e8f0]">審查紀錄</h1>
        <p className="text-sm text-[#9898b0] mt-1">AI 每日自動抽查一類內容的品質報告</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-36 w-full" />)}
        </div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-20 text-[#9898b0]">
          <p className="text-4xl mb-3">🤖</p>
          <p className="text-sm">尚無審查紀錄</p>
          <p className="text-xs mt-1">GitHub Actions 每天 21:00 自動執行</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex items-start gap-4">
                {/* Left icon */}
                <div className="w-10 h-10 rounded-xl bg-[#6366f1]/15 flex items-center justify-center shrink-0">
                  <Bot size={18} className="text-[#6366f1]" />
                </div>

                <div className="flex-1 space-y-3">
                  {/* Header row */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs font-medium text-[#e8e8f0]">{r.model}</span>
                    {r.category && (
                      <CategoryChip name={r.category.name} color={r.category.color} icon={r.category.icon} />
                    )}
                    <span className="flex items-center gap-1 text-xs text-[#9898b0]">
                      <CheckCircle2 size={12} />
                      審查 {r.items_checked} 筆
                    </span>
                    {r.avg_quality != null && (
                      <QualityDots score={Math.round(r.avg_quality)} />
                    )}
                    <span className="flex items-center gap-1 text-xs text-[#9898b0] ml-auto">
                      <Calendar size={12} />
                      {format(new Date(r.created_at), "yyyy/MM/dd HH:mm", { locale: zhTW })}
                    </span>
                  </div>

                  {/* Notes */}
                  {r.notes && (
                    <div className="border-t border-white/6 pt-3">
                      <p className="text-xs text-[#9898b0] leading-relaxed whitespace-pre-wrap">
                        {r.notes}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
