import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'TabNotes',
    description: 'Chrome extension home page and side panel for taking notes on your grouped tabs.',
    version: '1.0',
    permissions: ['storage', 'tabs', 'tabGroups', 'sidePanel'],
    action: {
      default_title: 'TabNotes',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    chrome_url_overrides: {
      newtab: 'newtab.html',
    },
  },
});