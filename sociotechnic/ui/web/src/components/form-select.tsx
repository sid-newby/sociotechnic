import type { ComponentProps, ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type Option = { value: string; label: ReactNode; disabled?: boolean };
type Props = Pick<ComponentProps<typeof SelectTrigger>, "id" | "aria-label" | "aria-describedby" | "aria-invalid"> & {
  value: string; onValueChange: (value: string) => void; options: Option[]; disabled?: boolean; placeholder?: string;
};

export function FormSelect({ value, onValueChange, options, disabled, placeholder, ...trigger }: Props) {
  const empty = "sociotechnic:default";
  const hasDefault = options.some((option) => option.value === "");
  return <Select value={value === "" && hasDefault ? empty : value} onValueChange={(next) => onValueChange(next === empty ? "" : next)} disabled={disabled}>
    <SelectTrigger className="h-10 w-full min-w-0 text-sm" {...trigger}><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
      {options.map((option) => <SelectItem key={option.value} value={option.value || empty} disabled={option.disabled} className="min-h-9 whitespace-normal text-sm">{option.label}</SelectItem>)}
    </SelectContent>
  </Select>;
}
