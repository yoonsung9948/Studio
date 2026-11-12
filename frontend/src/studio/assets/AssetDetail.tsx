import { LookAssignments } from "../references/LookAssignments";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useStore } from "../../stores/store";
import {
  assetSubject,
  objectOwner,
  viewSlots,
  type AssetSubject,
} from "../../domain/asset-library";
import { updateLook, bumpStudio } from "../../domain/studio-commands";
import { commit } from "../generation";
import { CharacterIdentity } from "./CharacterIdentity";
import { AssetViewStudio } from "./AssetViewStudio";
import { AssetUsage } from "./AssetUsage";
import { useAssetPath } from "./asset-navigation";
import "../../styles/assets-characters.css";
import "../../styles/asset-workspace.css";

function ObjectDetails({ subject }: { subject: AssetSubject }) {
  const [assigning, setAssigning] = useState(false);
  const data = useStore((s) => s.data),
    item = assetSubject(data, subject)!;
  const look =
    subject.kind === "look" ? data.studio.looks[subject.id] : undefined;
  const [name, setName] = useState(look?.name ?? item.name),
    [description, setDescription] = useState(item.description),
    [error, setError] = useState("");
  return (
    <form
      className="ac-panel av-details"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) {
          setError("Enter a name.");
          return;
        }
        if (
          commit((next) => {
            if (subject.kind === "look")
              updateLook(next, subject.id, { name: name.trim(), description });
            else {
              const owner = objectOwner(next, subject)!;
              if (owner.description !== description)
                owner.revision = (owner.revision ?? 1) + 1;
              owner.name = name.trim();
              owner.description = description;
              bumpStudio(next, item.projectId);
            }
          }, "Details saved")
        )
          setError("");
      }}
    >
      <h2>
        {subject.kind === "look" ? "Episode look details" : "Asset details"}
      </h2>
      <label className="ac-field">
        Name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
        />
      </label>
      <label className="ac-field">
        Description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={6}
          maxLength={3000}
        />
      </label>
      {subject.kind === "look" && look?.episodeId && (
        <div className="av-details-assign">
          <button
            type="button"
            className="ds-button"
            onClick={() => setAssigning(true)}
          >
            Assign to scenes
          </button>
          {assigning && (
            <LookAssignments
              episodeId={look.episodeId}
              lookId={look.id}
              onClose={() => setAssigning(false)}
            />
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="ds-button ds-primary"
        disabled={
          name === (look?.name ?? item.name) && description === item.description
        }
      >
        Save changes
      </button>
    </form>
  );
}

export function AssetDetail({
  subject,
  tab,
  type,
  onTab,
  onView,
  back,
  backLabel,
  episodeId,
}: {
  subject: AssetSubject;
  tab: string;
  type: string;
  onTab(value: string): void;
  onView(value: string): void;
  back: string;
  backLabel: string;
  episodeId?: string;
}) {
  const data = useStore((s) => s.data),
    path = useAssetPath(),
    item = assetSubject(data, subject);
  if (!item) return <div className="st-empty">Asset unavailable.</div>;
  const view = viewSlots(subject).some((slot) => slot.type === type)
    ? type
    : "front";
  const episode = episodeId ? data.episodes[episodeId] : undefined;
  return (
    <section
      className="ac-workspace av-workspace"
      aria-label={`${item.name} views workspace`}
      tabIndex={0}
    >
      <Link to={path(back)} className="av-back">
        <ArrowLeft size={17} />
        {backLabel}
      </Link>
      <header className="av-heading">
        <div>
          <h1>{item.name}</h1>
          <p>
            {episode
              ? `${episode.title} · ${subject.kind === "look" ? "Episode look" : "Episode reference"}`
              : `Reusable ${subject.kind}`}
          </p>
        </div>
        <a href="#asset-usage" className="ds-button">
          Linked usage ↓
        </a>
      </header>
      <nav className="ep-tabs" aria-label="Asset sections">
        {["views", "details"].map((value) => (
          <button
            key={value}
            aria-pressed={tab === value}
            onClick={() => onTab(value)}
          >
            {value === "views" ? "Views" : "Details"}
          </button>
        ))}
      </nav>
      {tab === "views" ? (
        <AssetViewStudio
          key={`${subject.kind}:${subject.id}:${view}`}
          subject={subject}
          type={view}
          onView={onView}
          episodeId={episodeId}
        />
      ) : (
        <>
          {subject.kind === "character" ? (
            <CharacterIdentity
              key={subject.id}
              data={data}
              character={data.characters[subject.id]}
              onViews={() => onTab("views")}
            />
          ) : (
            <ObjectDetails key={subject.id} subject={subject} />
          )}
          <AssetUsage data={data} subject={subject} episodeId={episodeId} />
        </>
      )}
    </section>
  );
}
