import { useId, useState } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Film, Folder } from "lucide-react";

export interface ThumbnailOption {
  id: string;
  label: string;
  image?: string;
}

function Thumbnail({
  src,
  kind,
}: {
  src?: string;
  kind: "Project" | "Episode";
}) {
  const [failed, setFailed] = useState<string>();
  const Icon = kind === "Project" ? Folder : Film;
  return (
    <span className="studio-scope-thumbnail" aria-hidden="true">
      {src && src !== failed ? (
        <img src={src} alt="" onError={() => setFailed(src)} />
      ) : (
        <Icon size={17} />
      )}
    </span>
  );
}

/** A shared, keyboard-accessible picker with thumbnails in normal document flow. */
export function ThumbnailDropdown({
  label,
  value,
  options,
  onSelect,
  onLoadMore,
}: {
  label: "Project" | "Episode";
  value?: string;
  options: ThumbnailOption[];
  onSelect(id: string): void;
  onLoadMore?: () => void;
}) {
  const valueId = useId();
  const selected = options.find((option) => option.id === value);
  const emptyLabel =
    label === "Project" ? "No projects yet" : "No episodes yet";
  return (
    <div className="studio-scope-field">
      <span className="studio-scope-field-label">{label}</span>
      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <button
            type="button"
            className="studio-scope-trigger"
            aria-label={label}
            aria-describedby={valueId}
            value={selected?.id ?? ""}
            disabled={!options.length}
          >
            <Thumbnail src={selected?.image} kind={label} />
            <span className="studio-scope-trigger-text" id={valueId}>
              {selected?.label ?? emptyLabel}
            </span>
            <ChevronDown
              className="studio-scope-chevron"
              size={15}
              aria-hidden="true"
            />
          </button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            className="studio-scope-menu"
            align="start"
            sideOffset={6}
            collisionPadding={10}
          >
            <Dropdown.RadioGroup value={selected?.id} onValueChange={onSelect}>
              {options.map((option) => (
                <Dropdown.RadioItem
                  className="studio-scope-option"
                  key={option.id}
                  value={option.id}
                  textValue={option.label}
                  data-value={option.id}
                >
                  <Thumbnail src={option.image} kind={label} />
                  <span className="studio-scope-option-text">
                    {option.label}
                  </span>
                  <span className="studio-scope-indicator">
                    <Dropdown.ItemIndicator>
                      <Check size={16} aria-hidden="true" />
                    </Dropdown.ItemIndicator>
                  </span>
                </Dropdown.RadioItem>
              ))}
            </Dropdown.RadioGroup>
            {onLoadMore && (
              <>
                <Dropdown.Separator className="studio-scope-separator" />
                <Dropdown.Item
                  className="studio-scope-load-more"
                  onSelect={(event) => {
                    event.preventDefault();
                    onLoadMore();
                  }}
                >
                  Load more projects…
                </Dropdown.Item>
              </>
            )}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  );
}
