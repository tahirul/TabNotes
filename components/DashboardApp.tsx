import { defaultValueCtx, Editor, rootCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  archiveNote,
  createDefaultNote,
  createStandaloneNote,
  deleteNote,
  readState,
  restoreNote,
  setActiveContext,
  setPinnedState,
  subscribeToStateChanges,
  upsertNote,
} from '../shared/storage';
import { createScratchpadContext } from '../shared/groupKey';
import type { ActiveContext, NoteRecord, TabNotesState } from '../shared/types';

function useTabNotesState() {
  const [state, setState] = useState<TabNotesState>({ activeContext: null, notes: {} });

  useEffect(() => {
    let alive = true;

    void readState().then((next) => {
      if (alive) {
        setState(next);
      }
    });

    const unsubscribe = subscribeToStateChanges((next) => {
      setState((current) => ({
        activeContext: next.activeContext ?? current.activeContext,
        notes: Object.keys(next.notes).length > 0 ? next.notes : current.notes,
      }));
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return [state, setState] as const;
}

interface MarkdownEditorInnerProps {
  contextKey: string;
  initialValue: string;
  onMarkdownChange: (contextKey: string, markdown: string) => void;
}

function MarkdownEditorInner({ contextKey, initialValue, onMarkdownChange }: MarkdownEditorInnerProps) {
  const onChangeRef = useRef(onMarkdownChange);

  useEffect(() => {
    onChangeRef.current = onMarkdownChange;
  }, [onMarkdownChange]);

  useEditor(() => {
    return Editor.make()
      .config((ctx) => {
        ctx.set(defaultValueCtx, initialValue);
        ctx.get(listenerCtx).markdownUpdated((_editorCtx, markdown) => {
          onChangeRef.current(contextKey, markdown);
        });
      })
      .config((ctx) => {
        ctx.set(rootCtx, document.querySelector('#dashboard-milkdown-root') as HTMLElement);
      })
      .use(commonmark)
      .use(gfm)
      .use(listener);
  });

  return (
    <div id="dashboard-milkdown-root" className="tabnotes-milkdown prose prose-sm max-w-none" aria-label="Markdown editor">
      <Milkdown />
    </div>
  );
}

interface MarkdownEditorProps {
  contextKey: string;
  value: string;
  onMarkdownChange: (contextKey: string, markdown: string) => void;
}

function MarkdownEditor({ contextKey, value, onMarkdownChange }: MarkdownEditorProps) {
  return (
    <MilkdownProvider key={contextKey}>
      <MarkdownEditorInner contextKey={contextKey} initialValue={value} onMarkdownChange={onMarkdownChange} />
    </MilkdownProvider>
  );
}

function contextFromNote(note: NoteRecord): ActiveContext {
  if (typeof note.groupId === 'number') {
    return {
      kind: 'group',
      key: note.key,
      title: note.title,
      origin: note.origin || 'unknown',
      tabId: 0,
      groupId: note.groupId,
      color: note.color || 'grey',
      tabs: (note.tabLinks || []).map((link, index) => ({
        tabId: link.tabId ?? index,
        title: link.title,
        url: link.url,
      })),
    };
  }

  return {
    kind: 'scratchpad',
    key: note.key,
    title: note.title,
    origin: note.origin || 'manual',
    tabId: 0,
  };
}

function sortByPinnedAndRecent(a: NoteRecord, b: NoteRecord): number {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) {
    return a.pinned ? -1 : 1;
  }

  const aTime = Date.parse(a.updatedAt || '');
  const bTime = Date.parse(b.updatedAt || '');
  return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
}

function normalizeGroupColor(color?: string): 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange' {
  switch (color) {
    case 'blue':
    case 'red':
    case 'yellow':
    case 'green':
    case 'pink':
    case 'purple':
    case 'cyan':
    case 'orange':
      return color;
    default:
      return 'grey';
  }
}

export function DashboardApp() {
  const [state, setState] = useTabNotesState();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>('global:scratchpad');
  const menuRef = useRef<HTMLDivElement | null>(null);

  const allNotes = useMemo(() => Object.values(state.notes), [state.notes]);
  const activeNotes = useMemo(
    () => allNotes.filter((note) => note.status === 'active').sort(sortByPinnedAndRecent),
    [allNotes],
  );
  const archivedNotes = useMemo(
    () => allNotes.filter((note) => note.status === 'archived').sort(sortByPinnedAndRecent),
    [allNotes],
  );

  useEffect(() => {
    if (state.activeContext?.key) {
      setSelectedKey(state.activeContext.key);
      return;
    }

    if (activeNotes.length > 0) {
      setSelectedKey(activeNotes[0].key);
    }
  }, [state.activeContext?.key, activeNotes]);

  const selectedNote = useMemo(() => {
    if (state.notes[selectedKey]) {
      return state.notes[selectedKey];
    }

    const context = state.activeContext ?? createScratchpadContext(0);
    return createDefaultNote(context);
  }, [state.notes, selectedKey, state.activeContext]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!menuRef.current) {
        return;
      }

      if (!menuRef.current.contains(event.target as Node)) {
        setOpenMenuKey(null);
      }
    };

    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, []);

  async function selectNote(note: NoteRecord) {
    const context = contextFromNote(note);
    setSelectedKey(note.key);
    setOpenMenuKey(null);
    setState((current) => ({ ...current, activeContext: context }));
    await setActiveContext(context);
  }

  async function handleCreateNewNote() {
    const newNote = createStandaloneNote();
    const context = contextFromNote(newNote);

    await upsertNote(newNote);
    setState((current) => ({
      ...current,
      activeContext: context,
      notes: {
        ...current.notes,
        [newNote.key]: newNote,
      },
    }));
    setSelectedKey(newNote.key);
    await setActiveContext(context);
  }

  async function handleBodyChange(contextKey: string, nextBody: string) {
    if (contextKey !== selectedNote.key) {
      return;
    }

    const updated: NoteRecord = {
      ...selectedNote,
      body: nextBody,
      preview: nextBody.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '',
      updatedAt: new Date().toISOString(),
    };

    await upsertNote(updated);
    setState((current) => ({
      ...current,
      notes: {
        ...current.notes,
        [updated.key]: updated,
      },
    }));
  }

  async function handleTitleChange(nextTitle: string) {
    const trimmed = nextTitle.trim();
    const safeTitle = trimmed.length > 0 ? trimmed : 'Untitled note';
    const updated: NoteRecord = {
      ...selectedNote,
      title: safeTitle,
      updatedAt: new Date().toISOString(),
    };

    await upsertNote(updated);
    setState((current) => ({
      ...current,
      notes: {
        ...current.notes,
        [updated.key]: updated,
      },
      activeContext: current.activeContext && current.activeContext.key === updated.key
        ? {
            ...current.activeContext,
            title: safeTitle,
          }
        : current.activeContext,
    }));

    if (state.activeContext?.key === updated.key) {
      await setActiveContext({ ...state.activeContext, title: safeTitle });
    }
  }

  async function handleArchiveToggle(note: NoteRecord) {
    if (note.status === 'archived') {
      await restoreNote(note.key);
      return;
    }

    await archiveNote(note.key);
  }

  async function handleDelete(note: NoteRecord) {
    await deleteNote(note.key);
    setOpenMenuKey(null);

    if (selectedKey === note.key) {
      const fallback = activeNotes.find((candidate) => candidate.key !== note.key) || archivedNotes.find((candidate) => candidate.key !== note.key);
      if (fallback) {
        await selectNote(fallback);
      } else {
        const scratchpad = createDefaultNote(createScratchpadContext(0));
        setSelectedKey(scratchpad.key);
      }
    }
  }

  async function handlePinToggle(note: NoteRecord) {
    await setPinnedState(note.key, !note.pinned);
    setOpenMenuKey(null);
  }

  async function openUrlInDocGroup(url: string) {
    if (typeof selectedNote.groupId !== 'number') {
      await chrome.tabs.create({ url });
      return;
    }

    const groupedTabs = await chrome.tabs.query({ groupId: selectedNote.groupId });

    if (groupedTabs.length > 0) {
      const anchorTab = groupedTabs[0];
      const newTab = await chrome.tabs.create({
        url,
        active: true,
        windowId: anchorTab.windowId,
      });

      if (typeof newTab.id === 'number') {
        await chrome.tabs.group({ groupId: selectedNote.groupId, tabIds: newTab.id });
      }

      if (typeof anchorTab.windowId === 'number') {
        await chrome.windows.update(anchorTab.windowId, { focused: true });
      }
      return;
    }

    const newTab = await chrome.tabs.create({ url, active: true });
    if (typeof newTab.id !== 'number') {
      return;
    }

    const newGroupId = await chrome.tabs.group({ tabIds: newTab.id });
    await chrome.tabGroups.update(newGroupId, {
      title: selectedNote.title,
      color: normalizeGroupColor(selectedNote.color),
    });
  }

  async function handleLinkClick(link: { tabId?: number; title: string; url: string }) {
    if (typeof link.tabId === 'number') {
      try {
        const tab = await chrome.tabs.get(link.tabId);
        if (typeof tab.windowId === 'number') {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        await chrome.tabs.update(link.tabId, { active: true });
        return;
      } catch {
        // Continue to url fallback.
      }
    }

    if (!link.url) {
      return;
    }

    const matchingTabs = await chrome.tabs.query({ url: link.url });
    const matchingTab = matchingTabs.find((tab: { id?: number; windowId?: number }) => typeof tab.id === 'number');

    if (matchingTab?.id !== undefined) {
      if (typeof matchingTab.windowId === 'number') {
        await chrome.windows.update(matchingTab.windowId, { focused: true });
      }
      await chrome.tabs.update(matchingTab.id, { active: true });
      return;
    }

    await openUrlInDocGroup(link.url);
  }

  function renderNoteRow(note: NoteRecord) {
    const isActive = note.key === selectedNote.key;
    const menuOpen = openMenuKey === note.key;

    return (
      <li key={note.key} className={`tabnotes-doc-row${isActive ? ' is-active' : ''}`}>
        <button type="button" className="tabnotes-doc-select" onClick={() => void selectNote(note)}>
          {note.title}
        </button>
        <div className="tabnotes-doc-menu" ref={menuOpen ? menuRef : null}>
          <button
            type="button"
            className="tabnotes-ellipsis"
            onClick={() => setOpenMenuKey((current) => (current === note.key ? null : note.key))}
            aria-label={`Open actions for ${note.title}`}
          >
            ...
          </button>
          {menuOpen ? (
            <div className="tabnotes-menu-popover">
              <button type="button" onClick={() => void handlePinToggle(note)}>
                {note.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button type="button" onClick={() => void handleArchiveToggle(note)}>
                {note.status === 'archived' ? 'Restore' : 'Archive'}
              </button>
              <button type="button" onClick={() => void handleDelete(note)}>
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <main className={`tabnotes-app tabnotes-dashboard${isSidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <aside className={`tabnotes-sidebar${isSidebarCollapsed ? ' is-collapsed' : ''}`}>
        <section className="tabnotes-sidebar-panel">
          <div className="tabnotes-sidebar-top">
            <p className="tabnotes-label">Docs</p>
            <button type="button" onClick={() => setIsSidebarCollapsed((value) => !value)}>
              {isSidebarCollapsed ? '>>' : '<<'}
            </button>
          </div>

          {!isSidebarCollapsed ? (
            <>
              <ul className="tabnotes-doc-list">{activeNotes.map(renderNoteRow)}</ul>

              <div className="tabnotes-sidebar-divider" />
              <p className="tabnotes-label">Archive</p>
              <ul className="tabnotes-doc-list">{archivedNotes.map(renderNoteRow)}</ul>
            </>
          ) : null}

          <button type="button" className="tabnotes-settings-link">
            <span aria-hidden="true">[ ]</span>
            {!isSidebarCollapsed ? <span>Settings</span> : null}
          </button>
        </section>
      </aside>

      <section className="tabnotes-column tabnotes-column-center">
        <form className="tabnotes-panel tabnotes-search-panel" action="https://www.google.com/search" method="get" target="_self">
          <input
            className="tabnotes-search-input"
            type="search"
            name="q"
            placeholder="Search Google"
            aria-label="Search Google"
          />
          <button type="submit">Search</button>
        </form>

        <article className="tabnotes-panel tabnotes-center-editor">
          <div className="tabnotes-center-title-row">
            {selectedNote.groupId === undefined ? (
              <input
                className="tabnotes-title-input"
                value={selectedNote.title}
                onChange={(event) => void handleTitleChange(event.target.value)}
                aria-label="Note title"
              />
            ) : (
              <h1 className="tabnotes-title-heading">{selectedNote.title}</h1>
            )}
            <button type="button" onClick={() => void handleCreateNewNote()}>
              New doc
            </button>
          </div>

          <section className="tabnotes-editor-shell">
            <MarkdownEditor
              key={selectedNote.key}
              contextKey={selectedNote.key}
              value={selectedNote.body || ''}
              onMarkdownChange={(contextKey, markdown) => void handleBodyChange(contextKey, markdown)}
            />
          </section>

          {selectedNote.tabLinks && selectedNote.tabLinks.length > 0 ? (
            <div className="tabnotes-link-chip-footer">
              <div className="tabnotes-tag-row">
                {selectedNote.tabLinks.map((link, index) => (
                  <button
                    key={`${selectedNote.key}:${link.url}:${index}`}
                    type="button"
                    className="tabnotes-tag-link"
                    onClick={() => void handleLinkClick(link)}
                  >
                    {link.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </article>
      </section>
    </main>
  );
}
