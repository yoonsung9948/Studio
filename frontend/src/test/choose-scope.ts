import { fireEvent, screen, within } from "@testing-library/react";

/** Exercise the same keyboard-open and option-selection path as the custom picker. */
export function chooseScope(label: "Project" | "Episode", id: string) {
  fireEvent.keyDown(screen.getByLabelText(label), { key: "Enter" });
  const menu = within(screen.getByRole("menu", { name: label }));
  const option = menu
    .getAllByRole("menuitemradio")
    .find((item) => item.dataset.value === id);
  if (!option) throw new Error(`${label} option ${id} is unavailable.`);
  fireEvent.click(option);
}
