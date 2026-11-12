import type { Data } from "./types";

/** The screenplay is authoritative once edited; legacy scenes retain their original text. */
export function sceneScreenplay(data: Data, sceneId: string) {
  const scene = data.scenes[sceneId];
  return (
    scene.screenplay ??
    [
      scene.settingDescription || "INT. SCENE — DAY",
      "",
      scene.description,
      ...scene.shotIds.flatMap((id) =>
        data.shots[id]?.dialogue ? ["", data.shots[id].dialogue] : [],
      ),
    ].join("\n")
  );
}
export function screenplayBeats(script: string) {
  return script
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .filter((line) => {
          const value = line.trim();
          return (
            value &&
            !/^(?:INT\.|EXT\.|INT\/EXT\.|VISUAL DIRECTION)/i.test(value) &&
            !/^[A-Z][A-Z\s.'-]{1,40}$/.test(value)
          );
        })
        .join(" ")
        .trim(),
    )
    .filter(Boolean);
}

/** Outline copy is a projection of the screenplay, never another editable story field. */
export function sceneOutlineSummary(data: Data, sceneId: string) {
  const text = screenplayBeats(sceneScreenplay(data, sceneId))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 160) return text;
  return `${text
    .slice(0, 157)
    .replace(/\s+\S*$/, "")
    .trimEnd()}…`;
}
