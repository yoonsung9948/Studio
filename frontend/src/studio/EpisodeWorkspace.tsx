import { Navigate, useLocation, useParams } from "react-router-dom";
import { produceUrl } from "../domain/produce-route";

/** Old scene links enter the same Produce workspace; no second workflow shell. */
export function LegacyEpisodeRedirect() {
  const { projectId = "", episodeId = "", sceneId } = useParams();
  const location = useLocation();
  const final = location.pathname.endsWith("/edit");
  const to = produceUrl(
    projectId,
    episodeId,
    final ? "final" : "plan",
    sceneId,
  );
  const demo = new URLSearchParams(location.search).get("mode") === "demo";
  return <Navigate replace to={demo ? `${to}&mode=demo` : to} />;
}
