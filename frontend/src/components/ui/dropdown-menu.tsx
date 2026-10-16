import * as React from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export function DropdownMenuContent(
  props: React.ComponentProps<typeof DropdownPrimitive.Content>,
) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        className="dropdown"
        sideOffset={5}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}
export function DropdownMenuItem(
  props: React.ComponentProps<typeof DropdownPrimitive.Item>,
) {
  return <DropdownPrimitive.Item className="dropdown-item" {...props} />;
}
