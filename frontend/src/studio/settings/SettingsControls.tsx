import type { LucideIcon } from "lucide-react";

export function SettingsToggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="settings-toggle">
      <span>
        <b>{label}</b>
        {detail && <small>{detail}</small>}
      </span>
      <input
        role="switch"
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function SettingsChoices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; name: string; detail: string; icon: LucideIcon }[];
  onChange(value: T): void;
}) {
  return (
    <div className="settings-choices" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          aria-label={option.name}
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
        >
          <span className="settings-radio" />
          <option.icon size={31} strokeWidth={1.3} />
          <span>
            {option.name}
            <small>{option.detail}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
