export type NoteStatus = 'active' | 'archived';

export type TabContextKind = 'group' | 'scratchpad';

export interface ActiveContextBase {
  kind: TabContextKind;
  key: string;
  title: string;
  origin: string;
  tabId: number;
}

export interface GroupContext extends ActiveContextBase {
  kind: 'group';
  groupId: number;
  color: string;
  tabs: Array<{
    tabId: number;
    title: string;
    url: string;
  }>;
}

export interface ScratchpadContext extends ActiveContextBase {
  kind: 'scratchpad';
}

export type ActiveContext = GroupContext | ScratchpadContext;

export interface NoteRecord {
  key: string;
  title: string;
  body: string;
  preview: string;
  status: NoteStatus;
  updatedAt: string;
  pinned?: boolean;
  color?: string;
  origin?: string;
  groupId?: number;
  tabTitles?: string[];
  tabLinks?: Array<{
    tabId?: number;
    title: string;
    url: string;
  }>;
}

export interface TabNotesState {
  activeContext: ActiveContext | null;
  notes: Record<string, NoteRecord>;
}
