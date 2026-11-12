import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Clapperboard } from "lucide-react";

interface HomeWelcomeProps {
  children: ReactNode;
  production?: { title: string; subtitle: string; cover: string; href: string };
}

/** Shared entry surface: connected accounts supply their own production or see an honest empty state. */
export function HomeWelcome({ children, production }: HomeWelcomeProps) {
  return (
    <section className="dd-home-welcome" aria-label="Your studio">
      <header>
        <span className="dd-eyebrow">YOUR STORIES, IN MOTION</span>
        <h2>Back to your stories.</h2>
        <p>A little idea. A whole new world.</p>
      </header>
      <div className="dd-home-hero-grid">
        <div className="dd-continue-production">
          {production ? (
            <>
              <img src={production.cover} alt="" />
              <div>
                <span className="dd-eyebrow">CONTINUE PRODUCTION</span>
                <h3>{production.title}</h3>
                <p>{production.subtitle}</p>
                <Link className="st-button st-primary" to={production.href}>
                  Continue editing <ArrowRight size={16} />
                </Link>
              </div>
            </>
          ) : (
            <div className="dd-new-story">
              <Clapperboard size={30} />
              <h3>Your next story starts here.</h3>
              <p>
                Describe an idea or paste a script. Shape the cast, the shots,
                and everything in between.
              </p>
            </div>
          )}
        </div>
        <div className="dd-home-create">
          <h3>What are we making?</h3>
          <p>Start with an idea, a scene, or a script.</p>
          {children}
        </div>
      </div>
    </section>
  );
}
