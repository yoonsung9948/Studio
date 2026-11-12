import { ArrowRight, Check, MapPin, Tag, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import type { Data } from "../../domain/types";
import { validVersion } from "../../domain/studio-selectors";
import { episodeContinuity } from "./episode-continuity";

export function ProductionContinuity({
  data,
  episodeId,
}: {
  data: Data;
  episodeId?: string;
}) {
  const episode = episodeId ? data.episodes[episodeId] : undefined;
  if (!episode)
    return (
      <section
        className="production-continuity"
        aria-label="Episode continuity"
      >
        <h2>Episode continuity</h2>
        <p className="production-continuity-empty">
          Create an episode to assign its cast, locations, and props.
        </p>
      </section>
    );

  const project = data.projects[episode.projectId];
  const base = `/projects/${project.id}/episodes/${episode.id}`;
  const number = String(project.episodeIds.indexOf(episode.id) + 1).padStart(
    2,
    "0",
  );
  const { cast, locations, props, notes } = episodeContinuity(data, episode.id);
  const sceneHref = (sceneId: string) => {
    const shotId = data.scenes[sceneId]?.shotIds.find(
      (id) => data.shots[id] && !data.shots[id].archived,
    );
    return shotId
      ? `${base}/shots/${shotId}?stage=scene`
      : `${base}?view=board&scene=${sceneId}`;
  };
  const usageLabel = (sceneIds: string[]) =>
    sceneIds.map((id) => data.scenes[id].title).join(" · ");
  const availableImage = (assetId?: string) => {
    const asset = data.assets[assetId ?? ""];
    return asset && !asset.missing && !asset.archived ? asset.url : undefined;
  };

  return (
    <section className="production-continuity" aria-label="Episode continuity">
      <header className="production-section-heading">
        <div>
          <h2>Episode continuity</h2>
          <p className="production-continuity-context" aria-live="polite">
            Episode {number} · {episode.title}
          </p>
        </div>
        <Link className="production-manage" to={`${base}?view=board`}>
          Open episode continuity <ArrowRight size={14} />
        </Link>
      </header>
      <div className="production-continuity-grid">
        <section className="production-reference production-cast">
          <h3>
            <UsersRound size={16} />
            Cast
          </h3>
          <div>
            {cast.map((entry) => {
              const character = data.characters[entry.id];
              const approved = character.canonicalVersionId
                ? validVersion(data, character.canonicalVersionId)
                : character.approved;
              const image =
                availableImage(
                  data.studio.versions[character.canonicalVersionId ?? ""]
                    ?.assetId,
                ) || character.reference;
              return (
                <Link key={entry.id} to={sceneHref(entry.sceneIds[0])}>
                  {image ? (
                    <img src={image} alt="" />
                  ) : (
                    <UsersRound size={30} />
                  )}
                  <div>
                    <b>{character.name}</b>
                    <small>
                      {entry.lookIds.length
                        ? entry.lookIds
                            .map((id) => data.studio.looks[id].name)
                            .join(" · ")
                        : "Identity reference"}
                    </small>
                    <span className={approved ? "is-approved" : ""}>
                      {approved && <Check size={15} />}
                      {approved ? "Approved" : "Needs review"}
                    </span>
                  </div>
                </Link>
              );
            })}
            {!cast.length && (
              <p className="production-continuity-empty">
                No cast assigned to this episode.
              </p>
            )}
          </div>
        </section>
        <section
          className="production-reference production-reference-list"
          aria-label="Episode locations"
        >
          <h3>
            <MapPin size={16} />
            Locations
          </h3>
          {locations.map((entry) => {
            const location = data.studio.locations[entry.id];
            const image =
              availableImage(location.assetId) ||
              availableImage(
                data.studio.versions[location.primaryVersionId ?? ""]?.assetId,
              );
            return (
              <Link key={entry.id} to={sceneHref(entry.sceneIds[0])}>
                {image && <img src={image} alt="" />}
                <b>{location.name}</b>
                <small>{usageLabel(entry.sceneIds)}</small>
              </Link>
            );
          })}
          {!locations.length && (
            <p className="production-continuity-empty">
              No location references assigned to this episode.
            </p>
          )}
        </section>
        <section
          className="production-reference production-reference-list"
          aria-label="Episode props"
        >
          <h3>
            <Tag size={16} />
            Props
          </h3>
          {props.map((entry) => {
            const prop = project.worldElements!.find(
              (item) => item.id === entry.id,
            )!;
            const image = availableImage(prop.assetId);
            return (
              <Link key={entry.id} to={sceneHref(entry.sceneIds[0])}>
                {image && <img src={image} alt="" />}
                <b>{prop.name}</b>
                <small>{usageLabel(entry.sceneIds)}</small>
              </Link>
            );
          })}
          {!props.length && (
            <p className="production-continuity-empty">
              No props assigned to this episode.
            </p>
          )}
        </section>
      </div>
      {!!notes.length && (
        <section
          className="production-continuity-notes"
          aria-label="Episode continuity notes"
        >
          {notes.map((note) => (
            <Link key={note.sceneId} to={sceneHref(note.sceneId)}>
              <b>{data.scenes[note.sceneId].title}</b>
              <span>{note.text}</span>
            </Link>
          ))}
        </section>
      )}
    </section>
  );
}
