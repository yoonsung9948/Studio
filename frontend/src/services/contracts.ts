import type { Data, Scope, ExportRecord } from "../domain/types";
export interface GenerationService {
  start(): () => void;
  resume(): void;
  reportProgress(jobId: string, progress: number | null): void;
}
export interface DirectorService {
  respond(scope: Scope, text: string, signal: AbortSignal): Promise<string>;
}
export interface ExportService {
  create(
    data: Data,
    episodeId: string,
    options: Pick<
      ExportRecord,
      "title" | "preset" | "captions" | "description" | "draft"
    >,
  ): Promise<ExportRecord>;
}
