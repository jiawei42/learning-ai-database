import { clsx } from "clsx";

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
