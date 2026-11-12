import { Link } from "react-router-dom";
import { useProjects } from "../services/server-data";
export function ServerNavigation() {
  const query = useProjects(),
    projects = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <nav className="st-project-tree" aria-label="Your project navigation">
      {projects.map((project) => (
        <div key={project.id} className="st-project-tree-item">
          <Link to={`/projects/${project.id}/episodes`}>{project.title}</Link>
          <nav>
            <Link to={`/projects/${project.id}/library`}>Library</Link>
          </nav>
        </div>
      ))}
      <Link to="/projects/browse">Browse all projects</Link>
    </nav>
  );
}
