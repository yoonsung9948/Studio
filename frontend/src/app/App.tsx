import { ProductionProvider } from "../services/ProductionProvider";
import { BillingCheckout } from "../features/billing/Checkout";
import { ReferenceViewsWorkspace } from "../studio/references/ReferenceViewsWorkspace";
import { EpisodeLookWorkspace } from "../studio/references/EpisodeLookWorkspace";
import { EpisodeResources, AssetsWorkspace } from "../studio/EpisodeResources";
import { SettingsWorkspace } from "../studio/SettingsWorkspace";
import { ProduceWorkspace } from "../studio/produce/ProduceWorkspace";
import { LookGenerationWorkspace } from "../studio/LookGeneration";
import { useEffect } from "react";
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import { ActionsProvider } from "../components/Actions";
import { CommandProvider } from "../studio/commands";
import { GenerationProvider } from "../studio/generation";
import { StudioShell } from "../studio/StudioShell";
import { LegacyEpisodeRedirect } from "../studio/EpisodeWorkspace";
import { useStudio } from "../studio/selection";
import {
  HomeWorkspace,
  WorkBrowser,
  ProjectWorkspace,
  ProjectsWorkspace,
} from "../studio/Home";
import { NotFound } from "../features/Gallery";
import { WorldWorkspace } from "../studio/World";
import { LibraryWorkspace } from "../studio/Library";
import "../styles/studio.css";
function LegacyProject({ tab }: { tab: string }) {
  const { projectId, characterId } = useParams();
  return (
    <Navigate
      replace
      to={
        tab === "notes"
          ? `/projects/${projectId}/world?kind=note&id=bible-${projectId}`
          : `/projects/${projectId}/${tab}${characterId ? `?kind=character&id=${characterId}` : ""}`
      }
    />
  );
}
function LegacyDialog({
  settings = false,
  account = false,
}: {
  settings?: boolean;
  account?: boolean;
}) {
  const { projectId } = useParams(),
    navigate = useNavigate();
  useEffect(() => {
    useStudio
      .getState()
      .set(
        account
          ? { account: true }
          : settings
            ? { settings: true }
            : { activity: true },
      );
    navigate(projectId ? `/projects/${projectId}/episodes` : "/projects", {
      replace: true,
    });
  }, [projectId, navigate, settings, account]);
  return null;
}
export function App() {
  return (
    <ActionsProvider>
      <CommandProvider>
        <ProductionProvider>
          <GenerationProvider>
            <StudioShell>
              <Routes>
                <Route path="/" element={<Navigate to="/projects" replace />} />
                <Route
                  path="/app"
                  element={<Navigate to="/projects" replace />}
                />
                <Route path="/projects" element={<HomeWorkspace />} />
                <Route
                  path="/billing/checkout/:purchaseId"
                  element={<BillingCheckout />}
                />
                <Route path="/assets" element={<AssetsWorkspace />} />
                <Route
                  path="/projects/:projectId/episodes/:episodeId/references/:category/:assetId/views"
                  element={<ReferenceViewsWorkspace />}
                />
                <Route
                  path="/projects/:projectId/episodes/:episodeId/references/characters/:characterId/looks/:lookId"
                  element={<EpisodeLookWorkspace />}
                />
                <Route
                  path="/projects/:projectId/episodes/:episodeId/references"
                  element={<EpisodeResources section="references" />}
                />
                <Route
                  path="/projects/:projectId/episodes/:episodeId/media"
                  element={<EpisodeResources section="media" />}
                />
                <Route path="/work" element={<WorkBrowser />} />
                <Route path="/library" element={<LibraryWorkspace />} />
                <Route path="/settings" element={<SettingsWorkspace />} />
                <Route
                  path="/projects/browse"
                  element={<ProjectsWorkspace />}
                />
                <Route
                  path="/projects/:projectId"
                  element={<LegacyProject tab="episodes" />}
                />
                <Route
                  path="/projects/:projectId/episodes"
                  element={<ProjectWorkspace />}
                />
                <Route
                  path="/projects/:projectId/episodes/:episodeId"
                  element={<ProduceWorkspace />}
                />
                <Route
                  path="/projects/:projectId/episodes/:episodeId/shots/:shotId"
                  element={<ProduceWorkspace />}
                />
                <Route
                  path="/projects/:projectId/episodes/:episodeId/scenes/:sceneId/*"
                  element={<LegacyEpisodeRedirect />}
                />
                <Route
                  path="/projects/:projectId/world"
                  element={<WorldWorkspace />}
                />
                <Route
                  path="/projects/:projectId/world/characters/:characterId/looks/:lookId"
                  element={<LookGenerationWorkspace />}
                />
                <Route
                  path="/projects/:projectId/library"
                  element={<LibraryWorkspace />}
                />
                <Route
                  path="/projects/:projectId/characters/*"
                  element={<LegacyProject tab="world" />}
                />
                <Route
                  path="/projects/:projectId/characters/:characterId"
                  element={<LegacyProject tab="world" />}
                />
                <Route
                  path="/projects/:projectId/bible"
                  element={<LegacyProject tab="notes" />}
                />
                <Route
                  path="/projects/:projectId/assets"
                  element={<LegacyProject tab="library" />}
                />
                <Route
                  path="/projects/:projectId/exports"
                  element={<LegacyProject tab="library?filter=renders" />}
                />
                <Route
                  path="/projects/:projectId/queue"
                  element={<LegacyDialog />}
                />
                <Route
                  path="/projects/:projectId/settings"
                  element={<LegacyDialog settings />}
                />
                <Route
                  path="/profile/settings"
                  element={<LegacyDialog account />}
                />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </StudioShell>
          </GenerationProvider>
        </ProductionProvider>
      </CommandProvider>
    </ActionsProvider>
  );
}
