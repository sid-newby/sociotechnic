import { useCallback, useEffect, useRef, useState } from "react";
import { getDetail, getJobs, jobUrl, request } from "./api";
import { errorMessage } from "./model";
import type { Detail, JobItem } from "./model";

export type Load<T> = { kind: "loading" } | { kind: "ready"; value: T; error: string | null } | { kind: "error"; message: string };
export function useConsole() {
  const [jobs, setJobs] = useState<Load<JobItem[]>>({ kind: "loading" });
  const [selected, setSelected] = useState(() => new URLSearchParams(location.hash.slice(1)).get("job") ?? "");
  const [detail, setDetail] = useState<Load<Detail>>({ kind: "loading" });
  const [connection, setConnection] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [revision, setRevision] = useState(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  const externallyOwned = detail.kind === "ready" && detail.value.driver.ownership.kind === "external";

  useEffect(() => {
    const controller = new AbortController();
    getJobs(controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setJobs({ kind: "ready", value, error: null });
      const first = value.find((job) => !job.archived);
      if (!selectedRef.current && first) setSelected(first.id);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setJobs((previous) => previous.kind === "ready" ? { ...previous, error: errorMessage(error) } : { kind: "error", message: errorMessage(error) });
    });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetail((previous) => previous.kind === "ready" && previous.value.job.id === selected ? previous : { kind: "loading" });
    getDetail(selected, controller.signal).then((value) => { if (!controller.signal.aborted) setDetail({ kind: "ready", value, error: null }); }).catch((error: unknown) => {
      if (!controller.signal.aborted) setDetail((previous) => previous.kind === "ready" && previous.value.job.id === selected ? { ...previous, error: errorMessage(error) } : { kind: "error", message: errorMessage(error) });
    });
    return () => controller.abort();
  }, [selected, revision]);

  useEffect(() => {
    const stream = new EventSource("/events");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastEvent = Date.now();
    const touch = () => { lastEvent = Date.now(); };
    const update = () => { touch(); if (!timer) timer = setTimeout(() => { timer = undefined; refresh(); }, 250); };
    stream.addEventListener("open", () => { touch(); setConnection("live"); refresh(); });
    stream.addEventListener("ping", touch);
    stream.addEventListener("jobs", update);
    stream.addEventListener("driver", update);
    stream.addEventListener("error", () => setConnection("reconnecting"));
    const polling = setInterval(() => {
      if (externallyOwned) refresh();
      if (stream.readyState !== EventSource.OPEN || Date.now() - lastEvent > 40_000) { setConnection("reconnecting"); refresh(); }
    }, 5000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stream.close(); clearInterval(polling); clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh, externallyOwned]);

  useEffect(() => {
    const onHash = () => { const id = new URLSearchParams(location.hash.slice(1)).get("job"); if (id) setSelected(id); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const select = (id: string) => { setSelected(id); const hash = new URLSearchParams(location.hash.slice(1)); hash.set("job", id); history.replaceState(null, "", `#${hash}`); };
  const setArchived = async (id: string, archived: boolean) => {
    await request(`${jobUrl(id)}/archive`, undefined, { archived });
    setJobs((previous) => previous.kind === "ready" ? { ...previous, value: previous.value.map((job) => job.id === id ? { ...job, archived } : job) } : previous);
    refresh();
  };
  return { jobs, selected, detail, connection, revision, refresh, select, setArchived };
}
