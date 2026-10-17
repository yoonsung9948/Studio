import { BrandMark, BrandWordmark } from "../../components/Brand";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Apple, ArrowRight, Eye, EyeOff, Film, Sparkles } from "lucide-react";
import { useAccount } from "../../stores/account";
import { useStore } from "../../stores/store";
import { ProductPage } from "../marketing/ProductPage";
import { Button } from "../../components/ui/button";

function destination(value: unknown) {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    value.split(/[?#]/)[0] !== "/login" &&
    value !== "/app"
    ? value
    : "/projects";
}

export function DemoAuthGate({ children }: { children: ReactNode }) {
  const signedIn = useAccount((s) => s.signedIn);
  const location = useLocation();
  if (location.pathname === "/") {
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    return installed ? <Navigate to="/login" replace /> : <ProductPage />;
  }
  if (location.pathname === "/login") {
    return signedIn ? (
      <Navigate to={destination(location.state?.returnTo)} replace />
    ) : (
      <LoginPage />
    );
  }
  if (!signedIn)
    return (
      <Navigate
        to="/login"
        replace
        state={{
          returnTo: location.pathname + location.search + location.hash,
        }}
      />
    );
  if (location.pathname === "/app") return <Navigate to="/projects" replace />;
  return children;
}

export function LoginPage() {
  const [visible, setVisible] = useState(false);
  const theme = useStore((s) => s.ui.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const signIn = useAccount((s) => s.signIn);
  return (
    <main className="login-page">
      <section className="login-story" aria-label="Welcome to dotori studio">
        <Link to="/" className="login-brand" aria-label="dotori studio home">
          <BrandMark decorative />
          <BrandWordmark />
        </Link>
        <div className="login-story-copy">
          <span className="eyebrow">A LITTLE IDEA. A WHOLE NEW WORLD.</span>
          <h1>
            Your next story <br />
            starts here<span>.</span>
          </h1>
          <p>
            Find your characters. Set the scene.
            <br />
            Bring your episodes to life.
          </p>
        </div>
        <div className="login-filmstrip" aria-hidden="true">
          <div className="login-frame frame-one">
            <img src="/media/arrival.svg" alt="" />
            <span>01 / THE ARRIVAL</span>
          </div>
          <div className="login-frame frame-two">
            <img src="/media/message.svg" alt="" />
            <span>02 / A NEW DIRECTION</span>
          </div>
          <div className="login-film-note">
            <Film size={15} /> One scene at a time.
          </div>
        </div>
        <div className="login-story-footer">
          YOUR STORIES, IN MOTION <Sparkles size={15} />
        </div>
      </section>
      <section className="login-form-panel" aria-label="Sign in">
        <div className="login-form-wrap">
          <span className="account-kicker">YOUR STUDIO AWAITS</span>
          <h2>Welcome to dotori studio</h2>
          <p className="login-subtitle">
            A place for every story you want to tell.
          </p>
          <div className="login-social">
            <Button onClick={() => signIn()}>
              <span className="google-mark" aria-hidden="true">
                G
              </span>
              Sign in with Google
            </Button>
            <Button onClick={() => signIn()}>
              <Apple size={17} aria-hidden="true" />
              Sign in with Apple
            </Button>
          </div>
          <div className="login-divider">
            <span />
            or continue with email
            <span />
          </div>
          <form
            className="login-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              signIn(String(new FormData(e.currentTarget).get("email") || ""));
            }}
          >
            <label>
              Email
              <input
                name="email"
                type="text"
                inputMode="email"
                autoComplete="username"
                placeholder="you@studio.com"
              />
            </label>
            <label>
              Password
              <div className="login-password">
                <input
                  name="password"
                  aria-label="Password"
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter any password"
                />
                <button
                  type="button"
                  aria-label={visible ? "Hide password" : "Show password"}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            <Button type="submit" variant="default" className="login-submit">
              Sign in
              <ArrowRight size={17} />
            </Button>
          </form>
          <div className="login-demo-note">
            <span>DEMO ACCESS</span>
            <p>
              Any details work. Social sign-in is simulated.
              <br />
              No password is saved.
            </p>
          </div>
          <p className="login-bottom">From the first idea to the final cut.</p>
        </div>
      </section>
    </main>
  );
}
