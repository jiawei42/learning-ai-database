import { clsx } from "clsx";
import type { Category } from "@/types/database";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className, ...props }: InputProps) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && (
        <span className="text-sm font-medium text-[#9898b0]">{label}</span>
      )}
      <input
        {...props}
        className={clsx(
          "w-full px-3.5 py-2.5 rounded-xl text-sm",
          "bg-white/5 border border-white/10",
          "text-[#e8e8f0] placeholder:text-[#6060780]/80",
          "focus:outline-none focus:border-[#6366f1]/60 focus:bg-white/8",
          "transition-smooth",
          error && "border-red-500/60",
          className
        )}
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </label>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function Textarea({ label, className, ...props }: TextareaProps) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && (
        <span className="text-sm font-medium text-[#9898b0]">{label}</span>
      )}
      <textarea
        {...props}
        className={clsx(
          "w-full px-3.5 py-2.5 rounded-xl text-sm resize-none",
          "bg-white/5 border border-white/10",
          "text-[#e8e8f0] placeholder:text-[#9898b0]/60",
          "focus:outline-none focus:border-[#6366f1]/60 focus:bg-white/8",
          "transition-smooth",
          className
        )}
      />
    </label>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, options, className, ...props }: SelectProps) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && (
        <span className="text-sm font-medium text-[#9898b0]">{label}</span>
      )}
      <select
        {...props}
        className={clsx(
          "w-full px-3.5 py-2.5 rounded-xl text-sm",
          "bg-[#1e1e2c] border border-white/10",
          "text-[#e8e8f0]",
          "focus:outline-none focus:border-[#6366f1]/60",
          "transition-smooth",
          className
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── 階層分類選單（支援父子分類 optgroup）──────────────────────
interface CategorySelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  categories: Category[];
  placeholder?: string;
}

export function CategorySelect({
  label, categories, placeholder = "— 不分類 —", className, ...props
}: CategorySelectProps) {
  const roots    = categories.filter((c) => !c.parent_id);
  const children = (pid: string) => categories.filter((c) => c.parent_id === pid);

  const selectClass = clsx(
    "w-full px-3.5 py-2.5 rounded-xl text-sm",
    "bg-[#1e1e2c] border border-white/10",
    "text-[#e8e8f0]",
    "focus:outline-none focus:border-[#6366f1]/60",
    "transition-smooth",
    className,
  );

  return (
    <label className="flex flex-col gap-1.5">
      {label && <span className="text-sm font-medium text-[#9898b0]">{label}</span>}
      <select {...props} className={selectClass}>
        <option value="">{placeholder}</option>
        {roots.map((parent) => {
          const kids = children(parent.id);
          const label = `${parent.icon ?? ""} ${parent.name}`;
          if (kids.length === 0) {
            return (
              <option key={parent.id} value={parent.id}>
                {label}
              </option>
            );
          }
          return (
            <optgroup key={parent.id} label={label}>
              {/* 可直接選頂層 */}
              <option value={parent.id}>
                {parent.icon} {parent.name}（全部）
              </option>
              {kids.map((child) => (
                <option key={child.id} value={child.id}>
                  　└ {child.icon} {child.name}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </label>
  );
}
