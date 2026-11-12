import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { PwaControls } from "./components/PwaControls";
import { AuthenticationRoot } from "./features/account/ClerkAuth";
import { App } from "./app/App";
import { ApplicationCursor } from "./app/ApplicationCursor";
import { MouseHistoryNavigation } from "./app/MouseHistoryNavigation";
import "./styles/index.css";
import "./styles/director-desk.css";
import "./styles/projects-home.css";
import "./styles/studio-shell.css";
import "./styles/studio-system.css";
import "./styles/public.css";
import "./styles/library.css";
import "./styles/production.css";
import "./styles/scene-workspace.css";
import "./styles/film-workflow.css";
import "./styles/landing.css";
import "./styles/settings.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApplicationCursor />
    <BrowserRouter>
      <MouseHistoryNavigation />
      <PwaControls>
        <AuthenticationRoot>
          <App />
        </AuthenticationRoot>
      </PwaControls>
    </BrowserRouter>
  </StrictMode>,
);
