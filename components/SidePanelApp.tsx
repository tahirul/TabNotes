import { useEffect, useMemo, useState } from 'react';
import { createScratchpadContext } from '../shared/groupKey';
import { createDefaultNote, readState, subscribeToStateChanges, upsertNote } from '../shared/storage';
import { applyThemeMode, readThemeMode, subscribeToThemeMode } from '../shared/theme';
import type { ActiveContext, NoteRecord, TabNotesState } from '../shared/types';
import { CrepeEditor } from './CrepeEditor';

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

function ensureActiveContext(state: TabNotesState): ActiveContext {
  if (state.activeContext) {
    return state.activeContext;
  }

  return createScratchpadContext(0);
}

function truncateChipTitle(title: string, limit = 30): string {
  if (title.length <= limit) {
    return title;
  }

  return `${title.slice(0, limit)}...`;
}

export function SidePanelApp() {
  const [state, setState] = useTabNotesState();
  const activeContext = useMemo(() => ensureActiveContext(state), [state]);
  const body = state.notes[activeContext.key]?.body || '';

  useEffect(() => {
    let alive = true;

    void readThemeMode().then((mode) => {
      if (alive) {
        applyThemeMode(mode);
      }
    });

    const unsubscribe = subscribeToThemeMode((mode) => {
      applyThemeMode(mode);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  async function persistBody(context: ActiveContext, nextBody: string) {
    const updated: NoteRecord = {
      ...(state.notes[context.key] ?? createDefaultNote(context)),
      body: nextBody,
      preview: nextBody.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '',
      updatedAt: new Date().toISOString(),
      status: state.notes[context.key]?.status ?? 'active',
      title: context.title,
      color: context.kind === 'group' ? context.color : undefined,
      origin: context.origin,
      groupId: context.kind === 'group' ? context.groupId : undefined,
      tabTitles: context.kind === 'group' ? context.tabs.map((tab: { title: string }) => tab.title) : undefined,
      tabLinks: context.kind === 'group'
        ? context.tabs.map((tab: { tabId: number; title: string; url: string }) => ({
            tabId: tab.tabId,
            title: tab.title,
            url: tab.url,
          }))
        : [],
    };

    await upsertNote(updated);
    setState((current) => ({
      ...current,
      notes: {
        ...current.notes,
        [updated.key]: updated,
      },
      activeContext: current.activeContext,
    }));
  }

  async function handleChange(contextKey: string, nextBody: string) {
    if (contextKey !== activeContext.key) {
      return;
    }

    await persistBody(activeContext, nextBody);
  }

  async function handleTabSwitch(tabId: number) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (typeof tab.windowId === 'number') {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      await chrome.tabs.update(tabId, { active: true });
    } catch {
      // Ignore missing tab errors from stale link state.
    }
  }

  return (
    <main className="tabnotes-app tabnotes-sidepanel">
      <header className="tabnotes-header-compact">
        <div className="tabnotes-header-title">
          <h1>{activeContext.title}</h1>
          {activeContext.kind === 'group' ? <span className="tabnotes-muted">{activeContext.color}</span> : null}
        </div>
      </header>

      <section className="tabnotes-editor-shell">
        <CrepeEditor
          key={activeContext.key}
          contextKey={activeContext.key}
          value={body}
          onMarkdownChange={(contextKey, markdown) => void handleChange(contextKey, markdown)}
        />
      </section>

      {activeContext.kind === 'group' && activeContext.tabs.length > 0 ? (
        <section className="tabnotes-panel tabnotes-sidepanel-links">
          <div className="tabnotes-tag-row">
            {activeContext.tabs.map((tab) => (
              <button
                key={`${tab.tabId}:${tab.title}`}
                type="button"
                className="tabnotes-tag-link"
                title={tab.title}
                onClick={() => void handleTabSwitch(tab.tabId)}
              >
                {truncateChipTitle(tab.title)}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
