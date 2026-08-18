/** Tests for the documentation website projection adapter. */

import { execFileSync } from 'node:child_process'
import { existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { docsPages, landingLink, routeLink, sectionSpec, type DocsPage } from '../website/docs.ts'
import {
  addProjectionFrontmatter, projectedPageContent, publishableImage, resolveRepositoryRef, rewriteMarkdown,
} from './project-doc-site.ts'

const roots: string[] = []
const repositoryRoot = resolve(import.meta.dirname, '..')

function unexpectedWebsiteMarkdown(files: readonly string[]): string[] {
  return files.filter(file => file.endsWith('.md') && file !== 'website/AGENTS.md').sort()
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): { root: string; pages: DocsPage[] } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-doc-site-'))
  roots.push(root)
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(join(root, 'packages'), { recursive: true })
  writeFileSync(join(root, 'docs/a.md'), '# A\n')
  writeFileSync(join(root, 'docs/b.md'), '# B\n')
  writeFileSync(join(root, 'docs/x(y).md'), '# Parentheses\n')
  writeFileSync(join(root, 'packages/tool.ts'), 'one\ntwo\n')
  writeFileSync(join(root, 'packages/logo.svg'), '<svg/>\n')
  return {
    root,
    pages: [
      { locale: 'root', contentLocale: 'en-US', source: 'docs/a.md', route: 'a.md', label: 'A', sidebar: 'zh-reference', section: 'Test', order: 1 },
      { locale: 'root', contentLocale: 'en-US', source: 'docs/b.md', route: 'reference-root/b.md', label: 'B', sidebar: 'zh-reference', section: 'Test', order: 2 },
      { locale: 'en', contentLocale: 'en-US', source: 'docs/a.md', route: 'en/a.md', label: 'A', sidebar: 'en-reference', section: 'Test', order: 1 },
      { locale: 'en', contentLocale: 'en-US', source: 'docs/b.md', route: 'en/reference/b.md', label: 'B', sidebar: 'en-reference', section: 'Test', order: 2 },
    ],
  }
}

describe('website source layout', () => {
  it('rejects Markdown outside the subtree instructions', () => {
    expect(unexpectedWebsiteMarkdown([
      'website/AGENTS.md',
      'website/docs.ts',
      'website/zh-CN/api/harness/service.md',
    ])).toEqual(['website/zh-CN/api/harness/service.md'])
  })

  it('contains no tracked or unignored documentation copies', () => {
    const files = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'website'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    ).split('\n').filter(file => file !== '' && existsSync(resolve(repositoryRoot, file)))

    expect(
      unexpectedWebsiteMarkdown(files),
      'Keep canonical Markdown under docs/ and publish it through website/docs.ts.',
    ).toEqual([])
  })
})

describe('publishableImage', () => {
  it('accepts a regular file inside the repository', () => {
    const { root } = fixture()
    const real = realpathSync(join(root, 'packages/logo.svg'))
    expect(publishableImage(join(root, 'packages/logo.svg'), realpathSync(root))).toBe(real)
  })

  it('refuses a target whose real path escapes the repository', () => {
    // Publication copies the bytes onto the site, so a reference reaching a
    // build-machine file must not be treated as an image the repository owns.
    const { root } = fixture()
    const outside = mkdtempSync(join(tmpdir(), 'dsh-doc-site-outside-'))
    roots.push(outside)
    writeFileSync(join(outside, 'secret.png'), 'not really a png\n')
    symlinkSync(join(outside, 'secret.png'), join(root, 'packages/linked.png'))

    expect(publishableImage(join(root, 'packages/linked.png'), realpathSync(root))).toBeUndefined()
    expect(publishableImage(join(outside, 'secret.png'), realpathSync(root))).toBeUndefined()
  })

  it('refuses a directory', () => {
    const { root } = fixture()
    expect(publishableImage(join(root, 'packages'), realpathSync(root))).toBeUndefined()
  })
})

describe('resolveRepositoryRef', () => {
  it('defaults to public master instead of a private workflow SHA', () => {
    expect(resolveRepositoryRef({ GITHUB_SHA: 'private-sha' })).toBe('master')
  })

  it('accepts an explicit public repository ref', () => {
    expect(resolveRepositoryRef({ DOCS_REPOSITORY_REF: 'public-sha' })).toBe('public-sha')
  })
})

describe('rewriteMarkdown', () => {
  it('maps published pages and pins unpublished source links', () => {
    const { root, pages } = fixture()
    const source = '[B](b.md#part) [source](../packages/tool.ts:2) [web](https://example.com)\n'
    expect(rewriteMarkdown(source, {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe(
      '[B](./reference/b.md#part) '
      + '[source](https://github.com/deepseek-ai/deepseek-harness/blob/abc123/packages/tool.ts#L2) '
      + '[web](https://example.com)\n',
    )
  })

  it('selects the published target in the current site locale', () => {
    const { root, pages } = fixture()
    expect(rewriteMarkdown('[B](b.md)\n', {
      locale: 'root',
      sourcePath: 'docs/a.md',
      route: 'a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe('[B](./reference-root/b.md)\n')
  })

  it('uses raw GitHub content for unpublished images when nothing places them', () => {
    const { root, pages } = fixture()
    expect(rewriteMarkdown('![logo](../packages/logo.svg)\n', {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe('![logo](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/abc123/packages/logo.svg)\n')
  })

  it('hands an image to the placer and uses the URL it returns', () => {
    // A raw GitHub URL cannot serve a private repository, so the site build
    // carries images itself; the placer is what puts them there. The stand-in
    // derives its URL the way the real one does, so a placer that stopped
    // returning the basename would fail here rather than pass on a constant.
    const { root, pages } = fixture()
    const placed: string[] = []
    expect(rewriteMarkdown('![logo](../packages/logo.svg)\n', {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
      placeImage: (absPath) => {
        const name = basename(absPath)
        placed.push(name)
        return `./${name}`
      },
    })).toBe('![logo](./logo.svg)\n')
    expect(placed).toEqual(['logo.svg'])
  })

  it('keeps a placed image\u2019s query or fragment', () => {
    // An SVG view fragment and a Vite query both change what the reference
    // means, and the GitHub branch has always carried them.
    const { root, pages } = fixture()
    expect(rewriteMarkdown('![logo](../packages/logo.svg#view)\n', {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
      placeImage: absPath => `./${basename(absPath)}`,
    })).toBe('![logo](./logo.svg#view)\n')
  })

  it('leaves a published page link to the route even when a placer exists', () => {
    const { root, pages } = fixture()
    expect(rewriteMarkdown('[B](b.md)\n', {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
      placeImage: () => { throw new Error('a page link must not be placed as an asset') },
    })).toBe('[B](./reference/b.md)\n')
  })

  it('does not rewrite Markdown-looking text inside code fences', () => {
    const { root, pages } = fixture()
    const source = '```md\n[B](b.md)\n```\n'
    expect(rewriteMarkdown(source, {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe(source)
  })

  it('replaces the destination token without changing repeated titles or escapes', () => {
    const { root, pages } = fixture()
    const source = '[title](b.md "b.md") [escaped](x\\(y\\).md)\n'
    expect(rewriteMarkdown(source, {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe(
      '[title](./reference/b.md "b.md") '
      + '[escaped](https://github.com/deepseek-ai/deepseek-harness/blob/abc123/docs/x(y).md)\n',
    )
  })

  it('routes a pair switcher across locales while ordinary links stay in locale', () => {
    const { root, pages } = fixture()
    writeFileSync(join(root, 'docs/a.zh.md'), '# A\n')
    const paired = pages.filter(page => page.source !== 'docs/a.md')
    paired.push(
      {
        locale: 'root', contentLocale: 'zh-CN', source: 'docs/a.zh.md', sourceAliases: ['docs/a.md'],
        route: 'guide/a.md', label: 'A', sidebar: 'zh-guide', section: 'Test', order: 1,
      },
      {
        locale: 'en', contentLocale: 'en-US', source: 'docs/a.md', sourceAliases: ['docs/a.zh.md'],
        route: 'en/guide/a.md', label: 'A', sidebar: 'en-guide', section: 'Test', order: 1,
      },
    )
    expect(rewriteMarkdown('[English](a.md) [B](b.md)\n', {
      locale: 'root',
      sourcePath: 'docs/a.zh.md',
      route: 'guide/a.md',
      pages: paired,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe('[English](../en/guide/a.md) [B](../reference-root/b.md)\n')
  })

  it('fails loud when a relative target is missing', () => {
    const { root, pages } = fixture()
    expect(() => rewriteMarkdown('[missing](missing.md)\n', {
      locale: 'en',
      sourcePath: 'docs/a.md',
      route: 'en/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toThrow('links to missing path "missing.md"')
  })
})

describe('docsPages locale routes', () => {
  it('redirects both locale roots to their locale-relative quick-start page', () => {
    const homes = docsPages.filter(page => page.sidebar === null)
    expect(homes.map(page => page.route).sort()).toEqual(['en/index.md', 'index.md'])
    for (const page of homes) {
      const source = readFileSync(resolve(repositoryRoot, page.source), 'utf8')
      const projected = projectedPageContent(source, page)
      expect(projected).toContain('layout: false')
      expect(projected).toContain('http-equiv: refresh')
      expect(projected).toContain('content: 0; url=./guide/quickstart')
      expect(projected).not.toContain('# DeepSeek Harness')
    }
  })

  it('publishes every route in both locales and uses every available Chinese counterpart', () => {
    const byRoute = new Map(docsPages.map(page => [page.route, page]))
    for (const page of docsPages.filter(page => page.locale === 'root')) {
      const counterpart = byRoute.get(`en/${page.route}`)
      expect(counterpart, page.route).toBeDefined()
      expect(counterpart?.locale).toBe('en')
      if (page.contentLocale === 'zh-CN') {
        expect(page.source).toMatch(/\.zh\.md$/)
        expect(page.contentLocale).toBe('zh-CN')
        expect(counterpart?.source).toBe(page.source.replace(/\.zh\.md$/, '.md'))
        expect(counterpart?.contentLocale).toBe('en-US')
      } else {
        expect(counterpart?.source).toBe(page.source)
        expect(counterpart?.contentLocale).toBe(page.contentLocale)
        const chineseSource = page.source.replace(/\.md$/, '.zh.md')
        expect(
          existsSync(resolve(repositoryRoot, chineseSource)),
          `${page.route} has a Chinese counterpart but projects English`,
        ).toBe(false)
      }
    }
  })

  it('indexes every subsystem page in both sides of the folder README', () => {
    const pages = globSync(join(repositoryRoot, 'docs/subsystems/*.md'))
      .map(page => basename(page))
      .filter(page => !page.endsWith('.zh.md') && page !== 'README.md')
      .sort()
    expect(pages.length).toBeGreaterThan(0)
    for (const readme of ['README.md', 'README.zh.md']) {
      const rows = readFileSync(join(repositoryRoot, 'docs/subsystems', readme), 'utf8')
      const missing = pages.filter(page => !rows.includes(`| [${page}](${page}) |`))
      expect(missing, `${readme} must carry one table row per subsystem page`).toEqual([])
    }
  })

  it('projects every published subsystem page in Chinese', () => {
    const rootPages = docsPages.filter(page => (
      page.locale === 'root' && page.route.startsWith('reference/subsystems/')
    ))
    const translated = rootPages.filter(page => page.contentLocale === 'zh-CN')
    const fallbacks = rootPages.filter(page => page.contentLocale === 'en-US')

    expect(translated).toHaveLength(43)
    expect(translated.every(page => page.source.endsWith('.zh.md'))).toBe(true)
    expect(fallbacks).toEqual([])
  })

  it('publishes the Cordis core API under matching locale structures', () => {
    const files = ['context.md', 'events.md', 'fiber.md', 'registry.md', 'service.md']
    for (const file of files) {
      const root = docsPages.find(page => page.route === `reference/cordis-api/${file}`)
      const english = docsPages.find(page => page.route === `en/reference/cordis-api/${file}`)
      expect(root?.source).toBe(`docs/cordis-api/${file.replace(/\.md$/, '.zh.md')}`)
      expect(root?.contentLocale).toBe('zh-CN')
      expect(root?.section).toBe('Cordis API')
      expect(english?.source).toBe(`docs/cordis-api/${file}`)
      expect(english?.contentLocale).toBe('en-US')
      expect(english?.section).toBe('Cordis Core API')
    }
  })

  it('keeps Cordis inherited on the English fallback in both locales', () => {
    const pages = docsPages.filter(page => page.route.endsWith('reference/cordis-api/inherited.md'))
    expect(pages).toHaveLength(2)
    expect(pages.every(page => page.source === 'docs/cordis-api/inherited.md')).toBe(true)
    expect(pages.every(page => page.contentLocale === 'en-US')).toBe(true)
  })

  it('includes persistence event headings in both locale outlines', () => {
    const pages = docsPages.filter(page => page.route.endsWith('reference/persistence-catalog.md'))
    expect(pages).toHaveLength(2)
    expect(pages.map(page => page.source).sort()).toEqual([
      'docs/persistence-catalog.md',
      'docs/persistence-catalog.zh.md',
    ])
    expect(pages.map(page => page.outline)).toEqual(['deep', 'deep'])
  })

  it('projects reviewed generated counterparts into root locale routes', () => {
    // module-graph, event-producer-consumer, and graph-atlas are paired but intentionally unpublished.
    const routes = [
      'reference/capability-seams.md',
      'reference/agent-lifecycle.md',
      'reference/tool-execution-pipeline.md',
      'reference/config-catalog.md',
      'reference/tool-catalog.md',
      'reference/persistence-catalog.md',
      'reference/cordis-api/context.md',
      'reference/cordis-api/events.md',
      'reference/cordis-api/fiber.md',
      'reference/cordis-api/registry.md',
      'reference/cordis-api/service.md',
    ]
    const pages = routes.map(route => docsPages.find(page => page.route === route))
    expect(pages.every(page => page?.contentLocale === 'zh-CN')).toBe(true)
    expect(pages.every(page => page?.source.endsWith('.zh.md'))).toBe(true)
  })
})

describe('sidebar ordering', () => {
  it('places every section a sidebar collection owns', () => {
    for (const page of docsPages) {
      if (page.sidebar === null) continue
      expect(() => sectionSpec(page.locale, page.section), page.route).not.toThrow()
    }
  })

  it('refuses a section with no declared placement', () => {
    expect(() => sectionSpec('root', '数据结构'))
      .toThrow('Sidebar section "数据结构" has no placement in the root locale.')
  })

  it('declares placements per locale rather than in one shared list', () => {
    // `SDK` labels a group in both locales, so one shared list would have to
    // rank it against `入门` and against `Guide` at the same position.
    expect(sectionSpec('root', 'SDK').index).toBeGreaterThan(sectionSpec('root', '入门').index)
    expect(sectionSpec('en', 'SDK').index).toBeGreaterThan(sectionSpec('en', 'Guide').index)
    expect(() => sectionSpec('en', '入门')).toThrow()
    expect(() => sectionSpec('root', 'Guide')).toThrow()
  })

  it('lands every navigation item on a page the manifest publishes', () => {
    // The navigation bar named `/guide/` while the manifest published the guide's
    // first page at `guide/quickstart.md`, so the item served a 404.
    const collections = [
      ['root', 'zh-guide'], ['root', 'zh-develop'], ['root', 'zh-reference'],
      ['en', 'en-guide'], ['en', 'en-develop'], ['en', 'en-reference'],
    ] as const
    const published = new Set(docsPages.map(page => routeLink(page.route)))
    for (const [locale, collection] of collections) {
      expect(published, `${locale}/${collection}`).toContain(landingLink(locale, collection))
    }
  })

  it('collapses the subsystem groups and leaves the smaller ones open', () => {
    expect(sectionSpec('root', '执行与工具').collapsed).toBe(true)
    expect(sectionSpec('en', 'Execution and tools').collapsed).toBe(true)
    expect(sectionSpec('root', '概念').collapsed).toBeUndefined()
  })

  it('gives each page its own position within a section', () => {
    // Sidebar entries sort by order alone, so a shared value leaves the two
    // pages ranked by whichever manifest block happens to be concatenated
    // first rather than by an intent the manifest states.
    const taken = new Map<string, string>()
    const collisions: string[] = []
    for (const page of docsPages) {
      const slot = `${page.locale}/${String(page.sidebar)}/${page.section}#${page.order}`
      const holder = taken.get(slot)
      if (holder === undefined) taken.set(slot, page.label)
      else collisions.push(`${slot}: ${holder} / ${page.label}`)
    }
    expect(collisions).toEqual([])
  })
})

describe('addProjectionFrontmatter', () => {
  it('adds frontmatter to an ordinary Markdown page', () => {
    expect(addProjectionFrontmatter('# Guide\n', { source: 'docs/guide.md' })).toBe(
      '---\neditSource: "docs/guide.md"\n---\n\n# Guide\n',
    )
  })

  it('extends existing VitePress frontmatter', () => {
    expect(addProjectionFrontmatter('---\nlayout: home\n---\n', { source: 'docs/index.md' })).toBe(
      '---\neditSource: "docs/index.md"\nlayout: home\n---\n',
    )
  })

  it('adds the page-specific outline depth from the publication manifest', () => {
    expect(addProjectionFrontmatter('# Catalog\n', {
      source: 'docs/catalog.md',
      outline: [2, 4],
    })).toBe(
      '---\neditSource: "docs/catalog.md"\noutline: [2,4]\n---\n\n# Catalog\n',
    )
  })
})

describe('projectedPageContent', () => {
  const page = (sidebar: DocsPage['sidebar']): DocsPage => ({
    locale: 'root',
    contentLocale: 'zh-CN',
    source: 'docs/index.zh.md',
    route: 'index.md',
    label: 'Home',
    sidebar,
    section: 'Home',
    order: 0,
  })

  it('omits the source-only body from locale home pages', () => {
    expect(projectedPageContent(
      '---\nlayout: false\nhead:\n  - - meta\n    - http-equiv: refresh\n      content: 0; url=./guide/quickstart\n---\n\n# Harness\n\n[English](index.md) | 中文\n',
      page(null),
    )).toBe('---\nlayout: false\nhead:\n  - - meta\n    - http-equiv: refresh\n      content: 0; url=./guide/quickstart\n---\n')
  })

  it('keeps the full body for ordinary pages', () => {
    const markdown = '---\ntitle: Guide\n---\n\n# Guide\n'
    expect(projectedPageContent(markdown, page('zh-guide'))).toBe(markdown)
  })

  it('drops the language switcher the navigation bar already offers', () => {
    expect(projectedPageContent('# Guide\n\nEnglish | [中文](./en/guide)\n\nBody.\n', page('zh-guide')))
      .toBe('# Guide\n\nBody.\n')
    expect(projectedPageContent('# 指南\n\n[English](./en/guide) | 中文\n\n正文。\n', page('zh-guide')))
      .toBe('# 指南\n\n正文。\n')
  })

  it('drops the repository badge every page links from its footer', () => {
    const badge = '[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)'
    expect(projectedPageContent(`# Guide\n\nBody.\n\n${badge}\n`, page('zh-guide')))
      .toBe('# Guide\n\nBody.\n')
  })

  it('keeps a switcher-shaped line that is not the page header', () => {
    // A tutorial showing the convention must still render the example.
    const sample = '# Guide\n\nA\n\nB\n\nC\n\nD\n\nE\n\nEnglish | [中文](./x)\n'
    expect(projectedPageContent(sample, page('zh-guide'))).toBe(sample)
  })

  it('rejects a locale home source without frontmatter', () => {
    expect(() => projectedPageContent('# Harness\n', page(null)))
      .toThrow('locale home source "docs/index.zh.md" must start with YAML frontmatter')
  })
})
