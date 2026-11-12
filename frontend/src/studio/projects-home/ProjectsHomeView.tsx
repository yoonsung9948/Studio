import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Clapperboard,
  FolderClosed,
  Film,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";

export interface Production {
  id: string;
  title: string;
  cover?: string;
  subtitle: string;
  episodeCount?: number;
  cast: { name: string; image: string }[];
  updatedAt: number;
  href: string;
  editHref: string;
  worldHref?: string;
  libraryHref: string;
}
function productionSummary(production: Production) {
  if ((production.episodeCount ?? 0) <= 1) return "Short film · Draft";
  const episodes = `${production.episodeCount} episodes`;
  return production.cast.length
    ? `${episodes} · ${production.cast.length} cast members`
    : episodes;
}

function CastFaces({ cast }: { cast: Production["cast"] }) {
  if (!cast.length) return null;
  return (
    <div className="ph-faces" aria-label="Production cast">
      {cast.map((person, index) =>
        person.image ? (
          <img
            key={`${person.name}-${index}`}
            src={person.image}
            alt={person.name}
          />
        ) : (
          <span
            key={`${person.name}-${index}`}
            role="img"
            aria-label={person.name}
          >
            {person.name
              .split(/\s+/)
              .map((part) => part[0])
              .slice(0, 2)
              .join("")}
          </span>
        ),
      )}
    </div>
  );
}
function ProductionCard({ production }: { production: Production }) {
  return (
    <article
      className="ph-production"
      aria-label={`Project ${production.title}`}
    >
      <Link
        className="ph-production-open"
        to={production.href}
        aria-label={`Open ${production.title}`}
      >
        {production.cover ? (
          <img
            className="ph-production-image"
            src={production.cover}
            alt=""
            loading="lazy"
          />
        ) : (
          <div className="ph-cover-empty">
            <Film size={40} strokeWidth={1} />
          </div>
        )}
        <div className="ph-production-caption">
          <div>
            <h3>{production.title}</h3>
            <p>{productionSummary(production)}</p>
          </div>
        </div>
      </Link>
      <footer className="ph-production-footer">
        {production.worldHref && production.cast.length > 0 && (
          <Link
            to={production.worldHref}
            aria-label={`Manage cast for ${production.title}`}
            className="ph-cast-link"
          >
            <CastFaces cast={production.cast} />
          </Link>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="ph-project-menu"
            aria-label={`Options for ${production.title}`}
          >
            <MoreHorizontal size={21} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={production.editHref}>Continue editing</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to={production.href}>View project</Link>
            </DropdownMenuItem>
            {production.worldHref && (
              <DropdownMenuItem asChild>
                <Link to={production.worldHref}>Cast &amp; world</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link to={production.libraryHref}>Open library</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </footer>
    </article>
  );
}
export function ProjectsHomeView({
  productions,
  children,
  status,
  loadMore,
}: {
  productions: Production[];
  children: ReactNode;
  status?: ReactNode;
  loadMore?: ReactNode;
}) {
  const [sort, setSort] = useState("edited");
  const sorted = [...productions].sort((a, b) =>
    sort === "name"
      ? a.title.localeCompare(b.title)
      : b.updatedAt - a.updatedAt,
  );
  const current = [...productions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return (
    <div className="ph-page">
      <h1>Back to your stories.</h1>
      <div className="ph-feature-grid">
        <section className="ph-hero" aria-label="Continue production">
          {current ? (
            <>
              {current.cover && (
                <img className="ph-hero-image" src={current.cover} alt="" />
              )}
              <div className="ph-hero-content">
                <span className="ph-eyebrow">Continue production</span>
                <h2>{current.title}</h2>
                <p className="ph-episode-title">{current.subtitle}</p>
                <p className="ph-production-meta">
                  {productionSummary(current)}
                </p>
                <div className="ph-hero-actions">
                  <Link className="ph-primary" to={current.editHref}>
                    Continue editing
                    <ArrowRight size={18} />
                  </Link>
                  <Link className="ph-secondary" to={current.href}>
                    <FolderClosed size={22} strokeWidth={1.5} />
                    View project
                  </Link>
                </div>
              </div>
            </>
          ) : (
            <div className="ph-hero-content ph-hero-empty">
              <Clapperboard size={38} strokeWidth={1} />
              <span className="ph-eyebrow">Your director’s desk</span>
              <h2>
                A little idea.
                <br />A whole new world.
              </h2>
              <p>Your first production starts with a story.</p>
            </div>
          )}
        </section>
        <div className="ph-creation-column">{children}</div>
      </div>
      <section className="ph-productions" aria-label="Your productions">
        <header>
          <h2>Your productions</h2>
          <label className="ph-sort">
            <span>Sort by</span>
            <select
              aria-label="Sort productions"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="edited">Recently edited</option>
              <option value="name">Name A–Z</option>
            </select>
          </label>
        </header>
        {status}
        <div className="ph-production-grid">
          {sorted.map((production) => (
            <ProductionCard key={production.id} production={production} />
          ))}
        </div>
        {!productions.length && !status && (
          <p className="ph-empty">
            No productions yet. Start a film to make this space your own.
          </p>
        )}
        {loadMore}
      </section>
    </div>
  );
}
