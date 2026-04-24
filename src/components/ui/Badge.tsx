import { clsx } from "clsx";
import type { ItemType } from "@/types/database";

const typeLabel: Record<ItemType, string> = {
  news: "新聞",
  repo: "Repo",
  note: "筆記",
};

export function TypeBadge({ type }: { type: ItemType }) {
  return (
    <span className={clsx("tag-chip", `badge-${type}`)}>
      {typeLabel[type]}
    </span>
  );
}

export function QualityDots({ score }: { score: number | null }) {
  if (!score) return null;
  return (
    <span className="flex gap-0.5 items-center" title={`品質：${score}/5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={clsx(
            "w-1.5 h-1.5 rounded-full transition-smooth",
            i < score
              ? "bg-[#6366f1] shadow-[0_0_4px_rgba(99,102,241,0.5)]"
              : "bg-white/12"
          )}
        />
      ))}
    </span>
  );
}

export function CategoryChip({
  name,
  color,
  icon,
}: {
  name: string;
  color: string;
  icon?: string | null;
}) {
  return (
    <span
      className="tag-chip"
      style={{
        background: color + "1e",
        color,
        border: `1px solid ${color}35`,
      }}
    >
      {icon && <span>{icon}</span>}
      {name}
    </span>
  );
}
