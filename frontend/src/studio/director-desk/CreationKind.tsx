import type { HomeRequest } from "../../services/home";
export type CreationKind = NonNullable<HomeRequest["creationKind"]>;
const choices: { value: CreationKind; label: string }[] = [
  { value: "episode", label: "Short film" },
  { value: "scene", label: "Scene" },
  { value: "shot", label: "Single shot" },
];
export function CreationKindPicker({
  value,
  onChange,
}: {
  value: CreationKind;
  onChange(value: CreationKind): void;
}) {
  return (
    <div className="dd-creation-kind" role="group" aria-label="What to create">
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          aria-pressed={value === choice.value}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
