import { BrandMark, BrandWordmark } from "../../components/Brand";
import { useState, type ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Apple, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useAccount } from "../../stores/account";
import { ProductPage } from "../marketing/ProductPage";
import { Button } from "../../components/ui/button";

export function destination(value: unknown) {
  // Clerk normalizes return URLs to absolute URLs when switching auth screens.
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    try {
      const url = new URL(value);
      value =
        url.origin === window.location.origin
          ? url.pathname + url.search + url.hash
          : undefined;
    } catch {
      value = undefined;
    }
  }
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/^\/(login|signup)(\/|[?#]|$)/.test(value) &&
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

export function LoginPage({ authForm }: { authForm?: ReactNode } = {}) {
  const [visible, setVisible] = useState(false);
  const signIn = useAccount((s) => s.signIn);
  return (
    <div className="ds-public ds-auth">
      <header className="ds-public-header">
        <Link
          to="/"
          className="ds-public-brand"
          aria-label="dotori studio home"
        >
          <BrandMark decorative />
          <BrandWordmark />
        </Link>
        <Link className="ds-text" to="/">
          ← Back to site
        </Link>
      </header>
      <main className="ds-auth-layout">
        <section
          className="ds-auth-story"
          aria-label="Welcome to dotori studio"
        >
          <img
            src="/media/director-desk/projects-hero.png"
            alt="Maya and Jun meet in a warmly lit cafe on a rainy evening"
          />
          <div>
            <h1>Your stories, in motion.</h1>
            <p>
              From first idea to final frame, dotori studio helps you visualize,
              plan, and create cinematic stories.
            </p>
            <div className="ds-auth-filmstrip">
              {[
                ["The Last Letter", "/media/director-desk/projects-hero.png"],
                ["Night Shift", "/media/director-desk/night-shift.png"],
                ["Paper Planets", "/media/director-desk/paper-planets.png"],
              ].map(([name, image]) => (
                <figure key={name}>
                  <img src={image} alt="" />
                  <figcaption>{name}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
        <section className="ds-auth-form-panel" aria-label="Sign in">
          <div className={`ds-auth-card ${authForm ? "is-provider" : ""}`}>
            {authForm ?? (
              <>
                <BrandMark decorative />
                <h2>Welcome to dotori studio</h2>
                <p>Sign in to continue your stories.</p>
                <div className="ds-auth-social">
                  <Button onClick={() => signIn()}>
                    <span className="google-mark" aria-hidden="true">
                      G
                    </span>
                    Sign in with Google
                  </Button>
                  <Button onClick={() => signIn()}>
                    <Apple size={17} />
                    Sign in with Apple
                  </Button>
                </div>
                <div className="ds-auth-divider">
                  <span />
                  or continue with email
                  <span />
                </div>
                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    signIn(
                      String(new FormData(e.currentTarget).get("email") || ""),
                    );
                  }}
                >
                  <label className="ds-field">
                    Email
                    <input
                      name="email"
                      type="email"
                      autoComplete="username"
                      placeholder="you@studio.com"
                    />
                  </label>
                  <label className="ds-field">
                    Password
                    <div className="ds-auth-password">
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
                  <button className="ds-button ds-primary" type="submit">
                    Sign in
                    <ArrowRight size={17} />
                  </button>
                </form>
                <p className="ds-auth-demo-note">
                  Demo access · social sign-in is simulated. No password is
                  saved.
                </p>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
