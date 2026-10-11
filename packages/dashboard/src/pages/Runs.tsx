import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { TechLabel } from '@/components/ui/tech-label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ListStateRow } from '@/components/ListStateRow'
import { useBreadcrumb } from '@/hooks/useBreadcrumb'
import { useFocusAfterSwap } from '@/hooks/useFocusAfterSwap'
import { listView } from '@/lib/list-view'
import { getRuns, queryKeys, type RunFilters } from '@/lib/queries'
import {
  RUN_STATUS_LABEL, RUN_STATUS_TONE, formatAgo, listPollInterval, runBuildLabel, runDuration, runSourceLabel,
} from '@/lib/runs'
import type { RunListItem, RunStatus } from '@/lib/types'

const FLOW_SEARCH_DEBOUNCE_MS = 300

type Source = 'ci' | 'local' | 'all'
const STATUSES: RunStatus[] = ['running', 'passed', 'failed', 'aborted']

/**
 * **What `tapflow flow run` did, for the whole team.** CI runs by default: those are the tests the team handed to
 * automation, while a local run is someone making a test and is one click away. The filters live in the URL, so a
 * filtered list is a link to send — App Center's build row links here with `?build=`.
 */
export function Runs() {
  const [params, setParams] = useSearchParams()
  const source = (['ci', 'local', 'all'] as const).find((s) => s === params.get('source')) ?? 'ci'
  const status = STATUSES.find((s) => s === params.get('status'))
  const buildParam = Number(params.get('build'))
  const build = Number.isInteger(buildParam) && buildParam > 0 ? buildParam : undefined
  const flow = params.get('flow') ?? ''

  const { setNode: setBreadcrumb } = useBreadcrumb()
  useEffect(() => {
    setBreadcrumb(<span className="text-sm font-medium">Flow Runs</span>)
    return () => setBreadcrumb(null)
  }, [setBreadcrumb])

  // Functional, so it reads the URL at the time it runs rather than the render that made it — the flow search
  // calls it from a timer.
  function setParam(key: string, value: string | null) {
    setParams((prev) => withParam(prev, key, value), { replace: true })
  }

  // The box follows what is typed at once; the URL, and so the query, after a pause.
  const [flowInput, setFlowInput] = useState(flow)
  // **And the box follows the URL when something else changes it** — the sidebar's Runs link, back and
  // forward. Without this the box kept the old text and the effect below wrote it back 300 ms later, so
  // clearing the filters cleared every one but the flow. Compared trimmed, or the URL the debounce just
  // wrote ("log") would eat the space someone is typing ("log ").
  const [seenFlow, setSeenFlow] = useState(flow)
  if (flow !== seenFlow) {
    setSeenFlow(flow)
    if (flow !== flowInput.trim()) setFlowInput(flow)
  }
  useEffect(() => {
    const wanted = flowInput.trim()
    if (wanted === flow) return
    const t = setTimeout(() => setParams((prev) => withParam(prev, 'flow', wanted || null), { replace: true }), FLOW_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [flowInput, flow, setParams])

  const filters: RunFilters = {
    ...(source === 'all' ? {} : { ci: source === 'ci' }),
    ...(status ? { status } : {}),
    ...(flow ? { flow } : {}),
    ...(build !== undefined ? { build } : {}),
  }
  const runsQuery = useInfiniteQuery({
    queryKey: queryKeys.runs(filters),
    queryFn: ({ pageParam, signal }) => getRuns(filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // A filter change keeps the old rows up until the new ones arrive, rather than flashing the skeleton.
    placeholderData: keepPreviousData,
    // Only while the first page alone is loaded. A refetch of an infinite query fetches every page it holds, one after
    // another, so a list paged back three times would send four requests every few seconds. A run in progress is on
    // the first page anyway — the newest — and its own page keeps following it.
    refetchInterval: (query) => listPollInterval(query.state.data?.pages),
  })
  const runs = runsQuery.data?.pages.flatMap((p) => p.items)
  // **A failed filter being fetched again is still the failure**, as App Center holds it (see there): a retry puts
  // the key back to pending, `keepPreviousData` fills it with the previous filter's rows, and the view would turn
  // into a list of runs that do not match the filters on screen — with focus moved into them. `isFetchedAfterMount`
  // keeps it to the failure that was on screen.
  const refetchingAFailure = runsQuery.isFetchedAfterMount && (runsQuery.isPlaceholderData || runsQuery.isLoading)
  // `isLoadingError`, not `isError`: a failed poll or a failed "Show older runs" keeps the rows already on screen,
  // where `isError` turned the whole list into the failure and moved focus to its button.
  const view = refetchingAFailure ? 'error' : listView({ data: runs, isError: runsQuery.isLoadingError })
  const sourceTabsRef = useRef<HTMLButtonElement>(null)
  const listRegion = useFocusAfterSwap<HTMLTableSectionElement>(view, sourceTabsRef)

  // Named from a row when one is on screen; the id alone when the filter matches nothing.
  const buildOnScreen = build === undefined ? undefined : runs?.find((r) => r.build?.id === build)?.build
  const buildName = build === undefined ? null : buildOnScreen ? runBuildLabel(buildOnScreen) : `build ${build}`

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Flow Runs</h1>
        <p className="text-sm text-muted-foreground">
          What <TechLabel>tapflow flow run</TechLabel> recorded: each flow&apos;s result, its steps and a screenshot of a failure.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={source} onValueChange={(v) => setParam('source', v === 'ci' ? null : v)}>
          <TabsList aria-label="Where the run came from">
            {/* Broadest first, as filters read; the page still opens on CI (see `source`). Focus falls back to the
                first tab when a swap removes the focused row. */}
            <TabsTrigger ref={sourceTabsRef} value="all">All</TabsTrigger>
            <TabsTrigger value="ci">CI</TabsTrigger>
            <TabsTrigger value="local">Local</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={status ?? 'any'} onValueChange={(v) => setParam('status', v === 'any' ? null : v)}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any status</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{RUN_STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <SearchInput value={flowInput} onChange={setFlowInput} placeholder="Flow name" aria-label="Flow name" />
        {buildName && (
          <Badge variant="outline" className="gap-1 pr-1 text-xs font-normal">
            {buildName}
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-5 w-5"
              aria-label={`Show runs of every build, not only ${buildName}`}
              onClick={() => setParam('build', null)}
            >
              <X className="h-3 w-3" aria-hidden />
            </Button>
          </Badge>
        )}
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Build</TableHead>
              <TableHead>Flows</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          {/* Busy while the rows are the previous filter's, held until this one's arrive. */}
          <TableBody {...listRegion} aria-busy={runsQuery.isPlaceholderData}>
            <ListStateRow
              view={view}
              colSpan={6}
              noun="flow runs"
              emptyText={emptyText(source, Boolean(status || flow || build !== undefined))}
              onRetry={() => void runsQuery.refetch()}
            />
            {view === 'list' && runs?.map((run) => <RunRow key={run.id} run={run} />)}
          </TableBody>
        </Table>
      </div>

      {runsQuery.hasNextPage && (
        <div>
          {/* `aria-disabled`, not `disabled`: a disabled button drops the focus it holds to `body`. */}
          <Button
            variant="outline"
            size="sm"
            className="aria-disabled:opacity-50"
            aria-disabled={runsQuery.isFetchingNextPage}
            onClick={() => { if (!runsQuery.isFetchingNextPage) void runsQuery.fetchNextPage() }}
          >
            {runsQuery.isFetchingNextPage ? 'Loading…' : 'Show older runs'}
          </Button>
        </div>
      )}
    </div>
  )
}

function withParam(prev: URLSearchParams, key: string, value: string | null): URLSearchParams {
  const next = new URLSearchParams(prev)
  if (value === null) next.delete(key)
  else next.set(key, value)
  return next
}

function emptyText(source: Source, filtered: boolean): string {
  if (filtered) return 'No runs match these filters.'
  if (source === 'ci') return 'No CI runs yet. A run is recorded when tapflow flow run has a token.'
  if (source === 'local') return 'No local runs yet.'
  return 'No runs yet. A run is recorded when tapflow flow run has a token.'
}

function RunRow({ run }: { run: RunListItem }) {
  const navigate = useNavigate()
  const href = `/automation/runs/${run.id}`
  const build = runBuildLabel(run.build)
  const done = run.flowsPassed + run.flowsFailed
  return (
    // **The whole row opens the run**, as a CI run list does, and the build name is the one link in it: a mouse
    // gets the row, a keyboard or a screen reader gets one stop per row with a name that says which run. A click
    // that lands on the link is the link's own; the row only handles the rest, with Cmd/Ctrl for a new tab as a
    // link would.
    <TableRow
      className="cursor-pointer"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return
        if (e.metaKey || e.ctrlKey) window.open(href, '_blank', 'noopener')
        else void navigate(href)
      }}
    >
      <TableCell>
        <Badge tone={RUN_STATUS_TONE[run.status]} className="text-xs">{RUN_STATUS_LABEL[run.status]}</Badge>
      </TableCell>
      <TableCell className="text-sm">
        {/* The visible name first, so voice control can say what it reads. */}
        <Link
          to={href}
          className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${build}, ${RUN_STATUS_LABEL[run.status]}, ${formatAgo(run.createdAt)}`}
        >
          {build}
        </Link>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        {run.status === 'running' ? (
          <><TechLabel>{done}/{run.flowsTotal}</TechLabel> <span className="text-muted-foreground">done</span></>
        ) : (
          <>
            <TechLabel>{run.flowsPassed}/{run.flowsTotal}</TechLabel> <span className="text-muted-foreground">passed</span>
            {run.flowsFailed > 0 && (
              <span className="text-destructive"> · <TechLabel>{run.flowsFailed}</TechLabel> failed</span>
            )}
          </>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{runSourceLabel(run)}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{formatAgo(run.createdAt)}</TableCell>
      <TableCell><TechLabel>{runDuration(run)}</TechLabel></TableCell>
    </TableRow>
  )
}
