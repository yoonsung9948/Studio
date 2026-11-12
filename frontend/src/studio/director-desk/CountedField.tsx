import { useEffect, useState, type ComponentProps } from "react";
import { DraftField } from "../design/Primitives";

/** Keep draft character counts in sync before the shared autosave commits. */
export function CountedField(props: ComponentProps<typeof DraftField>) {
  const [length, setLength] = useState(props.value.length);
  useEffect(() => setLength(props.value.length), [props.value]);
  return (
    <div
      className="dd-counted-field"
      onChange={(event) => {
        if (
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLInputElement
        )
          setLength(event.target.value.length);
      }}
    >
      <DraftField {...props} />
      <small aria-live="off">
        {length}/{props.maxLength ?? 10000}
      </small>
    </div>
  );
}
