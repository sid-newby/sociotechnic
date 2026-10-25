import type { ReactNode } from "react";
import { Command, Radio } from "lucide-react";
import { Button } from "../ui/button";
import { SidebarTrigger } from "../ui/sidebar";
import { Separator } from "../ui/separator";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../ui/breadcrumb";
import { ThemeSwitcher } from "../../theme/theme-switcher";
import { RunStatusBadge } from "../run/status";
import type { Detail } from "../../model";
import { runTitle } from "../../model";
export function SiteHeader({ detail, title, connection, commands, children }: { detail?: Detail; title?: string; connection: "connecting" | "live" | "reconnecting"; commands: () => void; children?: ReactNode }) {
  return <header className="flex min-h-16 shrink-0 items-center gap-2 border-b px-4 sm:gap-3 sm:px-6"><SidebarTrigger className="-ml-1" /><Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" /><Breadcrumb className="min-w-0 flex-1"><BreadcrumbList className="flex-nowrap"><BreadcrumbItem className="hidden sm:inline-flex">Runs</BreadcrumbItem><BreadcrumbSeparator className="hidden sm:block" /><BreadcrumbItem className="min-w-0"><BreadcrumbPage className="truncate" title={detail ? runTitle(detail.job.feature, detail.plan) : title}>{detail ? runTitle(detail.job.feature, detail.plan) : title ?? "Runs"}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>{detail ? <div className="hidden min-[850px]:block"><RunStatusBadge status={detail.job.status} running={detail.driver.running} /></div> : null}<span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={connection === "live" ? "Connected to this console" : "Reconnecting to this console"}><Radio className={`size-3.5 ${connection === "live" ? "text-foreground" : "motion-safe:animate-pulse"}`} /><span className="hidden lg:inline">{connection === "live" ? "Live" : connection === "connecting" ? "Connecting…" : "Reconnecting…"}</span></span><div className="hidden min-[1500px]:flex min-w-0 items-center gap-1"><ThemeSwitcher /></div><Button variant="outline" onClick={commands} aria-label="Commands"><Command /><span className="hidden xl:inline">Commands</span></Button>{children}</header>;
}
