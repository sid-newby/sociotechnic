import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip>
    <TooltipTrigger asChild><button type="button" aria-label={label} className="inline-flex size-6 items-center justify-center rounded-full align-middle text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"><CircleHelp className="size-3.5" /></button></TooltipTrigger>
    <TooltipContent className="max-w-xs text-sm leading-relaxed">{children}</TooltipContent>
  </Tooltip>;
}
