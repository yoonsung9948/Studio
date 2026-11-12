import {
  ArrowUpRight,
  Check,
  Circle,
  Film,
  MoreHorizontal,
  Sparkles,
  Play,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../../stores/store";
import { shotAsset, shotStatus } from "../../domain/workspace";
import { useCommands } from "../commands";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../components/ui/dropdown-menu";
import { boardShotStatus } from "./scene-presentation";
import { shotUrl } from "../director-desk/SceneRail";
export function CompactShot({
  shotId,
  onSelect,
}: {
  shotId: string;
  onSelect(): void;
}) {
  const data = useStore((state) => state.data),
    navigate = useNavigate(),
    { execute } = useCommands();
  const shot = data.shots[shotId],
    scene = data.scenes[shot.sceneId],
    episode = data.episodes[scene.episodeId];
  const asset = shotAsset(data, shot),
    status = boardShotStatus(data, shot),
    draft = shotStatus(data, shot) === "Draft";
  const open = () =>
    navigate(
      shotUrl(
        episode.projectId,
        episode.id,
        shot.id,
        draft
          ? "scene"
          : shot.candidateTakeId || shot.currentTakeId
            ? "review"
            : "frame",
      ),
    );
  const generation = `${draft ? "generate" : "animate"}:${shot.id}`;
  return (
    <>
      <div className="sb-shot-thumbnail">
        {asset?.url && !asset.missing ? (
          asset.kind === "video" ? (
            <video src={asset.url} muted playsInline preload="metadata" />
          ) : (
            <img
              src={asset.url}
              alt={`${shot.title} thumbnail`}
              loading="lazy"
            />
          )
        ) : scene.cover ? (
          <img src={scene.cover} alt="" loading="lazy" />
        ) : (
          <Film size={24} />
        )}
      </div>
      <div className="sb-shot-copy">
        <div className="sb-shot-heading">
          <span>
            {String(scene.shotIds.indexOf(shot.id) + 1).padStart(2, "0")}
          </span>
          <b title={shot.title}>{shot.title}</b>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`Options for ${shot.title}`}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal size={21} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenuItem onSelect={open}>
                Open shot <ArrowUpRight size={14} />
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => execute(`generate:${shot.id}`)}>
                Generate still · 8 cr
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => execute(`animate:${shot.id}`)}>
                Animate · 24 cr
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  onSelect();
                  execute("selection.lock");
                }}
              >
                {shot.locked ? "Unlock shot" : "Lock shot"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <small>{Number((shot.targetFrames / 30).toFixed(1))}s</small>
        <span className={`sb-shot-status ${status.tone}`}>
          {status.tone === "success" ? (
            <Check size={15} />
          ) : (
            <Circle size={14} />
          )}
          {status.label}
        </span>
        <button
          className="sb-quick-generate"
          aria-label={draft ? "Generate · 8 cr" : "Animate · 24 cr"}
          title={
            draft ? "Generate starting frame · 8 cr" : "Generate video · 24 cr"
          }
          onClick={(event) => {
            event.stopPropagation();
            execute(generation);
          }}
        >
          {draft ? <Sparkles size={15} /> : <Play size={15} />}
        </button>
      </div>
    </>
  );
}
