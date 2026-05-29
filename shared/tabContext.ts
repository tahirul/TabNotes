import { createGroupContext, createScratchpadContext, deriveOrigin } from './groupKey';
import type { ActiveContext } from './types';

export async function resolveContextFromTabId(tabId: number): Promise<ActiveContext> {
  const tab = await chrome.tabs.get(tabId);
  const origin = deriveOrigin(tab.url ?? null);

  if (typeof tab.groupId !== 'number' || tab.groupId === -1) {
    return createScratchpadContext(tabId, origin);
  }

  const group = await chrome.tabGroups.get(tab.groupId);
  const groupedTabs = await chrome.tabs.query({ groupId: tab.groupId });

  return createGroupContext({
    tabId,
    groupId: tab.groupId,
    title: group.title?.trim() || tab.title?.trim() || 'Untitled Group',
    color: group.color || 'grey',
    origin,
    tabs: groupedTabs
      .filter((groupedTab: { id?: number }) => typeof groupedTab.id === 'number')
      .map((groupedTab: { id?: number; title?: string; url?: string }) => ({
        tabId: groupedTab.id as number,
        title: groupedTab.title?.trim() || 'Untitled Tab',
        url: groupedTab.url || '',
      })),
  });
}
