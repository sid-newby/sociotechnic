import { useEffect, useState } from "react";
import { ArrowDownUp, Check, ChevronDown, Clock3, Radio, Terminal, X } from "lucide-react";
import { sumTokens } from "../token-usage";
import { Badge, BuilderEvidence, Hint, Meter } from "./experience";
import { getRecord, request } from "../api";
import { errorMessage, parseChecks, parseProfiles, shortSha } from "../model";
import type { Checks, Detail, Dispatch, Round } from "../model";
import { aggregate, deadline, duration, elapsed, tokens } from "../telemetry";
import type { Load } from "../use-console";
import { Button } from "./ui/button";
import { AgentIcon, AgentName, agentLabel } from "./agent-identity";

function versionsFor(detail: Detail, agent: string): string | null { const values = [...new Set(detail.dispatches.filter((d) => d.agent === agent).map((d) => d.version))]; return values.every((v) => v === null) ? null : values.map((v) => v ?? "unrecorded").join(" / "); }

type TechnicalProps = { detail: Detail; openRecord: (path: string) => void };

function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return now;
}

function RecordButton({ detail, path, label, openRecord }: TechnicalProps & { path: string; label: string }) {
  return <Button variant="link" disabled={!detail.records.some((record) => record.path === path)} onClick={() => openRecord(path)}>{label}</Button>;
}

function DispatchHistory({ rows, detail, openRecord, now }: TechnicalProps & { rows: Dispatch[]; now: number }) {
  const [sort, setSort] = useState<{ key: "started" | "elapsed" | "agent"; descending: boolean }>({ key: "started", descending: false });
  const sorted = [...rows].sort((a, b) => {
    const left = sort.key === "elapsed" ? elapsed(a, now) : sort.key === "agent" ? a.agent : a.startedAt;
    const right = sort.key === "elapsed" ? elapsed(b, now) : sort.key === "agent" ? b.agent : b.startedAt;
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return sort.descending ? -result : result;
  });
  function changeSort(key: typeof sort.key) { setSort({ key, descending: sort.key === key ? !sort.descending : false }); }
  if (!rows.length) return <p className="technical-empty">No dispatches recorded for this selection.</p>;
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="Dispatch history, scroll horizontally for all columns"><table className="technical-table">
    <caption>Dispatch history · timestamps are ISO 8601 UTC; open Details for complete values</caption>
    <thead><tr>{([{ label: "Dispatch / start", key: "started" }, { label: "Agent / model", key: "agent" }, { label: "Round / attempt", key: null }, { label: "Elapsed", key: "elapsed" }, { label: "Deadline", key: null }, { label: "Outcome / result", key: null }, { label: "Evidence", key: null }] satisfies {label: string; key: typeof sort.key | null}[]).map(({label, key}) => <th scope="col" key={label} aria-sort={key === sort.key ? sort.descending ? "descending" : "ascending" : undefined}>{key ? <button className="sort-button" onClick={() => changeSort(key)}>{label}<ArrowDownUp size={12} /></button> : label}</th>)}</tr></thead>
    <tbody>{sorted.map((dispatch) => { const timing = deadline(dispatch, now); return <tr key={dispatch.id}>
      <th scope="row"><code>{dispatch.id}</code><details className="dispatch-details"><summary>Details</summary><dl className="metadata"><dt>Step / lens</dt><dd>{dispatch.step} / {dispatch.lens ?? "—"}</dd><dt>Started (UTC)</dt><dd>{dispatch.startedAt || "Not recorded"}</dd><dt>Finished (UTC)</dt><dd>{dispatch.finishedAt ?? (dispatch.outcome ? "Not recorded" : "Pending")}</dd><dt>Deadline (UTC)</dt><dd>{dispatch.deadlineAt || "Not recorded"}</dd><dt>Total tokens</dt><dd>{tokens(dispatch.usage.tokens)}</dd><dt>Uncached input</dt><dd>{tokens(dispatch.usage.breakdown?.input ?? null)}</dd><dt>Output</dt><dd>{tokens(dispatch.usage.breakdown?.output ?? null)}</dd><dt>Cache read</dt><dd>{tokens(dispatch.usage.breakdown?.cacheRead ?? null)}</dd><dt>Cache write</dt><dd>{tokens(dispatch.usage.breakdown?.cacheWrite ?? null)}</dd><dt>Reported duration</dt><dd>{duration(dispatch.usage.durationMs)}</dd><dt>Note</dt><dd>{dispatch.note || dispatch.reason || "None recorded"}</dd></dl></details></th>
      <td><span className="agent-inline"><AgentIcon name={dispatch.agent} size={16} /><AgentName name={dispatch.agent} version={dispatch.version} /></span><small>{dispatch.model} / {dispatch.effort}</small></td><td>{dispatch.round} / {dispatch.attempt}</td>
      <td>{duration(elapsed(dispatch, now))}{!dispatch.finishedAt && !dispatch.outcome ? <small>In flight</small> : null}</td>
      <td className={timing.late ? "inline-error" : ""}>{timing.label}</td><td><Badge value={dispatch.outcome ?? "Pending"} /><small>{dispatch.result ?? "No verdict"}</small></td>
      <td><RecordButton detail={detail} path={dispatch.record} label="Read record" openRecord={openRecord} /></td>
    </tr>; })}</tbody>
  </table></div>;
}

export function Activity({ detail, openRecord }: TechnicalProps) {
  const now = useClock();
  const [agent, setAgent] = useState("");
  const [outcome, setOutcome] = useState("");
  const [layout, setLayout] = useState<"feed" | "table">("feed");
  const agents = [...new Set(detail.dispatches.map((d) => d.agent))];
  const rows = detail.dispatches.filter((d) => (!agent || d.agent === agent) && (!outcome || (d.outcome ?? "pending") === outcome));
  const pending = detail.dispatches.filter((d) => !d.outcome && !d.finishedAt);
  return <div className="technical-view activity-view">
    <p className="technical-description">{detail.job.execution?.kind === "docker-sandbox" ? `Docker Sandbox · ${detail.job.execution.cpus} CPUs · ${detail.job.execution.memoryGiB} GiB · up to ${detail.job.execution.parallelAgents} ${detail.job.execution.parallelAgents === 1 ? "agent" : "agents"} at once. Files stay in the sandbox until committed work is imported for review.` : "Local execution · agents and repository checks run on this computer."}</p>
    <section className="technical-section driver-section"><div className="section-heading"><h2><Radio size={20} /> {detail.driver.running ? "Work in motion" : "The activity trail"}</h2><span>{detail.driver.running ? `Running · ${detail.driver.mode ?? "run"}` : pending.length ? "Dispatches pending" : "Idle in this server"}</span></div>
      <p className="technical-description">{detail.driver.startedAt ? `Driver started ${detail.driver.startedAt}. ` : ""}{detail.driver.lastStep ? `Last action: ${detail.driver.lastStep}. ` : ""}Live output is available for drivers owned by this server; recorded history remains below.</p>
      {detail.driver.error ? <p className="inline-error" role="alert">{detail.driver.error}</p> : null}
      {pending.map((dispatch) => { const active = detail.driver.active.find((a) => a.id === dispatch.id), timing = deadline(dispatch, now); return <div className="active-dispatch" key={dispatch.id}><div><strong className="agent-inline"><AgentIcon name={dispatch.agent} size={16} /><AgentName name={dispatch.agent} version={dispatch.version} /></strong> <code>{dispatch.id}</code></div><p>{duration(elapsed(dispatch, now))} elapsed · <span className={timing.late ? "inline-error" : ""}>{timing.label}</span></p>{Number.isFinite(Date.parse(dispatch.deadlineAt) - Date.parse(dispatch.startedAt)) && Date.parse(dispatch.deadlineAt) > Date.parse(dispatch.startedAt) ? <><Meter value={elapsed(dispatch, now) ?? 0} max={Date.parse(dispatch.deadlineAt) - Date.parse(dispatch.startedAt)} label="Dispatch deadline budget used" tone={timing.late ? "amber" : "blue"} /><small>Deadline budget used · not task completion</small></> : null}<p className="activity-line">{active?.lastActivity ?? "No live activity available from this server."}</p></div>; })}
      <details className="log-disclosure"><summary><Terminal size={16} aria-hidden="true" /> Live driver log ({detail.driver.log.length} lines)</summary><pre tabIndex={0} className="technical-log" aria-label="Driver log">{detail.driver.log.map((line) => `${line.at} [${line.level}] ${line.text}`).join("\n") || "No driver output available in this server session."}</pre></details>
    </section>
    <section className="technical-section"><div className="section-heading"><h2>Dispatch history <span className="count-chip">{detail.dispatches.length}</span></h2><div className="technical-filters"><label><span className="sr-only">Filter dispatches by agent</span><select value={agent} onChange={(event) => setAgent(event.target.value)}><option value="">All agents</option>{agents.map((name) => <option key={name} value={name}>{agentLabel(name)} · {versionsFor(detail, name) ? `v${versionsFor(detail, name)}` : "version unrecorded"}</option>)}</select></label><label><span className="sr-only">Filter dispatches by outcome</span><select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="">All outcomes</option><option value="pending">Pending</option><option value="ok">OK</option><option value="failed">Failed</option><option value="timeout">Timeout</option><option value="interrupted">Interrupted</option></select></label></div></div>
      <div className="view-switch" aria-label="Dispatch presentation"><Button variant={layout === "feed" ? "secondary" : "ghost"} aria-pressed={layout === "feed"} onClick={() => setLayout("feed")}>Timeline</Button><Button variant={layout === "table" ? "secondary" : "ghost"} aria-pressed={layout === "table"} onClick={() => setLayout("table")}>Technical grid</Button><span>Newest first in timeline</span></div>
      {layout === "table" ? <DispatchHistory rows={rows} detail={detail} openRecord={openRecord} now={now} /> : rows.length ? <ol className="dispatch-timeline">{[...rows].reverse().map((dispatch) => <li key={dispatch.id} className={dispatch.outcome === "ok" ? "tone-green" : dispatch.outcome ? "tone-amber" : "tone-blue"}><span className="timeline-mark">{dispatch.outcome === "ok" ? <Check size={17} /> : dispatch.outcome ? <X size={17} /> : <Clock3 size={17} />}</span><details><summary><div className="dispatch-identity"><strong className="agent-inline"><AgentIcon name={dispatch.agent} size={16} /><AgentName name={dispatch.agent} version={dispatch.version} /></strong><span>{dispatch.model} / {dispatch.effort} · round {dispatch.round}</span></div><div className="dispatch-result"><Badge value={dispatch.result || dispatch.outcome || "Pending"} /><strong>{duration(elapsed(dispatch, now))}</strong><ChevronDown size={16} /></div></summary><div className="dispatch-expanded"><dl className="metadata"><dt>Dispatch</dt><dd>{dispatch.id} · attempt {dispatch.attempt}</dd><dt>Started (UTC)</dt><dd>{dispatch.startedAt}</dd><dt>Deadline</dt><dd>{deadline(dispatch, now).label}</dd><dt>Total tokens</dt><dd>{tokens(dispatch.usage.tokens)}</dd><dt>Note</dt><dd>{dispatch.note || dispatch.reason || "None recorded"}</dd></dl><RecordButton detail={detail} path={dispatch.record} label="Read original record" openRecord={openRecord} /></div></details></li>)}</ol> : <p className="technical-empty">No dispatches match these filters.</p>}

    </section>
    <section className="technical-section"><h2>Human decisions</h2>{detail.human.length ? <ol className="decision-history">{detail.human.map((entry, i) => <li key={`${entry.at}-${i}`}><strong>{entry.action}</strong><time dateTime={entry.at}>{entry.at}</time><p>{entry.note || "No note recorded."}</p></li>)}</ol> : <p className="technical-empty">No human decisions recorded.</p>}</section>
  </div>;
}

function RoundEvidence({ round, detail, openRecord }: TechnicalProps & { round: Round }) {
  const [checks, setChecks] = useState<Load<Checks> | null>(null);
  const [retry, setRetry] = useState(0);
  const path = round.checks?.path;
  const modified = detail.records.find((r) => r.path === path)?.mtime;
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setChecks({ kind: "loading" });
    getRecord(detail.job.id, path, controller.signal).then((value) => {
      const parsed = parseChecks(JSON.parse(value));
      if (!controller.signal.aborted) setChecks({ kind: "ready", value: parsed, error: null });
    }).catch((error: unknown) => { if (!controller.signal.aborted) setChecks({ kind: "error", message: errorMessage(error) }); });
    return () => controller.abort();
  }, [detail.job.id, path, modified, retry]);
  const report = checks?.kind === "ready" ? checks.value : null;
  return <details className="round-evidence" open={round.n === detail.job.round}><summary><span className="round-number">{String(round.n).padStart(2, "0")}</span><span><strong>Round {round.n}{round.n === detail.job.round ? " · current" : ""}</strong><small>Started {round.startedAt || "not recorded"}</small></span><Badge value={round.gate ? round.gate.pass ? "Passed" : "Blocked" : "Gate pending"} /><ChevronDown size={18} /></summary><div className="round-content">
    <div className="round-grid"><div><h4>Build</h4><p>{round.build?.verdict ?? "Pending"} · <code>{shortSha(round.build?.commit ?? null)}</code></p>{round.build?.reason ? <p>{round.build.reason}</p> : null}<RecordButton detail={detail} path={`round-${round.n}/build.md`} label="Build record" openRecord={openRecord} />
      <h4>Checks</h4>{!path ? <p>Not recorded</p> : checks?.kind === "error" ? <div><p className="inline-error">{checks.message}</p><Button variant="outline" onClick={() => setRetry((n) => n + 1)}>Retry checks</Button></div> : !report ? <p role="status">Loading check results…</p> : <><p className={!report.configured || !report.pass ? "" : "positive"}>{!report.configured ? "No checks configured" : report.pass ? "Checks passed" : "Checks failed"}</p><p className="technical-description">Recorded at <code>{shortSha(report.commit)}</code>{round.gate && report.commit !== round.gate.head ? " · does not match gate commit" : ""}</p><ul className="check-results">{report.results.map((check, i) => <li key={`${check.name}-${i}`}><span>{check.name}</span><strong>{check.pass ? "Pass" : "Fail"}</strong></li>)}</ul></>}
      {round.n === detail.job.round ? <BuilderEvidence detail={detail} openRecord={openRecord} /> : null}
      {path ? <RecordButton detail={detail} path={path} label="Checks output" openRecord={openRecord} /> : null}</div>
      <div><h4>Reviews and conformance</h4>{round.reviews.length ? <ul className="review-results">{round.reviews.map((review) => {
        const path = `round-${round.n}/${review.name === "conformance" ? "conformance" : review.name.replace("reviewer-", "review-")}.md`;
        return <li key={review.name}><div className="review-result-heading"><RecordButton detail={detail} path={path} label={review.name} openRecord={openRecord} /><span><Badge value={review.verdict || "No verdict"} />{review.blocking ? ` · ${review.blocking} blocking` : ""}</span></div><p className="technical-description">Commit {shortSha(review.commit)}{round.gate && review.commit !== round.gate.head ? " · gate mismatch" : ""}{review.reason ? ` · ${review.reason}` : ""}</p>{review.findings.length ? <details className="review-findings" open={review.blocking > 0}><summary>{review.findings.length} findings{review.blocking ? ` · ${review.blocking} blocking` : " · advisory"}</summary><ul className="finding-list">{review.findings.map((finding, i) => <li key={i}><strong>{finding.severity}</strong> · <code>{finding.location}</code><p>{finding.text}</p></li>)}</ul></details> : null}</li>;
      })}</ul> : <p>No reviews recorded yet.</p>}</div></div>
    <div className="round-gate"><h4>Gate</h4>{round.gate ? <><p><strong>{round.gate.pass ? "Passed" : "Blocked"}</strong> · head <code>{shortSha(round.gate.head)}</code> · {round.gate.changedFiles} changed files</p><p className="technical-description">Computed {round.gate.computedAt || "not recorded"}</p><div className="gate-lists"><div><h5>Blockers</h5>{round.gate.blockers.length ? <ul>{round.gate.blockers.map((value, i) => <li key={i}>{value}</li>)}</ul> : <p>None recorded</p>}</div><div><h5>Flags</h5>{round.gate.flags.length ? <ul>{round.gate.flags.map((value, i) => <li key={i}>{value}</li>)}</ul> : <p>None recorded</p>}</div></div></> : <p>Not computed yet.</p>}</div>
  </div></details>;
}

export function Analysis({ detail, openRecord }: TechnicalProps) {
  const now = useClock();
  const rows = aggregate(detail.dispatches, now);
  const [sort, setSort] = useState<"tokens" | "median" | "agent">("tokens");
  const total = sumTokens(rows.map((row) => row.tokens));
  const breakdownMissing = rows.reduce((sum,row) => sum + row.breakdownMissing,0);
  const missing = rows.reduce((sum,row) => sum + row.tokensMissing,0);
  const completed = rows.reduce((sum,row) => sum + row.measuredDeadlines,0);
  const onTime = rows.reduce((sum,row) => sum + row.onTime,0);
  const sorted = [...rows].sort((a,b) => { if (sort === "agent") return a.agent.localeCompare(b.agent); const av = a[sort], bv = b[sort]; return av === null ? bv === null ? 0 : 1 : bv === null ? -1 : bv - av; });
  const maxTokens = Math.max(...rows.map((row) => row.tokens ?? 0), 0);
  return <div className="technical-view analysis-view">
    <section className="analysis-lead"><div className="spend-total token-total"><h2>Recorded tokens <Hint label="How tokens are counted">Uncached input + output + cache reads + cache writes across recorded dispatches. Reused context counts again on each request. This is activity, not unique text, a bill, or your remaining Max allowance. Missing totals are excluded.</Hint></h2><strong>{tokens(total)}</strong><p>{!rows.length ? "No dispatches recorded yet" : missing ? `${missing} ${missing === 1 ? "dispatch has" : "dispatches have"} unreported totals` : "All dispatch token totals reported"}</p></div><div className="deadline-score"><h2>Within deadline <Hint label="How deadline compliance is measured">Compares each recorded finish time to its deadline. Unfinished dispatches and missing timestamps are excluded; meeting a deadline does not establish quality.</Hint></h2><div><strong>{completed ? onTime : "—"}</strong><span>{completed ? `/ ${completed}` : "Not measured"}</span></div>{completed ? <Meter value={onTime} max={completed} label={`${onTime} of ${completed} measured dispatches within deadline`} tone={onTime === completed ? "green" : "amber"} /> : null}<p>Completed, measured dispatches</p></div></section>
    <section className="token-breakdown" aria-label="Token breakdown"><div className="section-heading"><h2>How tokens were used</h2><Hint label="About cached tokens">Cache reads reuse a previously cached prompt prefix. Cache writes create that prefix. These counters come from Claude Code; Sociotechnic does not configure a separate prompt cache. Missing breakdowns are excluded.</Hint></div><dl className="profile-grid">{([{ key: "input", label: "Uncached input" }, { key: "output", label: "Output" }, { key: "cacheRead", label: "Cache read" }, { key: "cacheWrite", label: "Cache write" }] satisfies {key: "input" | "output" | "cacheRead" | "cacheWrite"; label: string}[]).map(({key,label}) => <div key={key}><dt>{label}</dt><dd>{tokens(sumTokens(rows.map((row) => row[key])))}</dd></div>)}</dl>{breakdownMissing ? <p className="technical-description">{breakdownMissing} {breakdownMissing === 1 ? "dispatch has an incomplete breakdown" : "dispatches have incomplete breakdowns"}. Category subtotals may not add up to the total.</p> : null}</section>
    <section className="technical-section"><div className="section-heading"><h2>Where the effort went</h2><label className="sort-select">Sort by <select aria-label="Sort agent analysis" value={sort} onChange={(event) => { const value = event.target.value; if (value === "tokens" || value === "median" || value === "agent") setSort(value); }}><option value="tokens">Total tokens</option><option value="median">Median duration</option><option value="agent">Agent name</option></select></label></div>
      {!rows.length ? <p className="technical-empty">Measurements appear after agents are dispatched.</p> : <ol className="effort-list">{sorted.map((row) => <li key={row.agent}><div className="effort-role"><strong className="agent-inline"><AgentIcon name={row.agent} size={16} /><AgentName name={row.agent} version={versionsFor(detail, row.agent)} /></strong><small>{row.count} dispatches · {row.retries} retries</small></div><div className="effort-bar">{row.tokens !== null && maxTokens > 0 ? <Meter value={row.tokens} max={maxTokens} label={`${row.agent} ${tokens(row.tokens)} tokens; bars relative to highest token total`} /> : <span className="technical-description">{row.tokens === 0 ? "Zero reported tokens" : "Tokens not reported"}</span>}</div><div className="effort-value"><strong>{tokens(row.tokens)}</strong><small>{duration(row.median)} median</small>{row.tokensMissing ? <small>{row.tokensMissing} totals unreported</small> : null}</div></li>)}</ol>}
      <details className="more-detail"><summary>Full timing & usage grid</summary><p className="technical-description">Cumulative agent time can overlap; it is not wall time or token-generation speed. Missing measurements remain unavailable.</p><div className="table-scroll" tabIndex={0} role="region" aria-label="Agent timing and usage, scroll horizontally for all columns"><table className="technical-table"><caption>Completed dispatch timing; reported token totals include all measured dispatches</caption><thead><tr>{["Agent", "Dispatches / retries", "Median elapsed", "Cumulative time", "Within deadline", "Tokens", "Uncached input", "Output", "Cache read", "Cache write"].map((name) => <th scope="col" key={name}>{name}</th>)}</tr></thead><tbody>{sorted.map((row) => <tr key={row.agent}><th scope="row"><span className="agent-inline"><AgentIcon name={row.agent} size={16} /><AgentName name={row.agent} version={versionsFor(detail, row.agent)} /></span></th><td>{row.count} / {row.retries}</td><td>{duration(row.median)}<small>{row.measuredTimes} of {row.completed} completed measured</small></td><td>{duration(row.cumulative)}</td><td>{row.measuredDeadlines ? `${row.onTime} / ${row.measuredDeadlines}` : "Not measured"}</td><td>{tokens(row.tokens)}{row.tokensMissing ? <small>{row.tokensMissing} unreported</small> : null}</td>{(["input", "output", "cacheRead", "cacheWrite"] satisfies ("input" | "output" | "cacheRead" | "cacheWrite")[]).map((key) => <td key={key}>{tokens(row[key])}{row.breakdownMissing ? <small>{row.breakdownMissing} incomplete breakdowns</small> : null}</td>)}</tr>)}</tbody></table></div></details>
    </section>
    <section className="technical-section"><h2>Rounds ({detail.rounds.length})</h2>{[...detail.rounds].reverse().map((round) => <RoundEvidence key={round.n} round={round} detail={detail} openRecord={openRecord} />)}{!detail.rounds.length ? <p className="technical-empty">No build rounds yet. Planning evidence is in the records.</p> : null}</section>
    <details className="technical-section more-detail"><summary>Bounds and overrides</summary><dl className="metadata">{Object.entries(detail.job.caps).map(([bound, cap]) => <div className="bound-row" key={bound}><dt>{bound}</dt><dd>{cap} + {detail.overrides.filter((entry) => entry.bound === bound).length} overrides</dd></div>)}</dl>{detail.overrides.map((entry, i) => <p className="technical-description" key={i}>{entry.at} · {entry.bound}: {entry.note}</p>)}</details>
  </div>;
}

export function Agents({ detail, openRecord }: TechnicalProps) {
  const now = useClock();
  const [profiles, setProfiles] = useState<Load<ReturnType<typeof parseProfiles>>>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setProfiles({ kind: "loading" });
    request(`/api/meta?job=${encodeURIComponent(detail.job.id)}`, controller.signal).then((value) => { const parsed = parseProfiles(value); if (!controller.signal.aborted) setProfiles({ kind: "ready", value: parsed, error: null }); }).catch((error: unknown) => { if (!controller.signal.aborted) setProfiles({ kind: "error", message: errorMessage(error) }); });
    return () => controller.abort();
  }, [retry, detail.job.id]);
  if (profiles.kind === "loading") return <p className="loading-state" role="status">Loading agent profiles…</p>;
  if (profiles.kind === "error") return <div className="error-state" role="alert"><p>{profiles.message}</p><Button variant="outline" onClick={() => setRetry((n) => n + 1)}>Retry profiles</Button></div>;
  const name = selected || detail.dispatches[0]?.agent || profiles.value.roles[0]?.name;
  const profile = profiles.value.roles.find((role) => role.name === name);
  const history = detail.dispatches.filter((dispatch) => dispatch.agent === name);
  const names = [...new Set([...profiles.value.roles.map((role) => role.name), ...detail.dispatches.map((d) => d.agent)])];
  return <div className="technical-view agents-view"><div className="section-heading agent-heading"><h2>The agents behind this run</h2><Hint label="About agent profiles">Profiles show this run's pinned role configuration, or the baseline for older runs. Dispatch history retains the version, model and effort actually recorded.</Hint></div>{!profiles.value.valid ? <p className="inline-error" role="alert">Agent definitions differ from the role table: {profiles.value.problems.join("; ")}</p> : <p className="technical-description">Definitions match the configured role table.</p>}
    <div className="agent-workspace"><nav className="agent-roster" aria-label="Agent profiles">{names.map((agent) => { const count = detail.dispatches.filter((d) => d.agent === agent).length; return <button key={agent} aria-current={name === agent ? "true" : undefined} onClick={() => setSelected(agent)}><AgentIcon name={agent} size={18} /><span><strong><AgentName name={agent} version={profiles.value.roles.find((r) => r.name === agent)?.version ?? null} /></strong><small>{count ? `${count} dispatches in this run` : "Not dispatched in this run"}</small></span></button>; })}</nav><div className="agent-dossier">
      {profile ? <><div className="profile-title"><AgentIcon name={profile.name} size={32} /><h3><AgentName name={profile.name} version={profile.version} /></h3><span>{profile.model} / {profile.effort}</span></div><dl className="profile-budgets"><div><dt>Deadline budget</dt><dd>{profile.timeoutMinutes}<small>minutes / dispatch</small></dd></div><div><dt>{profile.provider === "codex" ? "Tool-call limit" : "Turn limit"}</dt><dd>{profile.maxTurns}<small>{profile.provider === "codex" ? "completed tools / dispatch" : "turns / dispatch"}</small></dd></div></dl><h4>Allowed tools</h4><ul className="tool-list">{profile.tools.map((tool) => <li key={tool}><code>{tool}</code></li>)}</ul><details className="more-detail"><summary>Record contract</summary><p><code>{profile.record}</code></p></details></> : <p className="technical-empty">This recorded agent is no longer in the current role table.</p>}
      <section className="agent-history"><h3>History in this run <span className="count-chip">{history.length}</span></h3><DispatchHistory rows={history} detail={detail} openRecord={openRecord} now={now} /></section>
    </div></div></div>;
}
