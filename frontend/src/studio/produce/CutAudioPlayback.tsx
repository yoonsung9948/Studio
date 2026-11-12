import { useEffect, useRef } from "react";
import type { CutAudio } from "../../domain/cut-schema";
import { useStore } from "../../stores/store";

export function CutAudioPlayback({
  track,
  frame,
  playing,
  muted,
}: {
  track: CutAudio;
  frame: number;
  playing: boolean;
  muted: boolean;
}) {
  const asset = useStore((state) => state.data.assets[track.assetId]);
  const ref = useRef<HTMLAudioElement>(null);
  const active =
    frame >= track.startFrame &&
    frame < track.startFrame + track.outFrame - track.inFrame;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.volume = track.volume;
    const target = (track.inFrame + frame - track.startFrame) / 30;
    if (active && Math.abs(element.currentTime - target) > 0.15)
      element.currentTime = target;
    if (playing && active) void element.play().catch(() => {});
    else element.pause();
  }, [frame, active, playing, track.volume, track.inFrame, track.startFrame]);
  return (
    <audio
      ref={ref}
      src={asset?.url}
      muted={muted || track.muted}
      preload="metadata"
    />
  );
}
