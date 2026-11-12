import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Clapperboard,
  Layers,
  Pause,
  Play,
  UsersRound,
} from "lucide-react";
import { BrandMark, BrandWordmark } from "../../components/Brand";
import { demoMedia } from "../../mocks/demo-media";

const steps = [
  {
    title: "Shape your scene",
    label: "Scene",
    detail: "Describe your scene with simple tools built for filmmakers.",
  },
  {
    title: "Choose the frame",
    label: "Starting frame",
    detail: "Generate and choose the perfect starting frame.",
  },
  {
    title: "Direct the motion",
    label: "Motion",
    detail: "Guide the performance with precise, cinematic control.",
  },
  {
    title: "Make the edit",
    label: "Review",
    detail: "Refine and export a scene ready for your episode.",
  },
];
const frames = [demoMedia.maya, demoMedia.reunion, demoMedia.jun];
const screenplay = [
  "Rain streaks the window. Maya and Jun sit opposite each other.",
  "",
  "                MAYA",
  "       You kept it?",
  "",
  "                JUN",
  "  I couldn't throw it away.",
  "",
  "Maya slides the sealed letter across the table.",
];

function Filmstrip({ edit = false }: { edit?: boolean }) {
  return (
    <div
      className={`landing-filmstrip ${edit ? "is-edit" : ""}`}
      aria-hidden="true"
    >
      {[
        demoMedia.reunion,
        edit ? demoMedia.letter : demoMedia.jun,
        demoMedia.cafe,
      ].map((src, index) => (
        <div
          key={src}
          className={edit && index === 1 ? "is-selected" : undefined}
        >
          <img src={src} alt="" />
        </div>
      ))}
      <span className="landing-playhead" />
    </div>
  );
}

/** A local, explicitly labelled still-image preview; it never submits generation. */
function MotionPreview({ onExplore }: { onExplore(): void }) {
  const [playing, setPlaying] = useState(false),
    [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now() - progress * 5000;
    const timer = window.setInterval(() => {
      const next = Math.min(1, (performance.now() - start) / 5000);
      setProgress(next);
      if (next === 1) setPlaying(false);
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing]);
  return (
    <>
      <div className={`landing-motion-preview ${playing ? "is-playing" : ""}`}>
        <img
          src={demoMedia.reunion}
          alt="Maya and Jun in the café, illustrating motion direction"
          style={{ transform: `scale(${1 + progress * 0.06})` }}
        />
        <button
          aria-label={playing ? "Pause motion preview" : "Play motion preview"}
          onClick={() => {
            onExplore();
            if (progress === 1) setProgress(0);
            setPlaying(!playing);
          }}
        >
          {playing ? (
            <Pause fill="currentColor" size={22} />
          ) : (
            <Play fill="currentColor" size={24} />
          )}
        </button>
        {(playing || progress > 0) && (
          <>
            <span className="landing-preview-caption">Still-image preview</span>
            <progress
              aria-label="Motion preview progress"
              value={progress}
              max={1}
            />
          </>
        )}
      </div>
      <Filmstrip />
    </>
  );
}

export function ProductPage() {
  const [stage, setStage] = useState(0),
    [frame, setFrame] = useState(0);
  const explore = (index: number) => {
    setStage(index);
    document
      .getElementById(`workflow-${index + 1}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  return (
    <div className="ds-public landing-page" id="top">
      <a className="ds-skip" href="#product-content">
        Skip to content
      </a>
      <header className="ds-public-header landing-header">
        <Link
          to="/"
          className="ds-public-brand"
          aria-label="dotori studio home"
        >
          <BrandMark decorative />
          <BrandWordmark />
        </Link>
        <nav aria-label="Product navigation">
          <a href="#workflow">Workflow</a>
          <a href="#cast-continuity">Cast & continuity</a>
          <a href="#for-studios">For studios</a>
        </nav>
        <div className="landing-header-actions">
          <Link className="ds-button" to="/login">
            Sign in
          </Link>
          <Link className="ds-button ds-primary" to="/login">
            Start creating
            <ArrowRight size={19} />
          </Link>
        </div>
      </header>
      <main id="product-content">
        <section className="landing-hero" aria-labelledby="landing-title">
          <img
            className="landing-hero-image"
            src="/media/director-desk/projects-hero.png"
            alt="Maya and Jun meet in a warmly lit café on a rainy evening"
            fetchPriority="high"
          />
          <div className="landing-hero-shade" />
          <div className="landing-hero-copy">
            <h1 id="landing-title">
              A story worth telling.
              <br />A studio to make it.
            </h1>
            <p>
              Shape a scene, choose your starting frame,
              <br className="landing-desktop-break" /> and direct the motion.
            </p>
            <div className="landing-hero-actions">
              <Link className="ds-button ds-primary" to="/login">
                Start creating
                <ArrowRight size={21} />
              </Link>
              <a className="ds-button" href="#workflow">
                Explore the workflow
              </a>
            </div>
          </div>
          <aside
            className="landing-story"
            aria-label="Interactive storyboard preview"
          >
            <div className="landing-story-heading">
              <img src={demoMedia.maya} alt="" />
              <div>
                <h2>The reunion</h2>
                <p>Episode 03 · The Last Letter</p>
              </div>
            </div>
            <nav aria-label="Preview the workflow">
              {steps.map((step, index) => (
                <button
                  key={step.label}
                  aria-label={`${index + 1} ${step.label}`}
                  aria-current={stage === index ? "step" : undefined}
                  onClick={() => explore(index)}
                >
                  <span>{index + 1}</span>
                  <small>{step.label}</small>
                </button>
              ))}
            </nav>
          </aside>
        </section>
        <section
          className="landing-workflow"
          id="workflow"
          aria-label="Filmmaking workflow"
        >
          {steps.map((step, index) => (
            <article
              className="landing-workflow-card"
              key={step.title}
              id={`workflow-${index + 1}`}
              aria-label={step.title}
            >
              <header>
                <span>{index + 1}</span>
                <h2>
                  <button onClick={() => explore(index)}>{step.title}</button>
                </h2>
              </header>
              {index === 0 ? (
                <div
                  className="landing-screenplay"
                  aria-label="Example scene screenplay"
                >
                  <div>INT. CAFE — DUSK</div>
                  <ol>
                    {screenplay.map((line, index) => (
                      <li key={index}>
                        <span>{line || "\u00a0"}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : index === 1 ? (
                <div className="landing-frame-demo">
                  <img
                    className="landing-chosen-frame"
                    src={frames[frame]}
                    alt={`Starting frame ${String(frame + 1).padStart(2, "0")} preview`}
                  />
                  <div
                    className="landing-frame-choices"
                    role="group"
                    aria-label="Starting frame examples"
                  >
                    {frames.map((src, index) => (
                      <button
                        key={src}
                        aria-label={`Preview frame ${index + 1}`}
                        aria-pressed={frame === index}
                        onClick={() => {
                          setFrame(index);
                          setStage(1);
                        }}
                      >
                        <img src={src} alt="" />
                        {frame === index && (
                          <span>
                            <Check size={13} />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ) : index === 2 ? (
                <div className="landing-motion-demo">
                  <MotionPreview onExplore={() => setStage(2)} />
                </div>
              ) : (
                <div className="landing-edit-demo">
                  <div className="landing-edit-frame">
                    <img
                      src={demoMedia.letter}
                      alt="A sealed letter on the café table"
                    />
                  </div>
                  <Filmstrip edit />
                </div>
              )}
              <p>{step.detail}</p>
            </article>
          ))}
        </section>
        <section
          className="landing-benefits"
          aria-label="Made for your production"
        >
          <article id="cast-continuity">
            <UsersRound size={42} strokeWidth={1.1} />
            <div>
              <h2>Consistent cast</h2>
              <p>
                Keep characters, look, and mood consistent
                <br className="landing-desktop-break" /> across every scene and
                episode.
              </p>
            </div>
          </article>
          <article>
            <Clapperboard size={42} strokeWidth={1.1} />
            <div>
              <h2>Precise direction</h2>
              <p>
                Control camera, motion, and performance
                <br className="landing-desktop-break" /> with filmmaker-friendly
                tools.
              </p>
            </div>
          </article>
          <article id="for-studios">
            <Layers size={42} strokeWidth={1.1} />
            <div>
              <h2>Built for episodes</h2>
              <p>
                From scene to sequence, keep your story
                <br className="landing-desktop-break" /> organized and on track.
              </p>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
