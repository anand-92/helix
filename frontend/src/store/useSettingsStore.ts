import { create } from 'zustand'
import { loadSettings, saveSettings, applyTheme, type AppSettings } from '@/lib/settings'

interface SettingsStore {
  /** Current (persisted) settings */
  settings: AppSettings

  /**
   * Save new settings to localStorage and update the store.
   * Throws if localStorage write fails.
   */
  updateSettings: (settings: AppSettings) => void

  /**
   * Re-read settings from localStorage (e.g. after external change).
   */
  reloadSettings: () => void
}

export const useSettingsStore = create<SettingsStore>()((set) => {
  // Load and apply on store initialization
  const initial = loadSettings()
  // Apply theme on first load (runs in browser context only)
  if (typeof window !== 'undefined') {
    applyTheme(initial.theme)
  }

  return {
    settings: initial,

    updateSettings: (settings: AppSettings) => {
      saveSettings(settings)
      applyTheme(settings.theme)
      set({ settings })
    },

    reloadSettings: () => {
      const settings = loadSettings()
      applyTheme(settings.theme)
      set({ settings })
    },
  }
})
