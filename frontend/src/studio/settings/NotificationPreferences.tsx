import { useStore } from "../../stores/store";
import { SettingsToggle } from "./SettingsControls";

const choices = [
  {
    id: "completed",
    label: "Generation completed",
    detail: "When a shot or video has finished generating.",
  },
  {
    id: "failed",
    label: "Generation failed",
    detail: "When a generation can't be completed.",
  },
  {
    id: "review",
    label: "Review requested",
    detail: "When a new take is ready for your review.",
  },
] as const;
export function NotificationPreferences() {
  const preferences = useStore((state) => state.ui.notifications) ?? {
    completed: true,
    failed: true,
    review: true,
  };
  return (
    <div className="settings-notification-options">
      {choices.map((choice) => (
        <SettingsToggle
          key={choice.id}
          label={choice.label}
          detail={choice.detail}
          checked={preferences[choice.id]}
          onChange={(checked) =>
            useStore
              .getState()
              .setUI({
                notifications: { ...preferences, [choice.id]: checked },
              })
          }
        />
      ))}
    </div>
  );
}
