import { clsx } from "clsx";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ children, className, hover, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        "glass transition-smooth",
        hover && [
          "cursor-pointer",
          "hover:bg-white/[0.07] hover:border-white/[0.13]",
          "hover:-translate-y-0.5 hover:shadow-[0_8px_32px_rgba(0,0,0,0.25)]",
        ],
        onClick && "cursor-pointer",
        className
      )}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon,
  color = "#6366f1",
  accentClass,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
  accentClass?: string;
}) {
  return (
    <Card className={clsx("p-5 overflow-hidden", accentClass ?? "stat-accent-indigo")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[#9898b0] uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold mt-1.5 text-[#eeeef8] tabular-nums">{value}</p>
        </div>
        <div
          className="p-2.5 rounded-xl flex-shrink-0"
          style={{ background: color + "20", color }}
        >
          {icon}
        </div>
      </div>
    </Card>
  );
}
