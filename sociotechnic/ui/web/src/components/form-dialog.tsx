import type { ComponentProps, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "cn";
import { DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

type Props = Omit<ComponentProps<typeof DialogContent>, "title"> & { title: ReactNode; description?: ReactNode; closeLabel?: string; busy?: boolean };
export function FormDialogContent({ title, description, closeLabel = "Close", busy = false, className, children, ...props }: Props) {
  return <DialogContent showCloseButton={false} className={cn("max-h-[calc(100dvh-2rem)] min-w-0 gap-6 overflow-y-auto p-6 text-base sm:max-w-2xl", className)} {...props}>
    <DialogHeader className="pr-10">
      <DialogTitle className="text-xl font-semibold leading-snug">{title}</DialogTitle>
      {description ? <DialogDescription className="text-sm leading-relaxed">{description}</DialogDescription> : null}
    </DialogHeader>
    <DialogClose asChild><Button type="button" variant="ghost" size="icon" className="absolute right-3 top-3" disabled={busy} aria-label={closeLabel}><X /></Button></DialogClose>
    {children}
  </DialogContent>;
}
