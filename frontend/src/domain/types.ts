import type { BackendWorkspace } from "./interpretation";
import type { EpisodeCut } from "./cut-schema";
export type ID = string;
export type StudioOperation =
  "identity" | "reference" | "look" | "location" | "prop";
export type Operation = "image" | "video" | StudioOperation;
export type ReferenceType =
  | "front"
  | "three_quarter"
  | "profile"
  | "right_profile"
  | "back"
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
export interface CraftSettings {
  cameraSpeed?: string;
  actionTiming?: string;
  performanceTone?: string;
  gazeDirection?: string;
  environmentMotion?: string;
  endingBeat?: string;
  lens: string;
  angle: string;
  lighting: string;
  focus: string;
  motionStrength: number;
  easing: string;
  negativePrompt: string;
  seed?: number;
}
export interface GenerationPreferences {
  craft?: CraftSettings;
  videoMode?: "direct" | "image_first";
  startingFrameAssetId?: ID;
  endingFrameAssetId?: ID;
  instructions: string;
  referenceInputs: { assetId: ID; purpose: ReferencePurpose }[];
  model: "demo";
  aspectRatio: "9:16" | "16:9" | "1:1";
}
export interface GenerationInputSnapshot extends GenerationPreferences {
  sourceScript?: string;
  sceneDescription?: string;
  episodeStyle?: string;
  camera?: { framing?: string; movement?: string };
  worldElements?: {
    id: string;
    kind: "prop" | "note";
    name: string;
    description: string;
    assetId?: string;
  }[];
  scriptRevision?: number;
  planRevision?: number;
  locationMode: SceneSetup["locationMode"];
  locationId?: ID;
  locationAssetId?: ID;
  direction: SceneDirection;
  targetFrames: number;
}
export interface SceneSetup {
  worldElementIds?: ID[];
  soundNotes?: string;
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
  /** Wardrobe and its views belong to one episode; undefined denotes a legacy shared look. */
  episodeId?: ID;
  sourceLookId?: ID;
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
  viewType?: string;
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
export interface SavedAssetViews {
  savedViewIds?: Record<string, ID>;
  sourceAssetId?: ID;
}
export interface WorldElement extends SavedAssetViews {
  id: ID;
  kind: "prop" | "note";
  name: string;
  description: string;
  assetId?: ID;
  revision?: number;
  primaryVersionId?: ID;
}
export interface LocationReference extends SavedAssetViews {
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
  format?: string;
  archived?: boolean;
  unfiled?: boolean;
  /** Internal owner of reusable assets, excluded from production lists. */
  assetLibrary?: boolean;
  strictApprovals?: boolean;
  worldElements?: WorldElement[];
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
  screenplay?: string;
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
  locationIds?: ID[];
  propIds?: ID[];
  cut?: EpisodeCut;
  /** Explicitly linked characters, independent of scene assignments. */
  characterIds?: ID[];
  /** Explicit episode membership for uploaded media; source assets remain reusable. */
  mediaAssetIds?: ID[];
  cutReview?: {
    approvedSignature?: string;
    notes: {
      id: string;
      text: string;
      frame: number;
      resolved: boolean;
      shotId?: string;
      version: number;
      createdAt: number;
    }[];
  };
  creationKind?: "episode" | "scene" | "shot";
  archived?: boolean;
  style?: string;
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
  screenplay?: string;
  archived?: boolean;
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
  volume?: number;
  archived?: boolean;
  discardedTakeIds?: string[];
  locked?: boolean;
  movement?: string;
  worldElementIds?: string[];
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
  generationOverride?: Partial<Omit<GenerationPreferences, "craft">> & {
    craft?: Partial<CraftSettings>;
    locationMode?: SceneSetup["locationMode"];
    locationId?: ID;
  };
  castOverride?: CastAssignment[];
  referenceRequirements?: ReferenceType[];
  framing?: string;
  requestedOperation?: "image" | "video";
}
export interface Take {
  producerJobId?: string;
  favorite?: boolean;
  review?: { note: string; checks: string[] };
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
  serverAssetId?: string;
  storedBlob?: boolean;
  archived?: boolean;
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
  viewType?: string;
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
  outputCount?: number;
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
  outputAssetId?: ID;
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
  /** A production-owned snapshot of a reusable character. */
  sourceCharacterId?: ID;
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
  backend?: BackendWorkspace;
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
  autosave?: boolean;
  density?: "comfortable" | "compact" | "spacious";
  reducedMotion?: boolean;
  notifications?: { completed: boolean; failed: boolean; review: boolean };
  inspectorAdvanced?: boolean;
  theme: "dark" | "light" | "system";
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
