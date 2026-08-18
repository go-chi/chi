/**
 * Verify fragment links against the HTML emitted by VitePress. Markdown and
 * VitePress use different heading-slug algorithms, so source-link validation
 * alone cannot prove that a published fragment exists.
 *
 * This runs as part of `docs:build` and can also run directly after a build
 * with `tsx scripts/verify-doc-site-fragments.ts`.
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { JSDOM } from 'jsdom'

const root = resolve(import.meta.dirname, '..')

/** One fragment reference that does not resolve in the built site. */
export interface BrokenSiteFragment {
  /** HTML file containing the link. */
  source: string
  /** Link value as emitted by VitePress. */
  href: string
  /** Built HTML target, or `undefined` when the route was not emitted. */
  target?: string
  /** Decoded fragment id requested by the link. */
  fragment: string
}

/** Result of checking every fragment-bearing anchor in a built site. */
export interface SiteFragmentReport {
  /** Number of internal fragment references inspected. */
  checked: number
  /** References whose route or fragment id is absent. */
  broken: BrokenSiteFragment[]
}

interface BuiltPage {
  file: string
  route: string
  ids: Set<string>
  document: Document
}

function posixPath(path: string): string {
  return path.split(sep).join('/')
}

function routeFor(file: string): string {
  if (file === 'index.html') return '/'
  if (file.endsWith('/index.html')) return `/${file.slice(0, -'index.html'.length)}`
  return `/${file.slice(0, -'.html'.length)}`
}

function aliasesFor(page: BuiltPage): string[] {
  if (page.route === '/') return ['/', '/index', '/index.html']
  if (page.route.endsWith('/')) {
    const stem = page.route.slice(0, -1)
    return [page.route, stem, `${stem}/index`, `${stem}/index.html`]
  }
  return [page.route, `${page.route}.html`]
}

function decodedFragment(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1))
  } catch (error) {
    if (!(error instanceof URIError)) throw error
    // URIError means malformed percent encoding; preserve the literal id for comparison.
    return hash.slice(1)
  }
}

/**
 * Check fragment-bearing links in a VitePress output directory.
 *
 * @param distRoot - Directory containing generated HTML files.
 * @returns Counted internal links and every unresolved target.
 */
export function inspectSiteFragments(distRoot: string): SiteFragmentReport {
  const files = globSync('**/*.html', { cwd: distRoot }).map(posixPath).sort()
  if (files.length === 0) {
    throw new Error(`verify-doc-site-fragments: no HTML files found under ${distRoot}; run docs:build first.`)
  }
  const pages: BuiltPage[] = files.map((file) => {
    const document = new JSDOM(readFileSync(resolve(distRoot, file), 'utf8')).window.document
    const ids = new Set<string>()
    for (const element of document.querySelectorAll<HTMLElement>('[id]')) ids.add(element.id)
    for (const element of document.querySelectorAll<HTMLAnchorElement>('a[name]')) {
      const name = element.getAttribute('name')
      if (name !== null) ids.add(name)
    }
    return { file, route: routeFor(file), ids, document }
  })

  const byRoute = new Map<string, BuiltPage>()
  for (const page of pages) {
    for (const alias of aliasesFor(page)) {
      const existing = byRoute.get(alias)
      if (existing !== undefined && existing !== page) {
        throw new Error(
          `verify-doc-site-fragments: built pages ${existing.file} and ${page.file} share route ${JSON.stringify(alias)}.`,
        )
      }
      byRoute.set(alias, page)
    }
  }

  const origin = 'https://dsh-docs.invalid'
  const broken: BrokenSiteFragment[] = []
  let checked = 0
  for (const page of pages) {
    for (const anchor of page.document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const href = anchor.getAttribute('href')
      if (href === null || !href.includes('#')) continue
      let targetUrl: URL
      try {
        targetUrl = new URL(href, `${origin}${page.route}`)
      } catch (error) {
        throw new Error(
          `verify-doc-site-fragments: ${page.file} has invalid fragment href ${JSON.stringify(href)}.`,
          { cause: error },
        )
      }
      if (targetUrl.origin !== origin || targetUrl.hash === '') continue
      const fragment = decodedFragment(targetUrl.hash)
      if (fragment === '') continue
      checked++
      const target = byRoute.get(targetUrl.pathname)
      if (target === undefined || !target.ids.has(fragment)) {
        broken.push({
          source: page.file,
          href,
          ...(target === undefined ? {} : { target: target.file }),
          fragment,
        })
      }
    }
  }
  return { checked, broken }
}

function main(): number {
  const distRoot = resolve(root, 'website/.dist')
  const report = inspectSiteFragments(distRoot)
  if (report.broken.length === 0) {
    console.log(`verify-doc-site-fragments: ${report.checked} internal fragment reference(s) resolve.`)
    return 0
  }

  console.error(`verify-doc-site-fragments: ${report.broken.length} broken fragment reference(s):`)
  for (const item of report.broken) {
    const target = item.target === undefined ? 'target route was not built' : `${item.target} has no id ${JSON.stringify(item.fragment)}`
    console.error(`  ${item.source}: ${JSON.stringify(item.href)} (${target})`)
  }
  return 1
}

if (import.meta.main) process.exitCode = main()
