import type { ReactNode } from "react";
import { Clapperboard } from "lucide-react";

export function ProductionFrame({
  title,
  description,
  saved,
  actions,
  cover,
  facts,
  children,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  saved?: ReactNode;
  actions: ReactNode;
  cover?: ReactNode;
  facts: { label: string; value: ReactNode }[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`production-page ${className}`}>
      <header className="production-heading">
        <div className="production-heading-copy">
          <div className="production-title">
            {title}
            {saved}
          </div>
          {description && (
            <div className="production-description">{description}</div>
          )}
        </div>
        <div className="production-heading-actions">{actions}</div>
      </header>
      <section className="production-hero" aria-label="Project overview">
        <div className="production-cover">
          {cover ?? <Clapperboard size={48} strokeWidth={1} />}
        </div>
        <div className="production-facts">
          <h2>Project overview</h2>
          <dl>
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      {children}
    </div>
  );
}
