# dsh-plugin-pack · DSH Community Plugin Packs

English | [中文](README.zh.md)

A plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) that adds a **plugin pack** feature to DSH's settings panel:

- scan the community plugins installed in your current profile, select a subset, and export them as a single `.dshpack` file;
- the pack embeds the full install tarball for **non-portable** (local/linked) plugins, so importing works fully offline;
- **portable** plugins (npm / git / remote tarball) keep their original source and are installed through DSH's official installer — they stay portable after import;
- import a pack to batch-install every plugin in it, with live progress showing which plugin is currently installing.

The official DSH runtime base is always retained, never selectable, and never replaced.

> License: MIT. Fully open and auditable. A `.dshpack` is a standard gzip tarball you can inspect and extract yourself. It never contains keys, sessions, memory or caches.

---

## Quick Start

1. Install the plugin (see [Install](#install)).
2. Restart DSH.
3. Open **Settings** → **插件包** (Plugin Packs).
4. **Scan / Export** tab: scan local plugins, check the ones you want, fill in pack info, click **导出插件包**.
5. **导入** tab: pick a `.dshpack` file, review the plugin list, click **导入并安装**.

---

## Features

### Export

- Scans all community plugins in the current profile (official base plugins are excluded).
- Each plugin card shows name, version, description, enabled state, and a **portable / non-portable** badge.
- Expand a card to see the full description and source path.
- Pack metadata: name, version, author, tags, compatible DSH version, description, notes, and a promo link (Bilibili BV number, Douyin URL, or website).
- Exports a single `.dshpack` file.

### Import

- Pick a `.dshpack` file and preview every plugin before installing.
- Streaming install progress: shows the current plugin with a progress bar and spinner.
- Portable plugins install from their original source (npm/git/URL) via DSH's official `installBundle`.
- Non-portable plugins install from the tgz embedded in the pack — no network needed.
- Already-installed plugins can be force-reinstalled.

### Plugin Pack Management

- The **插件包** tab lists all imported packs with type badges: online pack / offline pack / mixed pack.
- Click a pack to expand and see every plugin inside it.
- **Detach from pack**: remove a plugin from the pack record while keeping it installed. Detached plugins are no longer uninstalled when the pack is deleted.
- **Delete pack**: removes the pack record and uninstalls all plugins still associated with it (detached plugins are kept).
- Modified packs (with detached plugins) show a **modified** badge and disable the download button.
- Duplicate pack names are rejected on both export and import.

### Update Detection

- **Check for updates** button in the top-right of the settings panel.
- Compares against the latest GitHub Release.
- **Update now**: downloads the latest tgz, uninstalls the old version, and installs the new one automatically. Restart DSH to apply.

---

## Portable vs Non-Portable

| | Portable | Non-Portable |
|---|---|---|
| **Source** | npm, git, remote tarball URL | local `file:` / `link:` path |
| **In pack** | only source recorded, no tgz | full tgz embedded |
| **Import** | installs from original source via official installer | installs from embedded tgz, offline |
| **After import** | remains portable | stays local |
| **Why** | everyone's DSH path differs; reinstalling from npm/git is reproducible | the original local path won't exist on another machine |

This hybrid strategy keeps packs small (only local plugins are embedded) while ensuring every plugin in the pack can actually be installed on another machine.

---

## Pack Format

### Format 2 — offline `.dshpack` (default)

A gzip tarball:

```text
manifest.json
packages/<name>-<version>.tgz   # only for non-portable plugins
```

`manifest.json`:

```json
{
  "kind": "dsh-plugin-pack",
  "format": 2,
  "name": "my-pack",
  "version": "1.0.0",
  "author": "someone",
  "tags": ["tools", "productivity"],
  "compatibleDshVersion": ">=0.2.0",
  "description": "...",
  "notes": "...",
  "promoUrl": "BV1xx411c7mD",
  "createdAt": "2026-10-17T00:00:00.000Z",
  "generator": { "tool": "dsh-plugin-pack", "version": "0.1.0" },
  "plugins": [
    {
      "name": "dsh-foo",
      "version": "1.2.3",
      "source": { "type": "npm", "spec": "dsh-foo@1.2.3" },
      "portable": true
    },
    {
      "name": "dsh-bar",
      "version": "0.5.0",
      "source": { "type": "local", "spec": "file:/path/to/dsh-bar" },
      "portable": false,
      "packageFile": "dsh-bar-0.5.0.tgz"
    }
  ]
}
```

### Format 1 — `.dshpack.json` (legacy, read-only)

Plain JSON listing plugin names, versions and sources. Does not embed plugins, so installing requires network access. Still supported for reading and CLI use.

---

## Install

Requires DSH 0.2.0+ (with plugin support).

### From a local tarball

```bash
npm pack
# produces dsh-plugin-pack-0.1.0.tgz
dsh plugin --profile desktop add ./dsh-plugin-pack-0.1.0.tgz
```

### From GitHub

```bash
dsh plugin --profile desktop add github:Robot27-xiaosong/dsh-plugin-pack
```

Restart DSH completely after installation (the client bundle is cached).

---

## CLI

A zero-DSH-dependency Node CLI for scripts and headless environments:

```bash
dsh-pack scan     --profile desktop
dsh-pack export   --profile desktop --name my-pack --all --output ./my-pack.dshpack
dsh-pack validate --file ./my-pack.dshpack
dsh-pack import   --profile desktop --file ./my-pack.dshpack --yes
dsh-pack list     --profile desktop
```

DSH home defaults to `$DSH_HOME` or `~/.dsh`; override with `--dsh-home <dir>`.

---

## Storage

Pack records and files are stored at `<profile dir>/plugin-packs/`:

```text
<profile dir>/plugin-packs/
├── records.json          # all pack records (exported + imported)
├── <slug>.dshpack        # offline pack file
└── <slug>.manifest.json  # sidecar manifest for fast reads
```

---

## Development

```bash
npm install
npm run build      # tsc (host) + esbuild (client)
npm test           # vitest
npm pack           # produce installable tgz
```

---

## Out of Scope

No plugin dev tools, no marketplace / accounts / sync, no dependency editor, no model changes, no personal data collection.

## License

[MIT](LICENSE)
