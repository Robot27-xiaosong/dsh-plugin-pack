import { describe, expect, it } from 'vitest'
import { classifySource, sourceToInstallSpec, parseGitAddress, stripUrlCredentials, specHasCredentials } from '../src/spec.js'

describe('classifySource', () => {
  it('classifies an exact npm spec', () => {
    const s = classifySource('dsh-foo@1.2.3', 'dsh-foo')
    expect(s.type).toBe('npm')
    if (s.type === 'npm') expect(s.spec).toBe('dsh-foo@1.2.3')
  })

  it('classifies a plain package name as npm', () => {
    const s = classifySource('dsh-foo', 'dsh-foo')
    expect(s.type).toBe('npm')
  })

  it('classifies a scoped npm spec', () => {
    const s = classifySource('@scope/dsh-foo@0.1.0', '@scope/dsh-foo')
    expect(s.type).toBe('npm')
  })

  it('classifies a git+https URL with pinned commit', () => {
    const sha = '0'.repeat(40)
    const s = classifySource(`git+https://github.com/u/dsh-bar.git#${sha}`, 'dsh-bar')
    expect(s.type).toBe('git')
    if (s.type === 'git') {
      expect(s.url).toBe('https://github.com/u/dsh-bar.git')
      expect(s.commit).toBe(sha)
    }
  })

  it('classifies a bare owner/repo shorthand as git', () => {
    const s = classifySource('u/dsh-bar', 'dsh-bar')
    expect(s.type).toBe('git')
    if (s.type === 'git') expect(s.url).toBe('https://github.com/u/dsh-bar.git')
  })

  it('classifies owner/repo#ref with a floating ref (no commit)', () => {
    const s = classifySource('u/dsh-bar#main', 'dsh-bar')
    expect(s.type).toBe('git')
    if (s.type === 'git') expect(s.commit).toBeUndefined()
  })

  it('classifies a tarball URL', () => {
    const s = classifySource('https://example.com/dsh-baz-1.0.0.tgz', 'dsh-baz')
    expect(s.type).toBe('tarball')
  })

  it('classifies a .tar.gz URL as tarball', () => {
    const s = classifySource('https://example.com/dsh-baz-1.0.0.tar.gz', 'dsh-baz')
    expect(s.type).toBe('tarball')
  })

  it('classifies a link: spec as local', () => {
    const s = classifySource('link:../local-plugin', 'dsh-local')
    expect(s.type).toBe('local')
  })

  it('classifies a file: spec as local', () => {
    const s = classifySource('file:./local-plugin', 'dsh-local')
    expect(s.type).toBe('local')
  })

  it('classifies a relative path as local', () => {
    const s = classifySource('./plugins/dsh-local', 'dsh-local')
    expect(s.type).toBe('local')
  })

  it('strips credentials from git URLs', () => {
    const s = classifySource('git+https://user:pass@github.com/u/dsh-bar.git', 'dsh-bar')
    expect(s.type).toBe('git')
    if (s.type === 'git') {
      expect(s.url).not.toContain('user')
      expect(s.url).not.toContain('pass')
    }
  })
})

describe('sourceToInstallSpec', () => {
  it('returns npm spec unchanged', () => {
    expect(sourceToInstallSpec({ type: 'npm', spec: 'dsh-foo@1.2.3' })).toBe('dsh-foo@1.2.3')
  })

  it('returns tarball URL unchanged', () => {
    expect(sourceToInstallSpec({ type: 'tarball', url: 'https://x/y.tgz' })).toBe('https://x/y.tgz')
  })

  it('builds a git spec with commit', () => {
    const sha = 'a'.repeat(40)
    expect(sourceToInstallSpec({ type: 'git', url: 'https://github.com/u/r.git', commit: sha }))
      .toBe(`https://github.com/u/r.git#${sha}`)
  })

  it('throws for unpinned git', () => {
    expect(() => sourceToInstallSpec({ type: 'git', url: 'https://github.com/u/r.git' }))
      .toThrow(/not pinned/)
  })

  it('throws for local', () => {
    expect(() => sourceToInstallSpec({ type: 'local' })).toThrow(/not portable/)
  })
})

describe('parseGitAddress', () => {
  it('parses owner/repo', () => {
    expect(parseGitAddress('u/r')).toEqual({ url: 'https://github.com/u/r.git', ref: undefined })
  })
  it('parses owner/repo#ref', () => {
    expect(parseGitAddress('u/r#v1')).toEqual({ url: 'https://github.com/u/r.git', ref: 'v1' })
  })
  it('returns null for URLs', () => {
    expect(parseGitAddress('https://github.com/u/r')).toBeNull()
  })
})

describe('stripUrlCredentials', () => {
  it('removes userinfo', () => {
    const r = stripUrlCredentials('https://user:pass@host/path')
    expect(r.stripped).toBe(true)
    expect(r.url).not.toContain('user')
  })
  it('leaves clean URLs alone', () => {
    const r = stripUrlCredentials('https://host/path')
    expect(r.stripped).toBe(false)
  })
})

describe('specHasCredentials', () => {
  it('detects credentials in https URL', () => {
    expect(specHasCredentials('https://user:pass@host/x.tgz')).toBe(true)
  })
  it('returns false for clean spec', () => {
    expect(specHasCredentials('dsh-foo@1.0.0')).toBe(false)
  })
})
