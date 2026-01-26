export type FormSection = "inputs" | "prompts" | "loras" | "nodes";

export interface PlacementMeta {
  key: string;
  section: FormSection;
  groupId: string;
  groupTitle: string;
  source: "annotation" | "heuristic";
  reason: string;
  order: number;
}

export interface GroupMap {
  title: string;
  keys: string[];
  order: number;
}

export interface GroupWithBypass {
  id: string;
  title: string;
  keys: string[];
  order: number;
  bypassKey?: string;
  hasBypass: boolean;
}
