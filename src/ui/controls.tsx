import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export const ICON = { size: 17, strokeWidth: 1.7 } as const;

export function coordinateLabel(value: number, positive: string, negative: string): string {
  return Math.abs(value).toFixed(4) + "° " + (value >= 0 ? positive : negative);
}

interface ToggleRowProps {
  icon: ReactNode;
  title: string;
  caption: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleRow({ icon, title, caption, checked, onChange }: ToggleRowProps) {
  return (
    <label className="toggle-row">
      <span className="layer-icon" aria-hidden="true">{icon}</span>
      <span className="toggle-copy"><strong>{title}</strong><small>{caption}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={title} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

interface SegmentedProps<T extends string | number> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format: (value: T) => string;
}

/** Radio group styled as a segmented control. */
export function Segmented<T extends string | number>({ label, options, value, onChange, format }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option} type="button" role="radio" aria-checked={value === option} className={value === option ? "selected" : ""} onClick={() => onChange(option)}>
          {format(option)}
        </button>
      ))}
    </div>
  );
}

/** Collapsible group; all start collapsed. */
export function LayerGroup({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <details className="layer-group">
      <summary><span>{title}<small>{subtitle}</small></span><ChevronDown size={15} aria-hidden="true" /></summary>
      {children}
    </details>
  );
}

