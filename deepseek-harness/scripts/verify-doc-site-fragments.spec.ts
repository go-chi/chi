/** Tests for built-site fragment validation. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectSiteFragments } from './verify-doc-site-fragments.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-doc-fragments-'))
  roots.push(root)
  mkdirSync(join(root, 'guide'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<a id="home"></a><a href="/guide/start#ready">start</a>')
  writeFileSync(join(root, 'guide/start.html'), [
    '<h1 id="ready">Ready</h1>',
    '<a name="legacy"></a>',
    '<a href="#ready">same page</a>',
    '<a href="./start.html#legacy">html alias</a>',
    '<a href="../#home">root</a>',
    '<a href="https://example.com/page#missing">external</a>',
  ].join(''))
  return root
}

describe('inspectSiteFragments', () => {
  it('rejects a directory with no built pages', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-doc-fragments-empty-'))
    roots.push(root)

    expect(() => inspectSiteFragments(root)).toThrow('no HTML files found')
  })

  it('resolves clean, encoded, and same-page routes', () => {
    const root = fixture()
    writeFileSync(
      join(root, 'guide/encoded.html'),
      '<h1 id="a b">Encoded</h1><h2 id="%">Literal</h2><a href="./encoded#a%20b">encoded</a><a href="#%">literal</a>',
    )

    expect(inspectSiteFragments(root)).toEqual({ checked: 6, broken: [] })
  })

  it('rejects ambiguous built routes', () => {
    const root = fixture()
    writeFileSync(join(root, 'guide.html'), '<h1 id="flat">Flat</h1>')
    writeFileSync(join(root, 'guide/index.html'), '<h1 id="index">Index</h1>')

    expect(() => inspectSiteFragments(root)).toThrow('share route "/guide"')
  })

  it('rejects malformed fragment hrefs', () => {
    const root = fixture()
    writeFileSync(join(root, 'guide/invalid.html'), '<a href="http://[invalid]#fragment">invalid</a>')

    expect(() => inspectSiteFragments(root)).toThrow(
      'guide/invalid.html has invalid fragment href "http://[invalid]#fragment"',
    )
  })

  it('reports missing ids and missing built routes', () => {
    const root = fixture()
    writeFileSync(join(root, 'guide/broken.html'), [
      '<a href="./start#missing">id</a>',
      '<a href="./absent#missing">route</a>',
    ].join(''))

    expect(inspectSiteFragments(root).broken).toEqual([
      {
        source: 'guide/broken.html',
        href: './start#missing',
        target: 'guide/start.html',
        fragment: 'missing',
      },
      {
        source: 'guide/broken.html',
        href: './absent#missing',
        fragment: 'missing',
      },
    ])
  })
})
