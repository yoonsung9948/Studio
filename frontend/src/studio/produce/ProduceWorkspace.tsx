import { Check } from "lucide-react";
import { useProduce } from "./useProduce";
import { produceStages } from "../../domain/produce-route";
import { produceProgress } from "../../domain/produce";
import { SaveStatus } from "../design/SavingState";
import { ScenePlan } from "./ScenePlan";
import { ShotGeneration } from "./ShotGeneration";
import { FinalVideo } from "./FinalVideo";
import { EpisodeTitle } from "../episode-workflow/EpisodeTitle";
import "../../styles/produce.css";

export function ProduceWorkspace() {
  const context = useProduce();
  const { episode, project, stage, go } = context;
  if (
    context.invalidShotRoute ||
    !episode ||
    episode.archived ||
    !project ||
    project.archived ||
    episode.projectId !== project.id ||
    !project.episodeIds.includes(episode.id)
  )
    return (
      <div className="produce-empty">
        <h1>Episode unavailable</h1>
        <a href="/projects">Home</a>
      </div>
    );
  const complete = produceProgress(context.data, episode.id);
  return (
    <section
      className={`produce-workspace produce-stage-${stage}`}
      aria-label="Produce workspace"
    >
      <header className="produce-heading">
        <div>
          <EpisodeTitle episodeId={episode.id} title={episode.title} />
          <p>
            Episode{" "}
            {String(project.episodeIds.indexOf(episode.id) + 1).padStart(
              2,
              "0",
            )}{" "}
            · {project.title}
          </p>
        </div>
        <nav className="produce-stages" aria-label="Production stages">
          {produceStages.map((item, index) => (
            <button
              key={item.id}
              aria-label={item.label}
              aria-current={stage === item.id ? "step" : undefined}
              onClick={() => go(item.id)}
            >
              <span
                className={
                  complete[index] &&
                  index < produceStages.findIndex((s) => s.id === stage)
                    ? "is-complete"
                    : ""
                }
              >
                {complete[index] &&
                index < produceStages.findIndex((s) => s.id === stage) ? (
                  <Check size={16} />
                ) : (
                  index + 1
                )}
              </span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="produce-saving">
          <SaveStatus />
        </div>
      </header>
      {stage === "plan" ? (
        <ScenePlan context={context} />
      ) : stage === "final" ? (
        <FinalVideo context={context} />
      ) : (
        <ShotGeneration
          key={`${context.shot?.id}-${stage}`}
          context={context}
        />
      )}
    </section>
  );
}
