import {
  useState,
  type ReactNode,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import {
  Clock3,
  X,
  Check,
  ImageIcon,
  Video,
  Music,
  Search,
  MoreHorizontal,
  Upload,
  Archive,
  ArrowUpRight,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/dropdown-menu";

export const mediaFilters = [
  { id: "all", label: "All" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "renders", label: "Renders" },
  { id: "archive", label: "Archived" },
] as const;

export function LibraryToolbar({
  query,
  onQuery,
  filter,
  onFilter,
  onUpload,
  uploadDisabled,
  uploadHint,
  filters = mediaFilters,
  children,
}: {
  query: string;
  onQuery: (value: string) => void;
  filter: string;
  onFilter: (value: string) => void;
  onUpload?: () => void;
  uploadDisabled?: boolean;
  uploadHint?: string;
  filters?: readonly { id: string; label: string }[];
  children?: ReactNode;
}) {
  return (
    <div className="library-toolbar">
      <label className="library-search">
        <Search size={21} />
        <input
          aria-label="Search library"
          placeholder="Search media"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      <nav className="library-filters" aria-label="Media filters">
        {filters.map((item) => (
          <button
            key={item.id}
            aria-pressed={filter === item.id}
            onClick={() => onFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {onUpload && (
        <button
          className="library-upload"
          disabled={uploadDisabled}
          title={uploadHint}
          onClick={onUpload}
        >
          <Upload size={21} />
          Upload
        </button>
      )}
      {children}
    </div>
  );
}

export function LibraryCard({
  title,
  kind,
  category,
  selected,
  approval,
  missing,
  media,
  selectionKey,
  onSelect,
  onOpen,
  onArchive,
  archived,
  measureMedia = true,
  accessibleName,
  openLabel,
}: {
  title: string;
  kind: "image" | "video" | "audio";
  category?: string;
  selected: boolean;
  approval?: "approved" | "needs_review" | "rejected";
  missing?: boolean;
  media: ReactNode;
  selectionKey?: string;
  onSelect: (
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  ) => void;
  onOpen: () => void;
  onArchive?: () => void;
  archived?: boolean;
  measureMedia?: boolean;
  accessibleName?: string;
  openLabel?: string;
}) {
  const [dimensions, setDimensions] = useState("");
  const [duration, setDuration] = useState<number>();
  const Icon = kind === "video" ? Video : kind === "audio" ? Music : ImageIcon;
  return (
    <article
      className={`library-card ${selected ? "is-selected" : ""}`}
      data-selection-key={selectionKey}
      aria-label={accessibleName ?? `Media ${title}`}
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(event);
        }
      }}
    >
      <div
        className="library-card-preview"
        onLoadCapture={(event) => {
          if (!measureMedia || !(event.target instanceof HTMLImageElement))
            return;
          if (event.target.naturalWidth)
            setDimensions(
              `${event.target.naturalWidth} × ${event.target.naturalHeight}`,
            );
        }}
        onLoadedMetadataCapture={(event) => {
          if (!measureMedia || !(event.target instanceof HTMLMediaElement))
            return;
          const element = event.target;
          if (element instanceof HTMLVideoElement && element.videoWidth)
            setDimensions(`${element.videoWidth} × ${element.videoHeight}`);
          if (Number.isFinite(element.duration)) setDuration(element.duration);
        }}
      >
        {media}
        <span
          className={`library-media-mark ${selected ? "is-selected" : ""}`}
          aria-label={selected ? "Selected" : kind}
        >
          {selected ? <Check size={19} /> : <Icon size={20} />}
        </span>
        {duration != null && (
          <span className="library-duration">
            {Math.floor(duration / 60)
              .toString()
              .padStart(2, "0")}
            :
            {Math.floor(duration % 60)
              .toString()
              .padStart(2, "0")}
          </span>
        )}
      </div>
      <div className="library-card-info">
        <div className="library-card-heading">
          <h2 title={title}>
            <button
              aria-label={openLabel}
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
            >
              {title}
            </button>
          </h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="library-card-menu"
                aria-label={`Options for ${title}`}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal size={22} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenuItem onSelect={onOpen}>
                <ArrowUpRight size={15} />
                Open media details
              </DropdownMenuItem>
              {onArchive && (
                <DropdownMenuItem onSelect={onArchive}>
                  <Archive size={15} />
                  {archived ? "Restore media" : "Archive media"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="library-card-meta">
          {[
            category,
            kind[0].toUpperCase() + kind.slice(1),
            dimensions,
            duration != null ? `${Math.round(duration)}s` : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {missing ? (
          <p className="library-approval needs-review">Media unavailable</p>
        ) : (
          approval && (
            <p className={`library-approval ${approval}`}>
              <span>
                {approval === "approved" ? (
                  <Check size={16} />
                ) : approval === "rejected" ? (
                  <X size={16} />
                ) : (
                  <Clock3 size={16} />
                )}
              </span>
              {approval === "approved"
                ? "Approved"
                : approval === "rejected"
                  ? "Changes requested"
                  : "Ready to review"}
            </p>
          )
        )}
      </div>
    </article>
  );
}
