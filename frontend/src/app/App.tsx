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
import {
  EpisodeWorkspace,
  LegacyEpisodeRedirect,
} from "../studio/EpisodeWorkspace";
import { useStudio } from "../studio/selection";
import {
  HomeWorkspace,
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
        <GenerationProvider>
          <StudioShell>
            <Routes>
              <Route path="/" element={<Navigate to="/projects" replace />} />
              <Route
                path="/app"
                element={<Navigate to="/projects" replace />}
              />
              <Route path="/projects" element={<HomeWorkspace />} />
              <Route path="/projects/browse" element={<ProjectsWorkspace />} />
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
                element={<EpisodeWorkspace />}
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
      </CommandProvider>
    </ActionsProvider>
  );
}
