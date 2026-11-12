import { z } from "zod";

const frames = z.number().int().nonnegative();
export const cutClipSchema = z.object({
  id: z.string(),
  shotId: z.string(),
  takeId: z.string(),
  inFrame: frames,
  outFrame: frames,
  volume: z.number().min(0).max(1),
});
export const cutAudioSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  title: z.string(),
  role: z.enum(["dialogue", "ambience", "music"]),
  startFrame: frames,
  inFrame: frames,
  outFrame: frames,
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
});
export const episodeCutSchema = z.object({
  revision: z.number().int().positive(),
  clips: z.array(cutClipSchema),
  audio: z.array(cutAudioSchema),
  captions: z.boolean(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
});
export type EpisodeCut = z.infer<typeof episodeCutSchema>;
export type CutClip = z.infer<typeof cutClipSchema>;
export type CutAudio = z.infer<typeof cutAudioSchema>;
