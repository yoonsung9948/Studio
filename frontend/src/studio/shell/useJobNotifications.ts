import { useEffect, useRef } from "react";
import { useStore } from "../../stores/store";

/** Announce actual state transitions; never re-announce restored or already finished jobs. */
export function useJobNotifications() {
  const jobs = useStore((state) => state.data.jobs);
  const backend = useStore((state) => state.data.backend?.jobs);
  const shots = useStore((state) => state.data.shots);
  const takes = useStore((state) => state.data.takes);
  const previousCandidates = useRef<Set<string> | null>(null);
  const preferences = useStore((state) => state.ui.notifications);
  const previous = useRef<Record<string, string> | null>(null);
  useEffect(() => {
    const states: Record<string, string> = {};
    for (const job of Object.values(jobs)) states[job.id] = job.state;
    for (const job of Object.values(backend ?? {}))
      states[job.id] = job.job?.status || "queued";
    const candidates = new Set(
      Object.values(shots).flatMap((shot) => {
        const take = takes[shot.candidateTakeId ?? ""];
        return take &&
          !take.approved &&
          !shot.archived &&
          !shot.stale &&
          take.revision === shot.revision
          ? [take.id]
          : [];
      }),
    );
    const reviews = previousCandidates.current
      ? [...candidates].filter((id) => !previousCandidates.current!.has(id))
          .length
      : 0;
    if (previous.current) {
      const completed = Object.entries(states).filter(
        ([id, status]) =>
          previous.current![id] &&
          previous.current![id] !== status &&
          status === "succeeded",
      ).length;
      const failed = Object.entries(states).filter(
        ([id, status]) =>
          previous.current![id] &&
          previous.current![id] !== status &&
          status === "failed",
      ).length;
      if (failed && preferences?.failed !== false)
        useStore
          .getState()
          .setNotice(
            `${failed} ${failed === 1 ? "job needs" : "jobs need"} attention. Open Activity to retry.`,
          );
      else if (completed && preferences?.completed !== false)
        useStore
          .getState()
          .setNotice(
            `${completed} ${completed === 1 ? "result is" : "results are"} ready. Open Activity to review.`,
          );
      else if (reviews && preferences?.review !== false)
        useStore
          .getState()
          .setNotice(
            `${reviews} ${reviews === 1 ? "take is" : "takes are"} ready for review. Open Reviews to choose a result.`,
          );
    }
    previousCandidates.current = candidates;
    previous.current = states;
  }, [jobs, backend, preferences, shots, takes]);
}
