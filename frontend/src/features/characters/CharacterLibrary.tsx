import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus, MoreHorizontal, ArrowUpRight, Users } from "lucide-react";
import { useStore } from "../../stores/store";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../components/ui/dropdown-menu";
import { useActions } from "../../components/Actions";
import { SearchBox, NotFound } from "../Gallery";
import {
  createCharacter,
  deleteCharacter,
  duplicateCharacter,
  updateCharacter,
} from "../../domain/studio-commands";
import {
  characterLooks,
  characterStatus,
  versionAsset,
} from "../../domain/studio-selectors";
import { Portrait } from "./MediaVersions";
export function CharacterLibrary() {
  const { projectId = "" } = useParams();
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate),
    setUI = useStore((s) => s.setUI);
  const navigate = useNavigate(),
    modal = useActions();
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all");
  if (!d.projects[projectId]) return <NotFound />;
  const chars = Object.values(d.characters).filter(
    (c) =>
      c.projectId === projectId &&
      c.name.toLowerCase().includes(search.toLowerCase()) &&
      (status === "all" || characterStatus(d, c.id) === status),
  );
  const create = () => {
    let id = "";
    if (
      mutate((d) => {
        id = createCharacter(d, projectId);
      })
    ) {
      setUI({ aiOpen: true });
      navigate(`/projects/${projectId}/characters/${id}`);
    }
  };
  return (
    <div className="page cast-library">
      <div className="eyebrow">STORY / YOUR CAST</div>
      <header className="page-heading">
        <div>
          <h1>Characters</h1>
          <p>Manage your cast and their appearances.</p>
        </div>
        <Button variant="default" onClick={create}>
          <Plus size={15} />
          Create Character
        </Button>
      </header>
      <div className="filter-bar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search characters"
        />
        <select
          aria-label="Character status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {[
            "all",
            "Ready for scenes",
            "Draft",
            "Needs review",
            "Creating identity",
            "Creating references",
          ].map((x) => (
            <option key={x} value={x}>
              {x === "all" ? "All statuses" : x}
            </option>
          ))}
        </select>
      </div>
      <div className="cast-grid">
        {chars.map((c) => (
          <article className="cast-card" key={c.id}>
            <Link to={`/projects/${projectId}/characters/${c.id}`}>
              <Portrait
                src={versionAsset(d, c.canonicalVersionId)?.url}
                label={c.name}
              />
              <span className="open-cast">
                <ArrowUpRight size={17} />
              </span>
            </Link>
            <div className="cast-card-title">
              <Link to={`/projects/${projectId}/characters/${c.id}`}>
                <h2>{c.name}</h2>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Actions for ${c.name}`}
                  >
                    <MoreHorizontal size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem asChild>
                    <Link to={`/projects/${projectId}/characters/${c.id}`}>
                      Open
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      modal({
                        kind: "form",
                        title: "Rename character",
                        fields: [{ key: "name", label: "Name", value: c.name }],
                        submit: (v, d) => updateCharacter(d, c.id, v),
                      })
                    }
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      let id = "";
                      if (
                        mutate((d) => {
                          id = duplicateCharacter(d, c.id);
                        })
                      )
                        navigate(`/projects/${projectId}/characters/${id}`);
                    }}
                  >
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      modal({
                        kind: "confirm",
                        title: `Delete ${c.name}?`,
                        description:
                          "Remove this character and their Looks from the cast. Existing approved footage and immutable asset history are preserved.",
                        danger: true,
                        action: (d) => deleteCharacter(d, c.id),
                      })
                    }
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="cast-card-meta">
              <span>{characterLooks(d, c.id).length} Looks</span>
              <span
                className={`status ${characterStatus(d, c.id) === "Ready for scenes" ? "green" : "amber"}`}
              >
                {characterStatus(d, c.id)}
              </span>
            </div>
          </article>
        ))}
      </div>
      {!chars.length && (
        <div className="empty cast-empty">
          <Users size={28} />
          <h2>
            {search ? "No matching characters" : "Create your first character"}
          </h2>
          <p>Build a reusable character identity for your films.</p>
          <Button variant="default" onClick={create}>
            Create Character
          </Button>
        </div>
      )}
      <p className="studio-footnote">
        Identity is who they are. A Look is what they wear. References keep the
        story consistent.
      </p>
    </div>
  );
}
