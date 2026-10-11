import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Eye, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TechLabel } from '@/components/ui/tech-label'
import { useBreadcrumb } from '@/hooks/useBreadcrumb'
import { getRun, queryKeys, runScreenshotUrl } from '@/lib/queries'
import {
  RUN_STATUS_LABEL, RUN_STATUS_TONE, UNREPORTED_FLOW_LABEL, formatAgo, formatDuration, runBuildLabel,
  pollWhileRunning, runDuration, runOutcomeText, runSourceLabel, shortCommit,
} from '@/lib/runs'
import type { RunDetail as Run, RunFlow } from '@/lib/types'

/**
 * One run: what each flow did, why it failed, and — while it is running — a link to watch it. The watch link is
 * the session the runner holds **now**, from the relay; a stored one would open whoever took the device next.
 */
export function RunDetail() {
  const { runId = '' } = useParams()
  const runQuery = useQuery({
    queryKey: queryKeys.run(runId),
    queryFn: ({ signal }) => getRun(runId, signal),
    refetchInterval: (query) => pollWhileRunning(query.state.data ? [query.state.data.status] : undefined),
  })
  const run = runQuery.data

  const { setNode: setBreadcrumb } = useBreadcrumb()
  useEffect(() => {
    setBreadcrumb(
      <span className="flex items-center gap-1.5 text-sm">
        <Link to="/automation/runs" className="text-muted-foreground hover:text-foreground">Runs</Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">{run ? runBuildLabel(run.build) : 'Run'}</span>
      </span>,
    )
    return () => setBreadcrumb(null)
  }, [setBreadcrumb, run])

  return (
    <div className="flex flex-col gap-5 p-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/automation/runs"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden />All runs</Link>
        </Button>
      </div>
      {run ? <RunBody run={run} />
        : run === null ? <p className="text-sm text-muted-foreground">This run is gone. A run is deleted with its build, or after 7 days when it has none.</p>
        : runQuery.isError ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load this run.
            <Button variant="outline" size="sm" className="ml-3" onClick={() => void runQuery.refetch()}>Try again</Button>
          </p>
        )
        : <p className="text-sm text-muted-foreground">Loading…</p>}
    </div>
  )
}

function RunBody({ run }: { run: Run }) {
  const outcome = runOutcomeText(run)
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{runBuildLabel(run.build)}</h1>
          <Badge tone={RUN_STATUS_TONE[run.status]} className="text-xs">{RUN_STATUS_LABEL[run.status]}</Badge>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{runSourceLabel(run)}</span>
          {run.ci?.commit && <TechLabel>{shortCommit(run.ci.commit)}</TechLabel>}
          <span>Started {formatAgo(run.createdAt)}</span>
          <span>{run.finishedAt ? 'Took' : 'Running for'} <TechLabel>{runDuration(run)}</TechLabel></span>
          {run.exitCode !== null && <span>Exit code <TechLabel>{run.exitCode}</TechLabel></span>}
        </p>
        <div className="flex flex-wrap gap-2">
          {run.watchSessionId && (
            <Button asChild size="sm">
              <Link to={`/automation/sessions/${encodeURIComponent(run.watchSessionId)}`}>
                <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden />Watch the device
              </Link>
            </Button>
          )}
          {run.ci?.jobUrl && (
            <Button asChild size="sm" variant="outline">
              <a href={run.ci.jobUrl} target="_blank" rel="noreferrer noopener">
                Open the CI run<ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden />
              </a>
            </Button>
          )}
          {run.build && (
            <Button asChild size="sm" variant="outline">
              <Link to={`/automation/runs?source=all&build=${run.build.id}`}>Other runs of this build</Link>
            </Button>
          )}
        </div>
        {/* Announced: on a running run this is where the outcome appears when the poll brings it. */}
        <p role="status" className="text-sm">{outcome ?? (run.status === 'running' ? 'Running. This page follows the run.' : '')}</p>
      </div>

      <ol className="flex flex-col gap-3" aria-label="Flows">
        {run.flows.map((flow) => <FlowItem key={flow.idx} runId={run.id} flow={flow} />)}
      </ol>
    </>
  )
}

type ReportedFlow = Extract<RunFlow, { status: 'passed' | 'failed' }>

function isReported(flow: RunFlow): flow is ReportedFlow {
  return flow.status === 'passed' || flow.status === 'failed'
}

function FlowItem({ runId, flow }: { runId: string; flow: RunFlow }) {
  return (
    <li className="rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{flow.name}</span>
        {isReported(flow) ? (
          <>
            <Badge tone={flow.status === 'passed' ? 'done' : 'rejected'} className="text-xs">
              {flow.status === 'passed' ? 'Passed' : flow.failureKind === 'environment' ? 'Environment problem' : 'Failed'}
            </Badge>
            <TechLabel className="text-muted-foreground">{formatDuration(flow.durationMs)}</TechLabel>
            {flow.device?.name && <span className="text-xs text-muted-foreground">{flow.device.name}</span>}
          </>
        ) : (
          <Badge tone={flow.status === 'running' ? 'progress' : 'backlog'} className="text-xs">{UNREPORTED_FLOW_LABEL[flow.status]}</Badge>
        )}
      </div>
      {flow.file && <TechLabel className="mt-1 block text-muted-foreground">{flow.file}</TechLabel>}
      {isReported(flow) && flow.status === 'failed' && (
        <div className="mt-3 flex flex-col gap-3">
          {flow.failureMessage && <p className="text-sm text-destructive">{flow.failureMessage}</p>}
          {flow.steps.length > 0 && (
            <ol className="flex flex-col gap-1 text-xs" aria-label={`Steps of ${flow.name}`}>
              {flow.steps.map((step) => (
                <li key={step.index} className="flex gap-2">
                  <span className={step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
                    {step.status === 'passed' ? '✓' : step.status === 'failed' ? '✗' : '–'}
                    <span className="sr-only"> {step.status}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    {step.name}
                    {step.message && <span className="block text-muted-foreground">{step.message}</span>}
                  </span>
                  <TechLabel className="text-muted-foreground">{formatDuration(step.durationMs)}</TechLabel>
                </li>
              ))}
            </ol>
          )}
          {flow.hasScreenshot && (
            <a href={runScreenshotUrl(runId, flow.idx)} target="_blank" rel="noreferrer" className="self-start">
              <img
                src={runScreenshotUrl(runId, flow.idx)}
                alt={`The screen when ${flow.name} failed`}
                loading="lazy"
                className="max-h-96 rounded-md border"
              />
            </a>
          )}
        </div>
      )}
    </li>
  )
}
