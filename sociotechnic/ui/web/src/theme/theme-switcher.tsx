import { Moon, Sun } from "lucide-react";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { useTheme } from "./provider";

export function ThemeSwitcher() {
  const { preset, scheme, presets, setPreset, setScheme } = useTheme();
  const next = scheme === "dark" ? "light" : "dark";
  return <>
    <Select value={preset} onValueChange={setPreset}>
      <SelectTrigger aria-label="Theme preset" className="theme-preset"><SelectValue /></SelectTrigger>
      <SelectContent position="popper" align="end">{presets.map(({ key, label }) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
    </Select>
    <Button variant="ghost" size="icon" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`} onClick={() => setScheme(next)}>{scheme === "dark" ? <Sun /> : <Moon />}</Button>
  </>;
}
