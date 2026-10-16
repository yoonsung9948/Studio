import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactNode, CSSProperties } from "react";
export function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  onReorder: (ids: string[]) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id)
          onReorder(
            arrayMove(
              ids,
              ids.indexOf(String(active.id)),
              ids.indexOf(String(over.id)),
            ),
          );
      }}
    >
      <SortableContext items={ids}>{children}</SortableContext>
    </DndContext>
  );
}
export function SortableItem({
  id,
  children,
  className = "",
  style,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`${className} ${isDragging ? "dragging" : ""}`}
      style={{
        ...style,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <button
        className="drag-handle"
        aria-label="Drag to reorder; press Space then arrow keys"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={15} />
      </button>
      {children}
    </div>
  );
}
