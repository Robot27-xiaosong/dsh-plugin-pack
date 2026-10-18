# dsh-plugin-pack · DSH 社区插件包

[English](README.md) | 中文

一个 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 插件，在 DSH 设置面板里增加**插件包**功能：

- 扫描当前 profile 已安装的社区插件，勾选后导出为单个 `.dshpack` 文件；
- **不可移植**（本地/链接）插件的完整安装包 tgz 会打进包里，导入时完全离线安装；
- **可移植**插件（npm / git / 远程 tgz）保留原始来源，通过 DSH 官方安装器安装——导入后仍然可移植；
- 导入插件包即可批量安装全部插件，实时显示当前正在安装哪个插件。

DSH 官方运行基础（base / 官方插件）默认保留、不可勾选、不被替换。

> 许可证：MIT。完全开源、可审计。`.dshpack` 是标准 gzip tarball，可以直接解压查看。绝不包含密钥、会话、记忆或缓存。

---

## 快速开始

1. 安装插件（见 [安装](#安装)）。
2. 完全重启 DSH。
3. 打开 **设置** → **插件包**。
4. **扫描 / 导出** 标签页：扫描本地插件，勾选需要的，填写插件包信息，点击**导出插件包**。
5. **导入** 标签页：选择 `.dshpack` 文件，预览插件列表，点击**导入并安装**。

---

## 功能

### 导出

- 扫描当前 profile 全部社区插件（自动排除官方 base 插件）。
- 每个插件卡片显示名称、版本、描述、启用状态，以及**可移植 / 不可移植**徽章。
- 点击卡片可展开查看完整描述和来源路径。
- 插件包元数据：名称、版本、作者、标签、兼容 DSH 版本、描述、注意事项、宣传链接（B 站 BV 号、抖音链接或网站）。
- 导出为单个 `.dshpack` 文件。

### 导入

- 选择 `.dshpack` 文件后先预览全部插件，确认后再安装。
- 流式安装进度：显示当前正在安装的插件 + 进度条 + 旋转动画。
- 可移植插件通过 DSH 官方 `installBundle` 从原始来源（npm/git/URL）安装。
- 不可移植插件从包内嵌入的 tgz 安装——无需联网。
- 已安装的插件可选择强制重装。

### 插件包管理

- **插件包** 标签页列出所有已导入的包，带类型徽章：在线包 / 离线包 / 混合包。
- 点击插件包可展开查看包内全部插件。
- **从包中移除**：将插件从包记录中移除但保留安装。被移除的插件在删除包时不会被卸载。
- **删除插件包**：删除包记录并卸载仍关联的全部插件（已移除的插件保留）。
- 被修改过的包（有移除操作）显示**已修改**徽章并禁用下载按钮。
- 导出和导入都拒绝同名插件包。

### 检查更新

- 设置面板右上角的**检查更新**按钮。
- 对比 GitHub Releases 最新版本。
- **立即更新**：自动下载最新 tgz、卸载旧版、安装新版。重启 DSH 生效。

---

## 可移植 vs 不可移植

| | 可移植 | 不可移植 |
|---|---|---|
| **来源** | npm、git、远程 tgz URL | 本地 `file:` / `link:` 路径 |
| **包里内容** | 只记录来源，不打包 tgz | 完整 tgz 嵌入包内 |
| **导入方式** | 从原始来源通过官方安装器安装 | 从嵌入的 tgz 安装，离线 |
| **导入后** | 仍然可移植 | 保持本地 |
| **原因** | 每个人的 DSH 安装路径不同，从 npm/git 重装可复现 | 原始本地路径在别的机器上不存在 |

这种混合策略让包体积小（只嵌入本地插件），同时保证包里的每个插件都能在别的机器上真正装上。

---

## 插件包格式

### 格式 2 — 离线 `.dshpack`（默认）

gzip tarball：

```text
manifest.json
packages/<name>-<version>.tgz   # 仅不可移植插件
```

`manifest.json`：

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

### 格式 1 — `.dshpack.json`（旧版，仅可读）

纯 JSON，只记录插件名称、版本和来源。不嵌入插件，安装需要联网。仍支持读取和 CLI 使用。

---

## 安装

需要 DSH 0.2.0+（支持插件）。

### 从本地 tgz 安装

```bash
npm pack
# 生成 dsh-plugin-pack-0.1.0.tgz
dsh plugin --profile desktop add ./dsh-plugin-pack-0.1.0.tgz
```

### 从 GitHub 安装

```bash
dsh plugin --profile desktop add github:Robot27-xiaosong/dsh-plugin-pack
```

安装后完全重启 DSH（client bundle 有缓存）。

---

## 命令行

零 DSH 运行时依赖的 Node CLI，适合脚本和无界面环境：

```bash
dsh-pack scan     --profile desktop
dsh-pack export   --profile desktop --name my-pack --all --output ./my-pack.dshpack
dsh-pack validate --file ./my-pack.dshpack
dsh-pack import   --profile desktop --file ./my-pack.dshpack --yes
dsh-pack list     --profile desktop
```

DSH home 默认取 `$DSH_HOME` 或 `~/.dsh`，可用 `--dsh-home <dir>` 指定。

---

## 存储位置

插件包记录和文件存放在 `<profile 目录>/plugin-packs/`：

```text
<profile 目录>/plugin-packs/
├── records.json          # 全部包记录（导出的 + 导入的）
├── <slug>.dshpack        # 离线包文件
└── <slug>.manifest.json  # 侧车 manifest，快速读取
```

---

## 本地开发

```bash
npm install
npm run build      # tsc（host）+ esbuild（client）
npm test           # vitest
npm pack           # 生成可安装 tgz
```

---

## 明确不做的事

不做插件开发工具、插件市场、账号或在线同步；不做复杂依赖编辑器；不改动模型、不替换官方运行基础；不收集任何个人数据。

## 许可证

[MIT](LICENSE)
