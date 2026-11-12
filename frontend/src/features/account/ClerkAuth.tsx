import { AccountDataProvider } from "../../services/server-data";
import { readAppConfiguration } from "../../config";
import { DevelopmentAuthGate } from "./DevelopmentAuth";
import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  useAuth,
  useClerk,
  useUser,
} from "@clerk/react";
import { shadcn } from "@clerk/ui/themes";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { LoginPage, destination } from "./Login";
import { ProductPage } from "../marketing/ProductPage";
import { IdentityContext } from "./identity";
import { configureApiSession } from "../../api/session";
import { bindBackendOwner } from "../../domain/interpretation";
import { useDirectorRequest } from "../../stores/director";
import { getAccount } from "../../api/accounts";
import { backendActivity } from "../../services/backend-activity";
import { activateWorkspace } from "../../stores/store";
import { useStore } from "../../stores/store";
import { interpretationWorkflow } from "../../services/interpretation";
import { backendJobObserver } from "../../services/job-observer";

const authFormAppearance: ComponentProps<typeof SignIn>["appearance"] = {
  elements: {
    rootBox: { width: "100%" },
    cardBox: { width: "100%", maxWidth: "100%", border: "none" },
  },
};

export function AuthenticationRoot({
  children,
  publishableKey,
}: {
  children: ReactNode;
  publishableKey?: string;
}) {
  const navigate = useNavigate(),
    location = useLocation();
  let config;
  try {
    config = readAppConfiguration();
  } catch (error) {
    return (
      <LoginPage
        authForm={
          <div role="alert">
            <h2>Configuration error</h2>
            <p>
              {error instanceof Error
                ? error.message
                : "Check application configuration."}
            </p>
          </div>
        }
      />
    );
  }
  if (config.authBypass)
    return <DevelopmentAuthGate>{children}</DevelopmentAuthGate>;
  publishableKey ??= config.publishableKey;
  if (!publishableKey) {
    if (location.pathname === "/") return <ProductPage />;
    return (
      <LoginPage
        authForm={
          <div role="alert">
            <h2>Sign-in setup required</h2>
            <p>
              Configure VITE_CLERK_PUBLISHABLE_KEY for this app, then restart
              the development server.
            </p>
          </div>
        }
      />
    );
  }
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/login"
      signUpUrl="/signup"
      signInFallbackRedirectUrl="/projects"
      signUpFallbackRedirectUrl="/projects"
      appearance={{
        theme: shadcn,
        variables: {
          // Clerk uses --accent internally; referencing it here creates a CSS cycle.
          colorPrimary: "#ffbf3f",
          colorPrimaryForeground: "var(--accent-foreground)",
          colorBackground: "var(--surface)",
          colorForeground: "var(--text)",
          colorInput: "var(--surface)",
          colorInputForeground: "var(--text)",
          colorMuted: "var(--raised)",
          colorMutedForeground: "var(--muted)",
          colorNeutral: "var(--text)",
          colorDanger: "#c44747",
          colorRing: "var(--accent)",
          borderRadius: "0.5rem",
        },
        elements: {
          cardBox: { boxShadow: "none", border: "1px solid var(--border)" },
          headerTitle: { fontSize: "22px" },
          headerSubtitle: { fontSize: "13px" },
          formButtonPrimary: { color: "var(--accent-foreground)" },
          socialButtonsBlockButton: { border: "1px solid var(--border)" },
          formFieldInput: {
            border: "1px solid var(--border)",
            backgroundColor: "var(--surface)",
          },
          footerActionLink: { color: "var(--accent)" },
        },
      }}
    >
      <ClerkAuthGate>{children}</ClerkAuthGate>
    </ClerkProvider>
  );
}

export function ClerkAuthGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const location = useLocation();
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  if (location.pathname === "/")
    return installed ? <Navigate to="/login" replace /> : <ProductPage />;
  if (!isLoaded)
    return (
      <main className="auth-loading" role="status">
        Loading your session…
      </main>
    );
  const returnTo = destination(
    new URLSearchParams(location.search).get("redirect_url") ??
      location.state?.returnTo,
  );
  const signingIn =
    location.pathname === "/login" || location.pathname.startsWith("/login/");
  const signingUp =
    location.pathname === "/signup" || location.pathname.startsWith("/signup/");
  if (signingIn || signingUp) {
    if (isSignedIn) return <Navigate to={returnTo} replace />;
    const query = `?redirect_url=${encodeURIComponent(returnTo)}`;
    return (
      <LoginPage
        authForm={
          signingUp ? (
            <SignUp
              appearance={authFormAppearance}
              routing="path"
              path="/signup"
              signInUrl={`/login${query}`}
              forceRedirectUrl={returnTo}
            />
          ) : (
            <SignIn
              appearance={authFormAppearance}
              routing="path"
              path="/login"
              signUpUrl={`/signup${query}`}
              forceRedirectUrl={returnTo}
            />
          )
        }
      />
    );
  }
  if (!isSignedIn || !userId || !sessionId)
    return (
      <Navigate
        to={`/login?redirect_url=${encodeURIComponent(location.pathname + location.search + location.hash)}`}
        replace
      />
    );
  if (location.pathname === "/app") return <Navigate to="/projects" replace />;
  return (
    <SignedInWorkspace key={`${userId}:${sessionId}`} userId={userId}>
      {children}
    </SignedInWorkspace>
  );
}

function SignedInWorkspace({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string;
}) {
  const { getToken } = useAuth(),
    { user } = useUser(),
    clerk = useClerk();
  const [ready, setReady] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const tokenGetter = useRef(getToken);
  tokenGetter.current = getToken;
  useLayoutEffect(() => {
    setReady(false);
    setError("");
    backendActivity.dispose();
    interpretationWorkflow.dispose();
    backendJobObserver.dispose();
    useDirectorRequest.setState({ prompt: null });
    activateWorkspace(null);
    const controller = new AbortController();
    const release = configureApiSession(() => tokenGetter.current());
    void getAccount(controller.signal)
      .then((account) => {
        if (controller.signal.aborted) return;
        activateWorkspace(account.id);
        useStore
          .getState()
          .mutate((data) => bindBackendOwner(data, account.id));
        setAccountId(account.id);
        setReady(true);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Could not open your account.",
          );
      });
    return () => {
      controller.abort();
      release();
      backendActivity.dispose();
      interpretationWorkflow.dispose();
      backendJobObserver.dispose();
      useDirectorRequest.setState({ prompt: null });
      activateWorkspace(null);
    };
  }, [userId, attempt]);
  if (error)
    return (
      <main className="auth-loading" role="alert">
        <p>{error}</p>
        <button onClick={() => setAttempt((value) => value + 1)}>Retry</button>
        <button onClick={() => clerk.signOut({ redirectUrl: "/login" })}>
          Sign out
        </button>
      </main>
    );
  if (!ready || !user)
    return (
      <main className="auth-loading" role="status">
        Opening your studio…
      </main>
    );
  return (
    <IdentityContext.Provider
      value={{
        profile: {
          fullName: user.fullName || user.username || "Your account",
          email: user.primaryEmailAddress?.emailAddress ?? "",
          imageUrl: user.imageUrl,
          tier: "Starter",
        },
        signOut: () => clerk.signOut({ redirectUrl: "/login" }),
        manageAccount: () => clerk.openUserProfile(),
      }}
    >
      <AccountDataProvider key={accountId} accountId={accountId}>
        {children}
      </AccountDataProvider>
    </IdentityContext.Provider>
  );
}
