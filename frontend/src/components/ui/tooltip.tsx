import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
export function Tip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={350}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className="tooltip" sideOffset={6}>
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
