import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

// A component spec in `packages/dashboard/design/components/` is what an outside designer builds the
// Figma file from, and it is a hand copy of a `cva` definition. Hand copies drift: before this check
// existed, DESIGN.md's Button size table had already lost `icon-sm` while three call sites used it.
//
// So each spec names its source in frontmatter (`source`, `cva`), and every axis of that `cva` must
// appear as a `### \`axis\`` heading whose table lists exactly the same values. Axes that are not in
// `cva` (`state` is CSS, not a prop) are the spec's own and are not checked here.
//
// Reading nothing must fail, not pass. A `cva` name that no longer exists, or a refactor that moves the
// variants somewhere this cannot see, would otherwise compare an empty set to whatever the spec says
// about an axis it then never looks at — green, and checking nothing.

const root = join(import.meta.dirname, '../..')
const dashboard = join(root, 'packages/dashboard')
const specDir = join(dashboard, 'design/components')

const nameOf = (n) => (ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : null)

/** `{ axis: [values] }` from `const <cvaName> = cva(base, { variants: { … } })`. Throws if not found. */
export function cvaAxes(sourceText, cvaName) {
  const sf = ts.createSourceFile('x.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = null
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && nameOf(n.name) === cvaName && n.initializer && ts.isCallExpression(n.initializer)) {
      const config = n.initializer.arguments[1]
      if (config && ts.isObjectLiteralExpression(config)) {
        const variants = config.properties.find((p) => ts.isPropertyAssignment(p) && nameOf(p.name) === 'variants')
        if (variants && ts.isObjectLiteralExpression(variants.initializer)) {
          found = {}
          for (const axis of variants.initializer.properties) {
            if (!ts.isPropertyAssignment(axis) || !ts.isObjectLiteralExpression(axis.initializer)) continue
            found[nameOf(axis.name)] = axis.initializer.properties.map((v) => nameOf(v.name)).filter(Boolean)
          }
        }
      }
    }
    if (!found) ts.forEachChild(n, visit)
  }
  visit(sf)
  if (!found || Object.keys(found).length === 0 || Object.values(found).some((v) => v.length === 0)) {
    throw new Error(`no cva variants found for \`${cvaName}\``)
  }
  return found
}

/** `{ axis: [values] }` from each `### \`axis\`` heading and the first column of the table below it. */
export function specAxes(markdown) {
  const axes = {}
  let current = null
  for (const line of markdown.split('\n')) {
    const heading = /^###\s+`([^`]+)`\s*$/.exec(line)
    if (heading) { current = heading[1]; axes[current] = []; continue }
    if (/^#{1,3}\s/.test(line)) { current = null; continue }
    const cell = current && /^\|\s*`([^`]+)`\s*\|/.exec(line)
    if (cell) axes[current].push(cell[1])
  }
  return axes
}

export function frontmatter(markdown) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(markdown)
  if (!m) return {}
  return Object.fromEntries(m[1].split('\n').map((l) => l.split(/:\s*/, 2)).filter((kv) => kv.length === 2))
}

/** Differences between code and spec, as readable lines. Empty means they agree. */
export function drift(code, spec) {
  const out = []
  for (const [axis, values] of Object.entries(code)) {
    const written = spec[axis]
    if (!written) { out.push(`axis \`${axis}\` has no "### \`${axis}\`" section`); continue }
    for (const v of values) if (!written.includes(v)) out.push(`${axis}: \`${v}\` is in code, missing from the spec`)
    for (const v of written) if (!values.includes(v)) out.push(`${axis}: \`${v}\` is in the spec, not in code`)
  }
  return out
}

const specs = readdirSync(specDir).filter((f) => f.endsWith('.md'))

describe('component specs match the cva they name', () => {
  it('finds at least one spec', () => expect(specs.length).toBeGreaterThan(0))

  for (const file of specs) {
    it(file, () => {
      const md = readFileSync(join(specDir, file), 'utf8')
      const { source, cva } = frontmatter(md)
      expect(source, `${file}: frontmatter needs \`source\``).toBeTruthy()
      expect(cva, `${file}: frontmatter needs \`cva\``).toBeTruthy()
      const code = cvaAxes(readFileSync(join(dashboard, source), 'utf8'), cva)
      expect(drift(code, specAxes(md))).toEqual([])
    })
  }
})

describe('DESIGN.md links every spec, and every link resolves', () => {
  const design = readFileSync(join(dashboard, 'DESIGN.md'), 'utf8')
  const linked = [...design.matchAll(/\]\(\.\/design\/components\/([\w-]+\.md)\)/g)].map((m) => m[1])

  it('links at least one spec', () => expect(linked.length).toBeGreaterThan(0))
  for (const f of linked) it(`${f} exists`, () => expect(existsSync(join(specDir, f))).toBe(true))
  for (const f of specs) it(`${f} is linked`, () => expect(linked).toContain(f))
})

// The parsers above decide what "agree" means, so they are held to cases where the answer is known.
describe('the check itself', () => {
  const source = `const v = cva('b', { variants: { size: { sm: '', 'icon-sm': '' }, tone: { a: '' } } })`

  it('reads identifier and string-literal keys', () => {
    expect(cvaAxes(source, 'v')).toEqual({ size: ['sm', 'icon-sm'], tone: ['a'] })
  })
  it('throws on a cva name that is not there, instead of comparing nothing', () => {
    expect(() => cvaAxes(source, 'gone')).toThrow(/no cva variants/)
  })
  it('throws when the variants are not a literal it can read', () => {
    expect(() => cvaAxes(`const v = cva('b', { variants: shared })`, 'v')).toThrow(/no cva variants/)
  })
  it('reports a value missing from the spec, one the code lacks, and an absent axis', () => {
    const spec = specAxes('### `size`\n\n| Value |\n|---|\n| `sm` |\n| `xl` |\n\n## Usage\n| `ignored` |\n')
    expect(drift(cvaAxes(source, 'v'), spec)).toEqual([
      'size: `icon-sm` is in code, missing from the spec',
      'size: `xl` is in the spec, not in code',
      'axis `tone` has no "### `tone`" section',
    ])
  })
})
