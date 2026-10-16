export type ID = string;
export type StudioOperation = "identity" | "reference" | "look" | "location";
export type Operation = "image" | "video" | StudioOperation;
export type ReferenceType =
  | "front"
  | "three_quarter"
  | "profile"
  | "full_body"
  | "full_body_three_quarter"
  | "custom";
export interface CastAssignment {
  characterId: ID;
  lookId?: ID;
  referenceIds?: ID[];
}
export interface SceneDirection {
  time: string;
  lighting: string;
  mood: string;
  style: string;
  camera: string;
  notes: string;
}
export type ReferencePurpose =
  "visual_style" | "setting" | "camera_movement" | "audio" | "continuity";
export interface GenerationPreferences {
  videoMode?: "direct" | "image_first";
  startingFrameAssetId?: ID;
  endingFrameAssetId?: ID;
  instructions: string;
  referenceInputs: { assetId: ID; purpose: ReferencePurpose }[];
  model: "demo";
  aspectRatio: "9:16" | "16:9" | "1:1";
}
export interface GenerationInputSnapshot extends GenerationPreferences {
  scriptRevision?: number;
  planRevision?: number;
  locationMode: SceneSetup["locationMode"];
  locationId?: ID;
  locationAssetId?: ID;
  direction: SceneDirection;
  targetFrames: number;
}
export interface SceneSetup {
  sceneId: ID;
  generation?: GenerationPreferences;
  cast: CastAssignment[];
  locationMode: "none" | "inferred" | "selected" | "required";
  locationId?: ID;
  direction: SceneDirection;
  targetSeconds: number;
  revision: number;
}
export interface CharacterLook {
  id: ID;
  characterId: ID;
  name: string;
  description: string;
  styling: string;
  notes: string;
  revision: number;
  primaryVersionId?: ID;
  createdAt: number;
  updatedAt: number;
}
export interface CharacterReference {
  id: ID;
  characterId: ID;
  lookId?: ID;
  type: ReferenceType;
  activeVersionId?: ID;
}
export interface MediaVersion {
  id: ID;
  projectId: ID;
  ownerKind: StudioOperation;
  ownerId: ID;
  assetId: ID;
  approval: "needs_review" | "approved" | "rejected";
  revision: number;
  sourceIdentityVersionId?: ID;
  sourceLookVersionId?: ID;
  specification: string;
  createdAt: number;
}
export interface LocationReference {
  id: ID;
  projectId: ID;
  name: string;
  description: string;
  primaryVersionId?: ID;
  assetId?: ID;
  referenceAssetIds: ID[];
  revision: number;
}
export interface StudioData {
  looks: Record<ID, CharacterLook>;
  references: Record<ID, CharacterReference>;
  versions: Record<ID, MediaVersion>;
  locations: Record<ID, LocationReference>;
  setups: Record<ID, SceneSetup>;
}
export interface StudioChange {
  kind: "identity" | "create_look" | "edit_look" | "direction" | "cast";
  fields: Record<string, string>;
}
export interface ReferenceSnapshot {
  characterId: ID;
  identityVersionId?: ID;
  lookVersionId?: ID;
  referenceVersionIds: ID[];
}

export type JobState =
  "queued" | "waiting" | "running" | "succeeded" | "failed" | "canceled";
export interface Project {
  id: ID;
  title: string;
  description: string;
  cover: string;
  episodeIds: ID[];
  bible: string;
  defaultDuration: number;
  revision: number;
  updatedAt?: number;
}
export interface ScriptApproval {
  revision: number;
  script: string;
  approvedAt: number;
}
export interface PlanApproval {
  direction?: SceneDirection;
  revision: number;
  scriptRevision: number;
  title: string;
  description: string;
  dialogue: string;
  settingDescription: string;
  creativeNotes: string;
  targetSeconds: number;
  shots: { id: ID; action: string; dialogue: string; targetFrames: number }[];
  approvedAt: number;
}
export interface Episode {
  id: ID;
  projectId: ID;
  title: string;
  synopsis: string;
  targetSeconds: number;
  sceneIds: ID[];
  script: string;
  scriptRevision?: number;
  scriptApprovedRevision?: number;
  scriptHistory?: ScriptApproval[];
  revision: number;
  timelineVersion: number;
}
export interface Scene {
  planRevision?: number;
  planApprovedRevision?: number;
  sourceScriptRevision?: number;
  dialogue?: string;
  settingDescription?: string;
  creativeNotes?: string;
  planHistory?: PlanApproval[];
  id: ID;
  episodeId: ID;
  title: string;
  description: string;
  shotIds: ID[];
  cover: string;
}
export interface Shot {
  id: ID;
  sceneId: ID;
  title: string;
  action: string;
  dialogue: string;
  characters: string[];
  targetFrames: number;
  inFrame: number;
  outFrame: number;
  revision: number;
  imageTakeId?: ID;
  currentTakeId?: ID;
  candidateTakeId?: ID;
  dependsOn?: ID;
  stale: boolean;
  generationOverride?: GenerationPreferences & {
    locationMode: SceneSetup["locationMode"];
    locationId?: ID;
  };
  castOverride?: CastAssignment[];
  referenceRequirements?: ReferenceType[];
  framing?: string;
  requestedOperation?: "image" | "video";
}
export interface Take {
  id: ID;
  shotId: ID;
  kind: Operation;
  revision: number;
  approved: boolean;
  sourceFrames: number;
  assetId: ID;
  createdAt: number;
  sourceTakeId?: ID;
  references?: ReferenceSnapshot[];
  inputs?: GenerationInputSnapshot;
}
export interface Asset {
  id: ID;
  projectId: ID;
  title: string;
  kind: "image" | "video" | "audio";
  url: string;
  sessionOnly?: boolean;
  missing?: boolean;
  provenance: string;
}
export interface GenerationJob {
  id: ID;
  projectId: ID;
  episodeId: ID;
  sceneId: ID;
  shotId: ID;
  operation: Operation;
  state: JobState;
  attempt: number;
  cost: number;
  progress: number | null;
  revision: number;
  sourceTakeId?: ID;
  dependencyShotId?: ID;
  error?: string;
  replacement: boolean;
  target?: { kind: StudioOperation; id: ID };
  sourceIdentityVersionId?: ID;
  sourceLookVersionId?: ID;
  specification?: string;
  outputVersionIds?: ID[];
  references?: ReferenceSnapshot[];
  inputs?: GenerationInputSnapshot;
  simulateFailure?: boolean;
}
export interface Scope {
  projectId: ID;
  episodeId?: ID;
  sceneId?: ID;
  shotId?: ID;
  revision: number;
  range?: [number, number];
  fps: 30;
  characterId?: ID;
  lookId?: ID;
  characterTab?: string;
  setup?: boolean;
}
export interface EditProposal {
  id: ID;
  scope: Scope;
  shotIds: ID[];
  intent: "develop" | "suspense" | "trim" | "generate" | "replace" | "studio";
  change?: StudioChange;
  before: string;
  after: string;
  state: "proposed" | "applied" | "canceled";
  cost: number;
}
export interface ChatMessage {
  id: ID;
  role: "user" | "assistant";
  text: string;
  proposalId?: ID;
}
export interface ChatThread {
  id: ID;
  messages: ChatMessage[];
}
export interface ExportRecord {
  id: ID;
  episodeId: ID;
  timelineVersion: number;
  title: string;
  preset: string;
  captions: boolean;
  description: string;
  draft: boolean;
  createdAt: number;
  manifest: string;
}
export interface Character {
  id: ID;
  projectId: ID;
  name: string;
  description: string;
  reference: string;
  approved: boolean;
  role?: string;
  appearance?: string;
  personality?: string;
  notes?: string;
  canonicalVersionId?: ID;
  revision?: number;
  createdAt?: number;
  updatedAt?: number;
}
export interface Data {
  projects: Record<ID, Project>;
  episodes: Record<ID, Episode>;
  scenes: Record<ID, Scene>;
  shots: Record<ID, Shot>;
  takes: Record<ID, Take>;
  assets: Record<ID, Asset>;
  jobs: Record<ID, GenerationJob>;
  threads: Record<ID, ChatThread>;
  proposals: Record<ID, EditProposal>;
  exports: Record<ID, ExportRecord>;
  characters: Record<ID, Character>;
  credits: number;
  studio: StudioData;
}
export interface UI {
  theme: "dark" | "light";
  collapsed: boolean;
  aiOpen: boolean;
  layouts: Record<string, Record<string, number>>;
  selectedShots: Record<ID, ID>;
}
export const FPS = 30;
export const CONFIG = {
  concurrency: 2,
  imageCost: 8,
  videoCost: 24,
  progressStep: 10,
  tickMs: 650,
  maxUploadBytes: 20 * 1024 * 1024,
};
export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
