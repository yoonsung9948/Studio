import { BrandMark, BrandWordmark } from "../../components/Brand";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronRight,
  Layers3,
  Sparkles,
} from "lucide-react";

const scenes = [
  {
    title: "The arrival",
    image: "/media/arrival.svg",
    duration: "00:08",
    note: "A familiar place. An unexpected beginning.",
  },
  {
    title: "The message",
    image: "/media/message.svg",
    duration: "00:06",
    note: "One small detail changes the whole story.",
  },
  {
    title: "The discovery",
    image: "/media/discovery.svg",
    duration: "00:10",
    note: "Give the quiet moments room to unfold.",
  },
];

function Brand() {
  return (
    <Link to="/" className="product-brand" aria-label="dotori studio home">
      <BrandMark decorative />
      <BrandWordmark />
    </Link>
  );
}

export function ProductPage() {
  const [selected, setSelected] = useState(0);
  const scene = scenes[selected];
  return (
    <div className="product-page" id="top">
      <a className="product-skip" href="#product-content">
        Skip to content
      </a>
      <header className="product-header">
        <Brand />
        <nav aria-label="Product navigation">
          <a href="#workflow">How it works</a>
          <a href="#your-world">Your story world</a>
        </nav>
        <Link className="product-login" to="/login">
          Log in
          <ArrowRight size={15} />
        </Link>
      </header>
      <main id="product-content">
        <section className="product-hero product-container">
          <div className="product-hero-copy">
            <span className="product-eyebrow">
              <span /> AN EPISODE-FIRST FILM STUDIO
            </span>
            <h1>
              A story worth telling.
              <br />
              <em>A studio to make it.</em>
            </h1>
            <p>
              Turn a little idea into a whole new world. Write your episodes,
              build your cast, and shape every scene in one creative workspace.
            </p>
            <div className="product-hero-actions">
              <Link className="product-cta" to="/login">
                Explore the studio
                <ArrowRight size={17} />
              </Link>
              <a className="product-text-link" href="#workflow">
                Find your flow
                <ArrowDown size={15} />
              </a>
            </div>
            <span className="product-hero-caption">
              From your first scene to the next episode.
            </span>
          </div>
          <div
            className="product-preview"
            aria-label="Interactive storyboard preview"
          >
            <div className="product-preview-top">
              <span>
                <BrandMark decorative />
                dotori studio
              </span>
              <span>INTERACTIVE PREVIEW</span>
            </div>
            <div className="product-preview-workspace">
              <div className="product-preview-rail" aria-hidden="true">
                <Layers3 size={15} />
                <span />
                <span />
                <span />
              </div>
              <div className="product-preview-body">
                <div className="product-preview-heading">
                  <span>
                    MIDNIGHT SECRETS <ChevronRight size={10} /> EPISODE 01
                  </span>
                  <span className="product-saved">
                    <Check size={10} /> Draft
                  </span>
                </div>
                <div className="product-preview-title">
                  <h2>The unlocked door</h2>
                  <span>
                    Script <b>Scenes</b> Edit
                  </span>
                </div>
                <div className="product-scene-image">
                  <img
                    src={scene.image}
                    alt={`Illustrated storyboard for ${scene.title.toLowerCase()}`}
                  />
                  <span className="product-image-label">
                    SCENE {String(selected + 1).padStart(2, "0")}
                  </span>
                  <span className="product-image-duration">
                    {scene.duration}
                  </span>
                  <div>
                    <span>
                      EPISODE 01 / SCENE {String(selected + 1).padStart(2, "0")}
                    </span>
                    <h3>{scene.title}</h3>
                  </div>
                </div>
                <div
                  className="product-scene-picker"
                  role="group"
                  aria-label="Preview a scene"
                >
                  {scenes.map((s, i) => (
                    <button
                      key={s.title}
                      aria-label={`Preview ${s.title.toLowerCase()}`}
                      aria-pressed={selected === i}
                      onClick={() => setSelected(i)}
                    >
                      <img src={s.image} alt="" />
                      <span>
                        {String(i + 1).padStart(2, "0")}
                        <b>{s.title}</b>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="product-preview-note" aria-live="polite">
                  {scene.note}
                </p>
              </div>
            </div>
          </div>
        </section>
        <div className="product-principles product-container">
          <span>YOUR STORY. YOUR DIRECTION.</span>
          <p>
            One connected workflow.
            <span> A little less friction. A lot more filmmaking.</span>
          </p>
        </div>
        <section
          className="product-workflow product-container"
          id="workflow"
          aria-labelledby="workflow-heading"
        >
          <div className="product-section-heading">
            <span className="product-eyebrow">FROM IDEA TO EPISODE</span>
            <h2 id="workflow-heading">
              Make room for
              <br />
              <em>the creative part.</em>
            </h2>
            <p>
              Start with the story. Make the decisions that matter.
              <br />
              Keep every episode moving forward.
            </p>
          </div>
          <div className="product-steps">
            <article>
              <span className="product-step-number">01</span>
              <div>
                <h3>Find your story.</h3>
                <p>
                  Give your idea a home. Develop the script, shape the dialogue,
                  and build an episode you’re excited to make.
                </p>
              </div>
              <span className="product-step-tag">SCRIPT</span>
            </article>
            <article>
              <span className="product-step-number">02</span>
              <div>
                <h3>Set the scene.</h3>
                <p>
                  Break the episode into scenes. Review the action, timing, and
                  direction before moving into production.
                </p>
              </div>
              <span className="product-step-tag">SCENES</span>
            </article>
            <article>
              <span className="product-step-number">03</span>
              <div>
                <h3>Make it yours.</h3>
                <p>
                  Choose your cast, looks, settings, and visual references.
                  Review your takes and bring the right moments into the edit.
                </p>
              </div>
              <span className="product-step-tag">CREATE & EDIT</span>
            </article>
          </div>
        </section>
        <section
          className="product-world"
          id="your-world"
          aria-labelledby="world-heading"
        >
          <div className="product-container product-world-inner">
            <div
              className="product-world-art"
              aria-label="Example character looks"
            >
              <div className="product-character-card">
                <img
                  loading="lazy"
                  src="/media/studio-front.svg"
                  alt="Illustrated front portrait reference"
                />
                <span>
                  THE CHARACTER<b>Maya</b>
                </span>
              </div>
              <div className="product-look-card">
                <img
                  loading="lazy"
                  src="/media/studio-look-winter.svg"
                  alt="Illustrated winter wardrobe reference"
                />
                <span>
                  THE LOOK<b>Winter in the city</b>
                </span>
              </div>
              <span className="product-reference-label">
                <Layers3 size={13} />
                ONE WORLD. MANY STORIES.
              </span>
            </div>
            <div className="product-world-copy">
              <span className="product-eyebrow">A WORLD YOU CAN RETURN TO</span>
              <h2 id="world-heading">
                Same cast.
                <br />
                New possibilities.
              </h2>
              <p>
                Your characters don’t disappear when the episode ends. Build a
                library of identities, looks, and places, then choose the
                references that belong in each scene.
              </p>
              <ul>
                <li>
                  <Check size={15} />
                  Characters and looks in one place
                </li>
                <li>
                  <Check size={15} />
                  Scene-by-scene reference choices
                </li>
                <li>
                  <Check size={15} />
                  Space for your next episode
                </li>
              </ul>
              <Link className="product-text-link" to="/login">
                Meet your studio
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </section>
        <section
          className="product-questions product-container"
          aria-labelledby="questions-heading"
        >
          <span className="product-eyebrow">BEFORE YOUR FIRST TAKE</span>
          <h2 id="questions-heading">A few things to know.</h2>
          <details>
            <summary>
              Can I work on a series?<span>+</span>
            </summary>
            <p>
              Yes. Organize your work into projects and episodes, with a shared
              character and reference library for the story world.
            </p>
          </details>
          <details>
            <summary>
              Do I need filmmaking experience?<span>+</span>
            </summary>
            <p>
              The studio follows a guided Script → Scenes → Edit workflow. You
              can review the story and scene plans before choosing references
              and working with takes.
            </p>
          </details>
          <details>
            <summary>
              What can I try today?<span>+</span>
            </summary>
            <p>
              This is an interactive product demo. Explore the sample projects,
              write and plan episodes, and try the local production workflow.
              Sign-in, generation, credits, and recharge are simulated; no
              payment is collected.
            </p>
          </details>
        </section>
        <section className="product-invitation product-container">
          <Sparkles size={23} />
          <span className="product-eyebrow">YOUR STORIES, IN MOTION</span>
          <h2>
            Every great story
            <br />
            starts with <em>“what if?”</em>
          </h2>
          <Link className="product-cta" to="/login">
            Start your next story
            <ArrowRight size={17} />
          </Link>
          <p>Explore the demo. Make something your own.</p>
        </section>
      </main>
      <footer className="product-footer product-container">
        <Brand />
        <span>One scene at a time.</span>
        <a href="#top">Back to top ↑</a>
        <Link to="/login">Log in</Link>
      </footer>
    </div>
  );
}
