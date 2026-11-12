import type { JobDetail, Project } from "../../api/types";
export const backendProject: Project = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "First film",
  createdAt: "2026-10-18T12:00:00Z",
};
export const backendJob: JobDetail = {
  id: "20000000-0000-4000-8000-000000000002",
  projectId: backendProject.id,
  operation: "interpret_request",
  inputSchemaVersion: 1,
  input: { prompt: "A letter in a café" },
  status: "queued",
  createdAt: backendProject.createdAt,
  updatedAt: backendProject.createdAt,
  attempts: [],
};
export const interpretation = {
  creativeBrief: {
    premise: "A letter changes everything.",
    characters: ["Maya"],
    setting: "A café",
    style: "Quiet drama",
  },
  assumptions: ["The letter arrives anonymously."],
  questions: ["Who wrote the letter?"],
};
export const completedJob: JobDetail = {
  ...backendJob,
  status: "succeeded",
  results: [
    {
      id: "30000000-0000-4000-8000-000000000003",
      kind: "request_interpretation",
      schemaVersion: 1,
      content: interpretation,
      createdAt: backendProject.createdAt,
    },
  ],
};
export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const decision = {
  action: "propose_operation" as const,
  operation: "generate_video",
  input: {
    prompt: "A letter changes everything.",
    durationSeconds: 6,
    resolution: "768P",
  },
  assumptions: [
    "Fake interpreter: proposes video generation without semantic analysis.",
  ],
  questions: [],
};
export const completedDecisionJob: JobDetail = {
  ...backendJob,
  status: "succeeded",
  results: [
    {
      id: "30000000-0000-4000-8000-000000000003",
      kind: "request_interpretation",
      schemaVersion: 2,
      content: decision,
      createdAt: backendProject.createdAt,
    },
  ],
};

export function acceptedRequest(job: typeof backendJob) {
  return {
    request: {
      id: "50000000-0000-4000-8000-000000000005",
      projectId: job.projectId,
      prompt: "A letter in a café",
      interpretationJobId: job.id,
      createdAt: job.createdAt,
    },
    job,
  };
}
