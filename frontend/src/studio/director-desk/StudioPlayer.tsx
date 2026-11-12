import { useEffect, useRef, useState } from "react";
import {
  Maximize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useStore } from "../../stores/store";
import { timecode } from "../../domain/selectors";
import { generationInputs } from "../../domain/generation-inputs";
import type { CutClip, CutAudio } from "../../domain/cut-schema";
import { CutAudioPlayback } from "../produce/CutAudioPlayback";

/** One transport for take review and the episode edit. Position is in timeline frames. */
export function StudioPlayer({
  shotIds,
  previewTakeId,
  position,
  onPositionChange,
  onSelect,
  timeline = false,
  cutClips,
  audio = [],
  captions = false,
  aspectRatio,
}: {
  shotIds: string[];
  previewTakeId?: string;
  position?: number;
  onPositionChange?(frame: number): void;
  onSelect?(shotId: string): void;
  timeline?: boolean;
  cutClips?: CutClip[];
  audio?: CutAudio[];
  captions?: boolean;
  aspectRatio?: string;
}) {
  const data = useStore((s) => s.data);
  const [localFrame, setLocalFrame] = useState(0),
    [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(true),
    [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const frame = position ?? localFrame;
  const clips = (
    cutClips ??
    shotIds.map((id) => ({
      shotId: id,
      takeId: "",
      inFrame: 0,
      outFrame: 0,
      volume: 1,
    }))
  ).flatMap((editClip) => {
    const id = editClip.shotId;
    const shot = data.shots[id];
    if (!shot || shot.archived) return [];
    const take =
      data.takes[
        (cutClips
          ? editClip.takeId
          : previewTakeId && data.takes[previewTakeId]?.shotId === id
            ? previewTakeId
            : (shot.currentTakeId ??
              (timeline ? undefined : shot.candidateTakeId) ??
              shot.imageTakeId)) ?? ""
      ];
    const asset = data.assets[take?.assetId ?? ""];
    const duration = cutClips
      ? editClip.outFrame - editClip.inFrame
      : timeline
        ? shot.outFrame - shot.inFrame
        : (take?.sourceFrames ?? shot.targetFrames);
    return [
      {
        shot,
        take,
        asset,
        duration,
        volume: cutClips ? editClip.volume : (shot.volume ?? 1),
        inFrame: cutClips ? editClip.inFrame : timeline ? shot.inFrame : 0,
      },
    ];
  });
  const total = clips.reduce((n, c) => n + c.duration, 0);
  let before = 0;
  let index = clips.findIndex((c) => {
    const end = before + c.duration;
    if (frame < end) return true;
    before = end;
    return false;
  });
  if (index < 0) {
    index = clips.length - 1;
    before = total - (clips[index]?.duration ?? 0);
  }
  const clip = clips[index],
    elapsed = Math.max(0, frame - before);
  const valid =
    !!clip?.asset?.url && !clip.asset.missing && !clip.asset.archived;
  const isVideo = valid && clip.asset.kind === "video";
  const source = valid
    ? clip.asset.url
    : data.scenes[clip?.shot.sceneId]?.cover;
  const seek = (next: number) => {
    const value = Math.max(
      0,
      Math.min(Math.max(0, total - 1), Math.round(next)),
    );
    if (position == null) setLocalFrame(value);
    onPositionChange?.(value);
  };
  const latest = useRef({ frame, total, seek });
  latest.current = { frame, total, seek };
  useEffect(() => {
    onSelect?.(clip?.shot.id ?? "");
  }, [clip?.shot.id]);
  useEffect(() => {
    setError("");
  }, [source]);
  useEffect(() => {
    if (!playing || isVideo) return;
    let timer = 0,
      previous = performance.now(),
      fractional = 0;
    const advance = (now: number) => {
      fractional += ((now - previous) * 30) / 1000;
      previous = now;
      if (fractional >= 1) {
        const step = Math.floor(fractional);
        fractional -= step;
        const next = latest.current.frame + step;
        if (next >= latest.current.total) {
          setPlaying(false);
          latest.current.seek(0);
          return;
        }
        latest.current.seek(next);
      }
      timer = requestAnimationFrame(advance);
    };
    timer = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(timer);
  }, [playing, isVideo]);
  useEffect(() => {
    const element = video.current;
    if (!isVideo || !element) return;
    element.volume = clip.volume;
    if (playing)
      void element.play().catch(() => {
        setPlaying(false);
        setError("Playback could not start. Press play to retry.");
      });
    else element.pause();
  }, [playing, source, isVideo, clip?.shot.id, clip?.volume]);
  useEffect(() => {
    const element = video.current;
    const target = ((clip?.inFrame ?? 0) + elapsed) / 30;
    if (element && Math.abs(element.currentTime - target) > 0.18)
      element.currentTime = target;
  }, [frame, source]);
  const ratio =
    aspectRatio ??
    (clip
      ? generationInputs(data, clip.shot.sceneId, clip.shot.id).aspectRatio
      : "16:9");
  if (!clip)
    return (
      <div className="studio-player-empty">
        Add media or shots to preview your episode.
      </div>
    );
  return (
    <div
      className="studio-player"
      ref={root}
      tabIndex={0}
      aria-label="Scene preview; Space toggles playback"
      onKeyDown={(event) => {
        if (event.code === "Space" && event.target === event.currentTarget) {
          event.preventDefault();
          setPlaying(!playing);
        }
      }}
    >
      <div
        className="studio-player-screen"
        style={{ aspectRatio: ratio.replace(":", " / ") }}
      >
        {audio.map((track) => (
          <CutAudioPlayback
            key={track.id}
            track={track}
            frame={frame}
            playing={playing}
            muted={muted}
          />
        ))}
        {isVideo ? (
          <video
            key={`${clip.shot.id}-${source}`}
            ref={video}
            src={source}
            muted={muted}
            playsInline
            preload="metadata"
            onLoadedMetadata={() => {
              if (video.current)
                video.current.currentTime = (clip.inFrame + elapsed) / 30;
            }}
            onTimeUpdate={() => {
              if (!playing || !video.current) return;
              const next =
                Math.round(video.current.currentTime * 30) - clip.inFrame;
              if (next >= clip.duration) {
                if (index + 1 < clips.length) seek(before + clip.duration);
                else {
                  setPlaying(false);
                  seek(0);
                }
              } else seek(before + Math.max(0, next));
            }}
            onEnded={() => {
              if (index + 1 < clips.length) seek(before + clip.duration);
              else {
                setPlaying(false);
                seek(0);
              }
            }}
            onError={() => {
              setPlaying(false);
              setError(
                "This video could not be loaded. Choose another take or reattach its media.",
              );
            }}
          />
        ) : source ? (
          <img
            src={source}
            alt={`${data.scenes[clip.shot.sceneId].title} take preview`}
          />
        ) : (
          <div className="studio-player-empty">
            No footage for this shot yet.
          </div>
        )}
        {!playing && (
          <button
            className="studio-player-overlay"
            aria-label="Play preview"
            onClick={() => setPlaying(true)}
          >
            <Play fill="currentColor" size={31} />
          </button>
        )}
        {captions && clip.shot.dialogue && (
          <div className="produce-caption">{clip.shot.dialogue}</div>
        )}
        {!isVideo && (
          <span className="studio-player-mode">
            {valid ? "Still-image animatic" : "Draft preview"}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="studio-player-error">
          {error}
        </p>
      )}
      <div className="studio-player-transport">
        <button
          className="ds-icon"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? (
            <Pause size={21} />
          ) : (
            <Play size={21} fill="currentColor" />
          )}
        </button>
        {timeline && (
          <>
            <button
              className="ds-icon"
              aria-label="Previous shot"
              disabled={index === 0}
              onClick={() => seek(before - (clips[index - 1]?.duration ?? 0))}
            >
              <SkipBack size={19} />
            </button>
            <button
              className="ds-icon"
              aria-label="Next shot"
              disabled={index === clips.length - 1}
              onClick={() => seek(before + clip.duration)}
            >
              <SkipForward size={19} />
            </button>
          </>
        )}
        <span className="studio-player-time">
          {timecode(frame / 30)} <span>/ {timecode(total / 30)}</span>
        </span>
        <input
          aria-label="Preview scrubber"
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={Math.min(frame, Math.max(0, total - 1))}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <button
          className="ds-icon"
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={() => setMuted(!muted)}
        >
          {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
        <button
          className="ds-icon"
          aria-label="Full screen player"
          onClick={() =>
            void root.current
              ?.requestFullscreen?.()
              .catch(() =>
                useStore
                  .getState()
                  .setNotice("Full screen is unavailable in this browser."),
              )
          }
        >
          <Maximize size={20} />
        </button>
      </div>
    </div>
  );
}
