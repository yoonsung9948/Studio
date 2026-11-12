import { installHomeProductions } from "../../mocks/home-productions";
import { installDirectorProject } from "../../mocks/director-project";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { IdentityContext } from "./identity";
import { destination } from "./Login";
import { ProductPage } from "../marketing/ProductPage";
import { activateWorkspace, useStore } from "../../stores/store";
import { useDirectorRequest } from "../../stores/director";
import { backendActivity } from "../../services/backend-activity";
import { interpretationWorkflow } from "../../services/interpretation";
import { backendJobObserver } from "../../services/job-observer";
import { useSelection } from "../../studio/selection";

/** No Clerk provider, backend account bootstrap or shared real-user storage. */
export function DevelopmentAuthGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (location.pathname === "/") {
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    return installed ? <Navigate to="/projects" replace /> : <ProductPage />;
  }
  if (
    /^\/(login|signup)(\/|$)/.test(location.pathname) ||
    location.pathname === "/app"
  )
    return (
      <Navigate
        to={destination(
          new URLSearchParams(location.search).get("redirect_url") ??
            location.state?.returnTo,
        )}
        replace
      />
    );
  return <DevelopmentWorkspace>{children}</DevelopmentWorkspace>;
}
function DevelopmentWorkspace({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    backendActivity.dispose();
    interpretationWorkflow.dispose();
    backendJobObserver.dispose();
    useDirectorRequest.setState({ prompt: null });
    useSelection.getState().replace([]);
    activateWorkspace("development-demo");
    useStore.getState().mutate((data) => {
      delete data.backend;
      installDirectorProject(data);
      installHomeProductions(data);
    });
    setReady(true);
    return () => {
      backendActivity.dispose();
      interpretationWorkflow.dispose();
      backendJobObserver.dispose();
      useDirectorRequest.setState({ prompt: null });
      useSelection.getState().replace([]);
      activateWorkspace(null);
    };
  }, []);
  if (!ready)
    return (
      <main className="auth-loading" role="status">
        Opening the local demo…
      </main>
    );
  const explain = () =>
    useStore
      .getState()
      .setNotice(
        "Local development access: disable VITE_AUTH_BYPASS and restart Vite to use Clerk sign-in.",
      );
  return (
    <IdentityContext.Provider
      value={{
        development: true,
        profile: { fullName: "Local developer", email: "", tier: "Starter" },
        signOut: async () => explain(),
        manageAccount: explain,
      }}
    >
      {children}
    </IdentityContext.Provider>
  );
}
