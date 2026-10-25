import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { cachedPreset, DEFAULT_PRESET, DEFAULT_SCHEME, isPresetKey, loadPreset, presetOptions, presetVariables, type Preset, type PresetOption, type Scheme } from "./presets";

export const PRESET_STORAGE_KEY = "sociotechnic.theme";
export const SCHEME_STORAGE_KEY = "sociotechnic.scheme";

type ThemeState = { preset: string; scheme: Scheme };
type ThemeContextValue = ThemeState & { presets: readonly PresetOption[]; setPreset: (key: string) => void; setScheme: (scheme: Scheme) => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Without storage the choice lasts for this page only. */ }
}

export function storedTheme(): ThemeState {
  const preset = read(PRESET_STORAGE_KEY);
  const scheme = read(SCHEME_STORAGE_KEY);
  return { preset: isPresetKey(preset) ? preset : DEFAULT_PRESET, scheme: scheme === "light" || scheme === "dark" ? scheme : DEFAULT_SCHEME };
}

export function applyScheme(scheme: Scheme) {
  document.documentElement.classList.toggle("dark", scheme === "dark");
}

export function applyPreset(key: string, preset: Preset, scheme: Scheme) {
  const root = document.documentElement;
  for (const name of Array.from(root.style)) if (name.startsWith("--")) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(presetVariables(preset, scheme))) root.style.setProperty(`--${name}`, value);
  root.dataset.theme = key;
  applyScheme(scheme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(storedTheme);
  const { preset, scheme } = theme;

  useLayoutEffect(() => {
    applyScheme(scheme);
    const cached = cachedPreset(preset);
    if (cached) { applyPreset(preset, cached, scheme); return; }
    let current = true;
    loadPreset(preset).then((loaded) => { if (current) applyPreset(preset, loaded, scheme); }, () => {
      if (!current) return;
      write(PRESET_STORAGE_KEY, DEFAULT_PRESET);
      setTheme((value) => ({ ...value, preset: DEFAULT_PRESET }));
    });
    return () => { current = false; };
  }, [preset, scheme]);

  const value = useMemo<ThemeContextValue>(() => ({
    preset,
    scheme,
    presets: presetOptions,
    setPreset: (key) => {
      if (!isPresetKey(key)) return;
      write(PRESET_STORAGE_KEY, key);
      setTheme((current) => ({ ...current, preset: key }));
    },
    setScheme: (next) => {
      write(SCHEME_STORAGE_KEY, next);
      setTheme((current) => ({ ...current, scheme: next }));
    },
  }), [preset, scheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme requires ThemeProvider");
  return context;
}
