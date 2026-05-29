export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'tabnotes.themeMode';

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;

  if (mode === 'system') {
    root.removeAttribute('data-tabnotes-theme');
    return;
  }

  root.setAttribute('data-tabnotes-theme', mode);
}

export async function readThemeMode(): Promise<ThemeMode> {
  const payload = await chrome.storage.local.get([THEME_STORAGE_KEY]);
  return normalizeThemeMode(payload[THEME_STORAGE_KEY]);
}

export async function writeThemeMode(mode: ThemeMode): Promise<void> {
  await chrome.storage.local.set({ [THEME_STORAGE_KEY]: mode });
}

export function subscribeToThemeMode(onChange: (mode: ThemeMode) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
    if (areaName !== 'local' || !(THEME_STORAGE_KEY in changes)) {
      return;
    }

    onChange(normalizeThemeMode(changes[THEME_STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
