import { SEA_OPTIONS, type SeaId } from "@/features/ocean/types/ocean";

interface SeaPickerProps {
  value: SeaId;
  name: string;
  label: string;
  disabled?: boolean;
  wide?: boolean;
  onChange: (seaId: SeaId) => void;
}

export function SeaPicker({ value, name, label, disabled = false, wide = false, onChange }: SeaPickerProps) {
  return (
    <div className={wide ? "sea-picker sea-picker--wide" : "sea-picker"} role="radiogroup" aria-label={label}>
      {SEA_OPTIONS.map((sea) => (
        <label
          key={sea.id}
          className={[
            "sea-chip",
            value === sea.id ? "sea-chip--selected" : "",
            disabled ? "sea-chip--disabled" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <input
            type="radio"
            name={name}
            value={sea.id}
            checked={value === sea.id}
            disabled={disabled}
            onChange={() => onChange(sea.id)}
          />
          <span>{sea.name}</span>
        </label>
      ))}
    </div>
  );
}
