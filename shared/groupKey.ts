import type { ActiveContext, GroupContext, ScratchpadContext } from './types';

const SCRATCHPAD_KEY = 'global:scratchpad';

export function deriveOrigin(url?: string | null): string {
  if (!url) {
    return 'unknown';
  }

  try {
    return new URL(url).hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function buildGroupKey(groupId: number): string {
  return `group:id:${groupId}`;
}

export function createScratchpadContext(tabId: number, origin = 'unknown'): ScratchpadContext {
  return {
    kind: 'scratchpad',
    key: SCRATCHPAD_KEY,
    title: 'Global Scratchpad',
    origin,
    tabId,
  };
}

export function createGroupContext(input: {
  tabId: number;
  groupId: number;
  title: string;
  color: string;
  origin: string;
  tabs: Array<{
    tabId: number;
    title: string;
    url: string;
  }>;
}): GroupContext {
  return {
    kind: 'group',
    key: buildGroupKey(input.groupId),
    tabId: input.tabId,
    groupId: input.groupId,
    title: input.title,
    color: input.color,
    origin: input.origin,
    tabs: input.tabs,
  };
}

export function previewText(body: string, maxLength = 72): string {
  const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';

  if (firstLine.length <= maxLength) {
    return firstLine;
  }

  return `${firstLine.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function describeContext(context: ActiveContext): string {
  return context.kind === 'group' ? `${context.title} · ${context.color}` : context.title;
}
