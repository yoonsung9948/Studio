import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Volume2,
  VolumeX,
  Film,
} from "lucide-react";
import { useStore } from "../stores/store";
import { timecode } from "../domain/selectors";
import { Button } from "../components/ui/button";
export function Player({
  shotIds,
  selectedId,
  onSelect,
  onTime,
}: {
  shotIds: string[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onTime?: (frame: number) => void;
}) {
  const d = useStore((s) => s.data);
  const [index, setIndex] = useState(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [mediaError, setMediaError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const shots = shotIds.map((id) => d.shots[id]).filter(Boolean);
  const selectedIndex = selectedId
    ? shots.findIndex((s) => s.id === selectedId)
    : -1;
  const i =
    selectedIndex >= 0 ? selectedIndex : Math.min(index, shots.length - 1);
  const shot = shots[i];
  const take = shot?.currentTakeId ? d.takes[shot.currentTakeId] : undefined;
  const asset = take ? d.assets[take.assetId] : undefined;
  const source = asset?.url || (shot ? d.scenes[shot.sceneId].cover : "");
  const frames = shot ? shot.outFrame - shot.inFrame : 150;
  const isVideo = asset?.kind === "video" && !asset.missing;
  const select = (n: number) => {
    setIndex(n);
    setFrame(0);
    if (shots[n]) onSelect?.(shots[n].id);
  };
  useEffect(() => {
    setFrame(0);
    setMediaError("");
  }, [shot?.id, take?.id]);
  useEffect(() => {
    if (!playing || isVideo) return;
    const t = setInterval(() => setFrame((f) => Math.min(frames, f + 3)), 100);
    return () => clearInterval(t);
  }, [playing, isVideo, frames]);
  useEffect(() => {
    onTime?.(frame);
    if (frame >= frames && playing) {
      if (i < shots.length - 1) select(i + 1);
      else {
        setPlaying(false);
        setFrame(0);
      }
    }
  }, [frame]);
  useEffect(() => {
    if (!isVideo || !video.current) return;
    if (playing)
      void video.current.play().catch(() => {
        setPlaying(false);
        setMediaError("Playback could not start. Press play to retry.");
      });
    else video.current.pause();
  }, [playing, isVideo, shot?.id]);
  if (!shot)
    return (
      <div className="empty">
        <Film />
        No shots to preview yet.
      </div>
    );
  return (
    <div
      className="player"
      tabIndex={0}
      aria-label="Scene preview; Space toggles playback"
      onKeyDown={(e) => {
        if (
          e.code === "Space" &&
          !(e.target instanceof HTMLInputElement) &&
          !(e.target instanceof HTMLButtonElement)
        ) {
          e.preventDefault();
          setPlaying(!playing);
        }
      }}
    >
      <div className="preview-stage">
        <div className="preview-label">
          <span className="live-dot" />{" "}
          {isVideo ? "Fixture video" : "Still-image animatic"}
        </div>
        <div className="film-frame">
          {isVideo ? (
            <video
              ref={video}
              src={source}
              muted={muted}
              playsInline
              onLoadedMetadata={() => {
                if (video.current)
                  video.current.currentTime = shot.inFrame / 30;
              }}
              onTimeUpdate={() =>
                setFrame(
                  Math.max(
                    0,
                    Math.round((video.current?.currentTime ?? 0) * 30) -
                      shot.inFrame,
                  ),
                )
              }
              onError={() => {
                setMediaError(
                  "Media unavailable. Reattach the source in Assets.",
                );
                setPlaying(false);
              }}
            />
          ) : (
            <img
              src={source}
              alt={`${d.scenes[shot.sceneId].title} storyboard placeholder`}
            />
          )}
          <div className="frame-caption">
            <span>
              {take ? "STORYBOARD TAKE" : "MISSING FOOTAGE · PLACEHOLDER"}
            </span>
            <p>{shot.dialogue || shot.title}</p>
          </div>
        </div>
        <div className="preview-corner">
          9:16 <span>1080 × 1920</span>
        </div>
      </div>
      {mediaError && (
        <p role="alert" className="error">
          {mediaError}
        </p>
      )}
      <div className="transport">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Previous shot"
          disabled={i === 0}
          onClick={() => select(i - 1)}
        >
          <ChevronLeft size={16} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Next shot"
          disabled={i === shots.length - 1}
          onClick={() => select(i + 1)}
        >
          <ChevronRight size={16} />
        </Button>
        <span className="timecode">
          {timecode(frame / 30)} <span>/ {timecode(frames / 30)}</span>
        </span>
        <input
          aria-label="Preview scrubber"
          type="range"
          min={0}
          max={Math.max(1, frames)}
          value={frame}
          onChange={(e) => {
            setFrame(+e.target.value);
            if (video.current)
              video.current.currentTime = (shot.inFrame + +e.target.value) / 30;
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={() => setMuted(!muted)}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </Button>
      </div>
    </div>
  );
}
