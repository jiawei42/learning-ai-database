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
    <span className="flex gap-0.5 items-center">
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={clsx(
            "w-1.5 h-1.5 rounded-full",
            i < score ? "bg-[#6366f1]" : "bg-white/15"
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
      style={{ background: color + "22", color }}
    >
      {icon && <span>{icon}</span>}
      {name}
    </span>
  );
}
