export type UIVersion = 'v1' | 'v2';

// Check Vite env, localStorage, or query param '?v=v2'
export function getUIVersion(): UIVersion {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const paramVersion = params.get('v') || params.get('version');
    if (paramVersion === 'v1' || paramVersion === 'v2') {
      return paramVersion;
    }
    const stored = localStorage.getItem('deskly_ui_version');
    if (stored === 'v1' || stored === 'v2') {
      return stored;
    }
  }
  const envVersion = import.meta.env.VITE_UI_VERSION;
  if (envVersion === 'v2') return 'v2';
  return 'v1';
}

export function setUIVersion(version: UIVersion): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('deskly_ui_version', version);
    window.location.reload();
  }
}

export const currentVersion: UIVersion = getUIVersion();
export const isV2 = (): boolean => getUIVersion() === 'v2';
