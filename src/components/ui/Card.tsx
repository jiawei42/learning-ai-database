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
        hover && "cursor-pointer hover:bg-white/[0.07] hover:border-white/15 hover:-translate-y-0.5",
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
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-[#9898b0]">{label}</p>
          <p className="text-2xl font-semibold mt-1 text-[#e8e8f0]">{value}</p>
        </div>
        <div
          className="p-2.5 rounded-xl"
          style={{ background: color + "22", color }}
        >
          {icon}
        </div>
      </div>
    </Card>
  );
}
