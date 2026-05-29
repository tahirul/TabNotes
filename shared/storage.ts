import { createScratchpadContext, previewText } from './groupKey';
import type { ActiveContext, NoteRecord, TabNotesState } from './types';

export const STORAGE_KEYS = {
  notes: 'tabnotes.notes',
  activeContext: 'tabnotes.activeContext',
} as const;

export function emptyState(): TabNotesState {
  return {
    activeContext: null,
    notes: {},
  };
}

export function createDefaultNote(context: ActiveContext): NoteRecord {
  return {
    key: context.key,
    title: context.title,
    body: '',
    preview: '',
    status: 'active',
    updatedAt: new Date().toISOString(),
    color: context.kind === 'group' ? context.color : undefined,
    origin: context.origin,
    groupId: context.kind === 'group' ? context.groupId : undefined,
    tabTitles: context.kind === 'group' ? context.tabs.map((tab) => tab.title) : undefined,
    tabLinks: context.kind === 'group' ? context.tabs.map((tab) => ({ tabId: tab.tabId, title: tab.title, url: tab.url })) : undefined,
  };
}

export function createStandaloneNote(title = 'Untitled note'): NoteRecord {
  const key = `note:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  return {
    key,
    title,
    body: '',
    preview: '',
    status: 'active',
    pinned: false,
    updatedAt: new Date().toISOString(),
    origin: 'manual',
    tabTitles: [],
    tabLinks: [],
  };
}

export async function readState(): Promise<TabNotesState> {
  const payload = await chrome.storage.local.get([STORAGE_KEYS.notes, STORAGE_KEYS.activeContext]);

  return {
    activeContext: (payload[STORAGE_KEYS.activeContext] as ActiveContext | null | undefined) ?? null,
    notes: (payload[STORAGE_KEYS.notes] as Record<string, NoteRecord> | undefined) ?? {},
  };
}

export async function writeState(state: TabNotesState): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.notes]: state.notes,
    [STORAGE_KEYS.activeContext]: state.activeContext,
  });
}

export async function setActiveContext(context: ActiveContext): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.activeContext]: context });
}

export async function upsertNote(note: NoteRecord): Promise<void> {
  const state = await readState();
  const body = note.body ?? '';

  state.notes[note.key] = {
    ...note,
    body,
    preview: note.preview || previewText(body),
    pinned: note.pinned ?? state.notes[note.key]?.pinned ?? false,
    updatedAt: new Date().toISOString(),
  };

  await writeState(state);
}

export async function ensureContextNote(context: ActiveContext): Promise<void> {
  const state = await readState();
  const existing = state.notes[context.key];

  if (!existing) {
    state.notes[context.key] = createDefaultNote(context);
    await writeState(state);
    return;
  }

  state.notes[context.key] = {
    ...existing,
    title: context.title,
    origin: context.origin,
    color: context.kind === 'group' ? context.color : existing.color,
    groupId: context.kind === 'group' ? context.groupId : existing.groupId,
    tabTitles: context.kind === 'group' ? context.tabs.map((tab) => tab.title) : existing.tabTitles,
    tabLinks: context.kind === 'group' ? context.tabs.map((tab) => ({ tabId: tab.tabId, title: tab.title, url: tab.url })) : existing.tabLinks,
  };

  await writeState(state);
}

export async function ensureSingleGroupNote(context: ActiveContext): Promise<void> {
  if (context.kind !== 'group') {
    return;
  }

  const state = await readState();
  const groupCandidates = Object.values(state.notes).filter((note) => note.groupId === context.groupId);

  if (groupCandidates.length <= 1 && (groupCandidates.length === 0 || groupCandidates[0].key === context.key)) {
    return;
  }

  const winner = [...groupCandidates].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || '');
    const bTime = Date.parse(b.updatedAt || '');
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  })[0];

  const canonical: NoteRecord = {
    ...winner,
    key: context.key,
    title: context.title,
    color: context.color,
    origin: context.origin,
    groupId: context.groupId,
    tabTitles: context.tabs.map((tab) => tab.title),
    tabLinks: context.tabs.map((tab) => ({ tabId: tab.tabId, title: tab.title, url: tab.url })),
    updatedAt: new Date().toISOString(),
  };

  groupCandidates.forEach((candidate) => {
    delete state.notes[candidate.key];
  });

  state.notes[context.key] = canonical;
  await writeState(state);
}

export async function archiveNote(key: string): Promise<void> {
  const state = await readState();
  const note = state.notes[key];

  if (!note) {
    return;
  }

  state.notes[key] = {
    ...note,
    status: 'archived',
    updatedAt: new Date().toISOString(),
  };

  await writeState(state);
}

export async function restoreNote(key: string): Promise<void> {
  const state = await readState();
  const note = state.notes[key];

  if (!note) {
    return;
  }

  state.notes[key] = {
    ...note,
    status: 'active',
    updatedAt: new Date().toISOString(),
  };

  await writeState(state);
}

export async function deleteNote(key: string): Promise<void> {
  const state = await readState();

  if (!(key in state.notes)) {
    return;
  }

  delete state.notes[key];
  await writeState(state);
}

export async function setPinnedState(key: string, pinned: boolean): Promise<void> {
  const state = await readState();
  const note = state.notes[key];

  if (!note) {
    return;
  }

  state.notes[key] = {
    ...note,
    pinned,
    updatedAt: new Date().toISOString(),
  };

  await writeState(state);
}

export function subscribeToStateChanges(onChange: (state: TabNotesState) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
    if (areaName !== 'local') {
      return;
    }

    const nextState: TabNotesState = emptyState();

    if (STORAGE_KEYS.notes in changes) {
      nextState.notes = (changes[STORAGE_KEYS.notes].newValue as Record<string, NoteRecord> | undefined) ?? {};
    }

    if (STORAGE_KEYS.activeContext in changes) {
      nextState.activeContext = (changes[STORAGE_KEYS.activeContext].newValue as ActiveContext | null | undefined) ?? null;
    }

    if (STORAGE_KEYS.notes in changes || STORAGE_KEYS.activeContext in changes) {
      onChange(nextState);
    }
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export function noteForContext(state: TabNotesState, context: ActiveContext): NoteRecord {
  return state.notes[context.key] ?? createDefaultNote(context);
}
