import type { ReactNode } from "react";
import { cn } from "cn";
import { Label } from "./ui/label";

export function Field({ label, htmlFor, help, helpId, className, children }: { label: ReactNode; htmlFor?: string; help?: ReactNode; helpId?: string; className?: string; children: ReactNode }) {
  return <div className={cn("grid min-w-0 gap-2", className)}>
    <Label htmlFor={htmlFor}>{label}</Label>
    {children}
    {help ? <p id={helpId} className="text-sm leading-relaxed text-muted-foreground">{help}</p> : null}
  </div>;
}

export function Muted({ id, className, children, role }: { id?: string; className?: string; children: ReactNode; role?: "status" }) {
  return <p id={id} role={role} className={cn("text-sm leading-relaxed text-muted-foreground", className)}>{children}</p>;
}

export function InlineError({ id, children }: { id?: string; children: ReactNode }) {
  return <p id={id} role="alert" className="text-sm break-words text-destructive">{children}</p>;
}
