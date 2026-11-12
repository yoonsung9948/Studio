import { productionSync } from "./production-sync";
import { uploadMedia } from "../api/media";
import { getAssetFileURL } from "../api/assets";
import { uid } from "../domain/types";
import { referenceEpisode } from "../domain/episode-characters";
import { attachEpisodeMedia } from "../domain/episode-resources";
import {
  generationInputs,
  saveGenerationInputs,
} from "../domain/generation-inputs";
import { currentWorkspaceEpoch, useStore } from "../stores/store";
import { saveMediaBlob } from "./media-storage";

/** Persist the file first, then attach media and generation references in one undoable change. */
export async function uploadSceneReference(sceneId: string, file: File) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    !file.size ||
    file.size > 20 * 1024 * 1024
  )
    throw Error("Choose a PNG, JPEG or WebP image under 20 MB.");
  const epoch = currentWorkspaceEpoch(),
    initial = useStore.getState().data,
    scene = initial.scenes[sceneId];
  if (!scene || scene.archived) throw Error("Scene unavailable.");
  const episode = referenceEpisode(initial, scene.episodeId);
  if (generationInputs(initial, sceneId).referenceInputs.length >= 12)
    throw Error("Use up to 12 additional references.");
  let id = uid("reference-upload");
  let remoteURL: string | undefined;
  if (productionSync()) {
    const result = await uploadMedia(
      file,
      crypto.randomUUID(),
      episode.projectId,
    );
    id = result.id;
    const original = result.files.find((f) => f.role === "original")!;
    remoteURL = (await getAssetFileURL(original.id)).url;
  } else await saveMediaBlob(id, file);
  if (currentWorkspaceEpoch() !== epoch)
    throw Error(
      "The workspace changed. Upload the image again in the current workspace.",
    );
  const url = remoteURL ?? URL.createObjectURL(file);
  const ok = useStore.getState().mutate((data) => {
    const current = data.scenes[sceneId];
    if (
      !current ||
      current.archived ||
      current.episodeId !== episode.id ||
      !data.episodes[episode.id]?.sceneIds.includes(sceneId)
    )
      throw Error("Scene unavailable.");
    referenceEpisode(data, episode.id);
    data.assets[id] = {
      id,
      projectId: episode.projectId,
      title: file.name,
      kind: "image",
      url,
      sessionOnly: !remoteURL,
      storedBlob: !remoteURL,
      serverAssetId: remoteURL ? id : undefined,
      provenance: "Uploaded scene reference",
    };
    attachEpisodeMedia(data, episode.id, id);
    saveGenerationInputs(data, sceneId, {
      referenceInputs: [
        ...generationInputs(data, sceneId).referenceInputs,
        { assetId: id, purpose: "visual_style" },
      ],
    });
  }, true);
  if (!ok) {
    URL.revokeObjectURL(url);
    throw Error(
      useStore.getState().notice || "The reference could not be attached.",
    );
  }
  useStore.getState().setNotice("Reference uploaded");
  return id;
}
