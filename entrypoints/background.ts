import { ensureContextNote, ensureSingleGroupNote, setActiveContext } from '../shared/storage';
import { resolveContextFromTabId } from '../shared/tabContext';
import { defineBackground } from 'wxt/utils/define-background';

async function syncTabContext(tabId: number): Promise<void> {
  const context = await resolveContextFromTabId(tabId);
  await ensureSingleGroupNote(context);
  await ensureContextNote(context);
  await setActiveContext(context);
}

export default defineBackground(() => {
  chrome.action.onClicked.addListener((tab: { windowId?: number }) => {
    if (typeof tab.windowId === 'number') {
      void chrome.sidePanel.open({ windowId: tab.windowId });
    }
  });

  chrome.runtime.onInstalled.addListener(() => {
    void bootstrap();
  });

  chrome.runtime.onStartup.addListener(() => {
    void bootstrap();
  });

  chrome.tabs.onActivated.addListener(({ tabId }: { tabId: number }) => {
    void syncTabContext(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: { status?: string }) => {
    if (changeInfo.status === 'complete') {
      void syncTabContext(tabId);
    }
  });

  chrome.tabGroups.onUpdated.addListener((group: { id: number }) => {
    void chrome.tabs.query({ groupId: group.id }).then((tabs: Array<{ id?: number }>) => {
      const firstTab = tabs.find((tab) => typeof tab.id === 'number');
      if (firstTab?.id !== undefined) {
        void syncTabContext(firstTab.id);
      }
    });
  });
});

async function bootstrap(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (activeTab?.id !== undefined) {
    await syncTabContext(activeTab.id);
  }
}
