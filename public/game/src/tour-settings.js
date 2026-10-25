/** Browser preferences are independent from run power and never invalidate a save. */
export const SETTINGS_KEY = 'gyaruinthemix-tour-settings-v1';
export function normalizeSettings(value, reducedMotion = false) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    version: 1,
    autoHearts: source.autoHearts === true,
    assistMode: source.assistMode === true,
    musicDrive: source.musicDrive === true,
    reducedMotion: typeof source.reducedMotion === 'boolean' ? source.reducedMotion : Boolean(reducedMotion),
  };
}
export function createSettingsStore(storage, reducedMotion = false) {
  return {
    load() {
      try { return normalizeSettings(storage?.getItem(SETTINGS_KEY), reducedMotion); }
      catch { return normalizeSettings(null, reducedMotion); }
    },
    save(value) {
      try {
        if (!storage) return false;
        storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(value, reducedMotion)));
        return true;
      } catch { return false; }
    },
  };
}
