import type { Data, CharacterReference, StudioData } from "../domain/types";
import { referenceTypes } from "../domain/studio-selectors";
export const emptyStudio = (): StudioData => ({
  looks: {},
  references: {},
  versions: {},
  locations: {},
  setups: {},
});
/** Additive v1 migration: preserve IDs, credits, timelines, takes, and existing descriptions. */
export function enhanceStudio(d: Data, demo = false): void {
  d.studio ??= emptyStudio();
  if (d.projects.midnight && !d.characters.emma)
    d.characters.emma = {
      id: "emma",
      projectId: "midnight",
      name: "Emma Wilson",
      description: "A witness with a story she is not ready to tell.",
      reference: "",
      approved: false,
    };
  for (const c of Object.values(d.characters)) {
    if (c.revision !== undefined) continue;
    c.revision = 1;
    c.role = c.id === "maya" ? "Protagonist" : "Supporting character";
    c.appearance = c.description;
    c.personality =
      c.id === "maya" ? "Reserved, observant, highly intelligent." : "";
    c.notes = "";
    c.createdAt = Date.now();
    c.updatedAt = Date.now();
    if (c.approved && c.reference) {
      const aid = `identity-asset-${c.id}`,
        vid = `identity-v1-${c.id}`;
      d.assets[aid] = {
        id: aid,
        projectId: c.projectId,
        title: `${c.name} · approved identity`,
        kind: "image",
        url: c.reference,
        provenance:
          "Migrated original storyboard identity placeholder; not generated photography.",
      };
      d.studio.versions[vid] = {
        id: vid,
        projectId: c.projectId,
        ownerKind: "identity",
        ownerId: c.id,
        assetId: aid,
        approval: "approved",
        revision: 1,
        specification: c.appearance,
        createdAt: 0,
      };
      c.canonicalVersionId = vid;
    }
    for (const type of referenceTypes) {
      const id = `${c.id}-${type}`;
      const r: CharacterReference = { id, characterId: c.id, type };
      d.studio.references[id] = r;
      if (type === "front" && c.canonicalVersionId) {
        r.activeVersionId = c.canonicalVersionId;
        d.studio.versions[c.canonicalVersionId].sourceIdentityVersionId =
          c.canonicalVersionId;
      } else if (
        c.canonicalVersionId &&
        ((c.id === "maya" && type !== "full_body_three_quarter") ||
          (c.id === "leo" && type === "three_quarter"))
      ) {
        const aid = `ref-asset-${id}`,
          vid = `ref-v1-${id}`;
        d.assets[aid] = {
          id: aid,
          projectId: c.projectId,
          title: `${c.name} · ${type} placeholder`,
          kind: "image",
          url: `/media/studio-${type}.svg`,
          provenance:
            "Labeled view diagram placeholder, not a generated angle of a performer.",
        };
        d.studio.versions[vid] = {
          id: vid,
          projectId: c.projectId,
          ownerKind: "reference",
          ownerId: id,
          assetId: aid,
          approval:
            c.id === "maya" && type === "profile" ? "needs_review" : "approved",
          revision: 1,
          sourceIdentityVersionId: c.canonicalVersionId,
          specification: type,
          createdAt: 0,
        };
        if (d.studio.versions[vid].approval === "approved")
          r.activeVersionId = vid;
      }
    }
    const names =
      c.id === "maya"
        ? ["Default", "Summer Casual", "Formal"]
        : c.id === "leo"
          ? ["Default", "Winter Outfit"]
          : ["Default"];
    names.forEach((name, i) => {
      const id = `${c.id}-look-${i}`;
      const l = (d.studio.looks[id] = {
        id,
        characterId: c.id,
        name,
        description:
          name === "Summer Casual"
            ? "White T-shirt, blue jeans, and sneakers."
            : name === "Formal"
              ? "A dark evening suit with understated jewelry."
              : name === "Winter Outfit"
                ? "Wool coat, dark scarf, and boots."
                : "Everyday appearance. Preserve the canonical identity.",
        styling: "Keep face and hairstyle unchanged.",
        notes: "",
        revision: 1,
        createdAt: 0,
        updatedAt: 0,
        primaryVersionId: undefined as string | undefined,
      });
      if (c.canonicalVersionId) {
        const vid = `look-v1-${id}`,
          aid = `look-asset-${id}`;
        d.assets[aid] = {
          id: aid,
          projectId: c.projectId,
          title: `${c.name} / ${name}`,
          kind: "image",
          url: `/media/studio-look-${name === "Summer Casual" ? "summer" : name === "Formal" ? "formal" : name === "Winter Outfit" ? "winter" : "default"}.svg`,
          provenance:
            "Original wardrobe diagram placeholder; not generated character footage.",
        };
        d.studio.versions[vid] = {
          id: vid,
          projectId: c.projectId,
          ownerKind: "look",
          ownerId: id,
          assetId: aid,
          approval: "approved",
          revision: 1,
          sourceIdentityVersionId: c.canonicalVersionId,
          specification: l.description,
          createdAt: 0,
        };
        l.primaryVersionId = vid;
      }
    });
  }
  if (d.projects.midnight && !d.studio.locations.apartment) {
    const id = "apartment-image";
    d.assets[id] = {
      id,
      projectId: "midnight",
      title: "Apartment · location reference",
      kind: "image",
      url: "/media/arrival.svg",
      provenance: "Original bundled storyboard location placeholder.",
    };
    d.studio.locations.apartment = {
      id: "apartment",
      projectId: "midnight",
      name: "Apartment",
      description:
        "A compact living room. Warm practical lighting, rain against the windows.",
      assetId: id,
      referenceAssetIds: [],
      revision: 1,
    };
  }
  for (const sc of Object.values(d.scenes)) {
    if (d.studio.setups[sc.id]) continue;
    const ids = [
      ...new Set(sc.shotIds.flatMap((id) => d.shots[id]?.characters ?? [])),
    ];
    d.studio.setups[sc.id] = {
      sceneId: sc.id,
      cast: ids.map((characterId) => ({
        characterId,
        lookId: `${characterId}-look-0`,
      })),
      locationMode: "inferred",
      direction: {
        time: "Evening",
        lighting: "Dim warm practical light",
        mood: "Suspenseful",
        style: "Cinematic realism",
        camera: "Slow controlled movement",
        notes: "",
      },
      targetSeconds: sc.shotIds.reduce(
        (n, id) => n + d.shots[id].targetFrames / 30,
        0,
      ),
      revision: 1,
    };
  }
  if (demo) {
    for (let i = 1; i <= 4; i++) {
      const setup = d.studio.setups[`ep1-s${i}`];
      if (!setup) continue;
      setup.locationMode = "selected";
      setup.locationId = "apartment";
      setup.cast =
        i === 4
          ? [{ characterId: "emma" }]
          : i === 2
            ? [
                { characterId: "maya", lookId: "maya-look-1" },
                { characterId: "leo", lookId: "leo-look-0" },
              ]
            : [
                {
                  characterId: "maya",
                  lookId: i === 3 ? "maya-look-2" : "maya-look-1",
                  ...(i === 3 ? { referenceIds: ["maya-profile"] } : {}),
                },
              ];
      for (const id of d.scenes[setup.sceneId].shotIds)
        d.shots[id].characters = setup.cast.map((a) => a.characterId);
    }
    if (d.shots["ep1-s2-q2"]) d.shots["ep1-s2-q2"].dependsOn = "ep1-s2-q1";
  }
}
