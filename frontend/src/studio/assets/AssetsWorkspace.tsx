import { ServerCharacters } from "./ServerCharacters";
import { useOwnedData } from "../../services/server-data";
import { Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "../../stores/store";
import { createAssetCharacter } from "../../domain/asset-characters";
import {
  assetCategories,
  createLibraryObject,
  librarySubjects,
  type AssetSubject,
} from "../../domain/asset-library";
import { commit } from "../generation";
import { AssetGallery } from "./AssetGallery";
import { AssetDetail } from "./AssetDetail";
import "../../styles/assets-characters.css";
import "../../styles/asset-workspace.css";

export function AssetsWorkspace() {
  return useOwnedData() ? <ServerCharacters /> : <LocalAssetsWorkspace />;
}
function LocalAssetsWorkspace() {
  const data = useStore((s) => s.data),
    [params, setParams] = useSearchParams();
  const category =
    assetCategories.find((kind) => kind === params.get("kind")) ?? "characters";
  const subject: AssetSubject | undefined = params.get("character")
    ? { kind: "character", id: params.get("character")! }
    : params.get("look")
      ? { kind: "look", id: params.get("look")! }
      : params.get("asset")
        ? {
            kind: category === "places" ? "place" : "prop",
            id: params.get("asset")!,
          }
        : undefined;
  const update = (values: Record<string, string>, clear = false) => {
    const next = clear
      ? new URLSearchParams({ kind: category })
      : new URLSearchParams(params);
    if (params.get("mode")) next.set("mode", params.get("mode")!);
    Object.entries(values).forEach(([key, value]) => next.set(key, value));
    setParams(next);
  };
  const open = (item: AssetSubject, tab = "views") =>
    update(
      {
        [item.kind === "character"
          ? "character"
          : item.kind === "look"
            ? "look"
            : "asset"]: item.id,
        tab,
        q: params.get("q") ?? "",
      },
      true,
    );
  const create = () => {
    let item: AssetSubject | undefined;
    if (
      commit((next) => {
        item =
          category === "characters"
            ? { kind: "character", id: createAssetCharacter(next) }
            : createLibraryObject(next, category);
      }, "Asset created") &&
      item
    )
      open(item, "details");
  };
  if (subject)
    return (
      <AssetDetail
        subject={subject}
        tab={
          ["details", "identity"].includes(params.get("tab") ?? "")
            ? "details"
            : "views"
        }
        type={params.get("view") ?? "front"}
        onTab={(tab) => update({ tab })}
        onView={(view) => update({ view })}
        back={`/assets?kind=${category}&q=${encodeURIComponent(params.get("q") ?? "")}`}
        backLabel={category[0].toUpperCase() + category.slice(1)}
      />
    );
  return (
    <section
      className="ac-workspace ag-workspace"
      aria-label="Assets page"
      tabIndex={0}
    >
      <header className="av-heading">
        <div>
          <h1>Assets</h1>
          <p>Create reusable characters, places and props.</p>
        </div>
        <button className="ds-button ds-primary" onClick={create}>
          <Plus size={18} />
          New{" "}
          {category === "characters"
            ? "character"
            : category === "places"
              ? "place"
              : "prop"}
        </button>
      </header>
      <nav className="ep-tabs ac-category-tabs" aria-label="Asset categories">
        {assetCategories.map((kind) => (
          <button
            key={kind}
            aria-pressed={category === kind}
            onClick={() => update({ kind }, true)}
          >
            {kind[0].toUpperCase() + kind.slice(1)}
          </button>
        ))}
      </nav>
      <AssetGallery
        category={category}
        subjects={librarySubjects(data, category).map((item) => item.subject)}
        query={params.get("q") ?? ""}
        onQuery={(q) => update({ q })}
        onOpen={open}
        onCreate={create}
      />
    </section>
  );
}
