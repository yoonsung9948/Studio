/** Shared vocabulary for planning, take controls and saved generation settings. */
export const cameraMovements = [
  "Static",
  "Push in",
  "Pull out",
  "Pan left",
  "Pan right",
  "Tilt up",
  "Tilt down",
  "Tracking",
  "Handheld",
] as const;
export const cameraSpeeds = [
  "Slow and gentle",
  "Natural",
  "Fast and energetic",
] as const;
export const actionTimings = [
  "Slow and deliberate",
  "Natural real time",
  "Quick and energetic",
  "Slow motion",
] as const;
export const performanceTones = [
  "Subtle and restrained",
  "Warm and relaxed",
  "Tense and guarded",
  "Sad and vulnerable",
  "Confident and determined",
  "Surprised",
] as const;
export const gazeDirections = [
  "At the other character",
  "At the key prop",
  "Off camera",
  "Toward the camera",
  "Downward",
] as const;
