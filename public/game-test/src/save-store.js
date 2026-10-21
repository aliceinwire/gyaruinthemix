/** Persistence boundary. Storage denial must never interrupt play. */
import { exportCampaignSave, restoreCampaignSave, exportNightfallSave, restoreNightfallSave } from "./simulation.js";
import { createMetaProgress, exportMetaProgress } from "./garage.js";
export const SAVE_KEY = "gyaruinthemix-club-tour-v1";
export const META_KEY = "gyaruinthemix-garage-meta-v1";
export const NIGHTFALL_SAVE_KEY = "gyaruinthemix-nightfall-map-v1";
export function createSaveStore(storage) {
  function read(key) {
    try {
      return storage?.getItem(key) || null;
    } catch {
      return null;
    }
  }
  function write(key, value) {
    try {
      if (!storage) return false;
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
  return {
    loadNightfall: () => restoreNightfallSave(read(NIGHTFALL_SAVE_KEY)),
    saveNightfall(state) {
      const value = exportNightfallSave(state);
      if (!value) return { persisted: false, campaign: restoreNightfallSave(read(NIGHTFALL_SAVE_KEY)) };
      return { persisted: write(NIGHTFALL_SAVE_KEY, value), campaign: restoreNightfallSave(value) };
    },
    clearNightfall() {
      try {
        if (!storage) return false;
        storage.removeItem(NIGHTFALL_SAVE_KEY);
        return true;
      } catch { return false; }
    },
    loadCampaign: () => restoreCampaignSave(read(SAVE_KEY)),
    loadMeta: () => createMetaProgress(read(META_KEY)),
    saveCampaign(state) {
      const value = exportCampaignSave(state);
      if (!value) return { persisted: false, campaign: restoreCampaignSave(read(SAVE_KEY)) };
      return {
        persisted: write(SAVE_KEY, value),
        campaign: restoreCampaignSave(value),
      };
    },
    saveMeta: (meta) => write(META_KEY, exportMetaProgress(meta)),
  };
}
