export type Scheme = "light" | "dark";
export type PresetVariables = Record<string, string>;
export type Preset = { name: string; cssVars: { theme: PresetVariables; light: PresetVariables; dark: PresetVariables } };
export type PresetOption = { key: string; label: string };

export const DEFAULT_PRESET = "shadcn-neutral";
export const DEFAULT_SCHEME: Scheme = "dark";

const presetKey = (file: string) => file.slice(file.lastIndexOf("/") + 1, -".json".length);
const neutral = Object.values(import.meta.glob<Preset>("./presets/shadcn-neutral.json", { eager: true, import: "default" }))[0];
const loaders = new Map(Object.entries(import.meta.glob<Preset>(["./presets/*.json", "!./presets/shadcn-neutral.json"], { import: "default" })).map(([file, load]) => [presetKey(file), load]));
const label = (key: string) => key === DEFAULT_PRESET ? "shadcn Neutral" : key.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");

export const presetOptions: readonly PresetOption[] = [DEFAULT_PRESET, ...[...loaders.keys()].sort()].map((key) => ({ key, label: label(key) }));

export const isPresetKey = (key: unknown): key is string => key === DEFAULT_PRESET || (typeof key === "string" && loaders.has(key));

const loaded = new Map<string, Preset>([[DEFAULT_PRESET, neutral]]);

export const cachedPreset = (key: string) => loaded.get(key);

export async function loadPreset(key: string): Promise<Preset> {
  const cached = loaded.get(key);
  if (cached) return cached;
  const load = loaders.get(key);
  if (!load) throw new Error(`Unknown theme preset: ${key}`);
  const preset = await load();
  loaded.set(key, preset);
  return preset;
}

export const presetVariables = (preset: Preset, scheme: Scheme): PresetVariables => ({ ...preset.cssVars.theme, ...preset.cssVars.light, ...(scheme === "dark" ? preset.cssVars.dark : {}) });
