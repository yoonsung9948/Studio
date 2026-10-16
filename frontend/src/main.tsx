import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { PwaControls } from "./components/PwaControls";
import { DemoAuthGate } from "./features/account/Login";
import { App } from "./app/App";
import "./styles/index.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <PwaControls>
        <DemoAuthGate>
          <App />
        </DemoAuthGate>
      </PwaControls>
    </BrowserRouter>
  </StrictMode>,
);
