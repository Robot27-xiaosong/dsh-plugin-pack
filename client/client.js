window.__ModuleLoader__.load({ id: "dsh-plugin-pack", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/PackSection.tsx
var import_react = require("react");

// src/client/api.ts
function api(path) {
  const relative = path.replace(/^\/+/, "");
  if (typeof document === "undefined") return `/${relative}`;
  const base = document.baseURI.endsWith("/") ? document.baseURI : document.baseURI + "/";
  return base + relative;
}
async function jsonFetch(path, options) {
  const response = await fetch(api(path), {
    headers: { "content-type": "application/json" },
    ...options
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}
function compareVersions(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}
var packApi = {
  scan: () => jsonFetch("/dsh-plugin-pack/scan"),
  build: (selection, meta) => jsonFetch("/dsh-plugin-pack/build", {
    method: "POST",
    body: JSON.stringify({ selection, meta })
  }),
  export: (selection, meta) => jsonFetch("/dsh-plugin-pack/export", {
    method: "POST",
    body: JSON.stringify({ selection, meta })
  }),
  /** Build an offline .dshpack (contains actual plugin tgz) and return the blob. */
  exportBundle: async (selection, meta) => {
    const response = await fetch(api("/dsh-plugin-pack/export-bundle"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selection, meta })
    });
    if (!response.ok) {
      const text = await response.text();
      let error = `HTTP ${response.status}`;
      try {
        error = JSON.parse(text).error || error;
      } catch {
      }
      throw new Error(error);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const filename = match ? match[1] : "pack.dshpack";
    return { blob, filename };
  },
  /** Upload an offline .dshpack and install the embedded plugins (no network). */
  importBundle: async (data, force = false) => {
    const url = api("/dsh-plugin-pack/import-bundle" + (force ? "?force=true" : ""));
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: data
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  },
  /**
   * Streaming import: uploads the .dshpack and receives SSE progress events.
   * onProgress is called with (index, total, pluginName) for each plugin.
   */
  importBundleStream: async (data, force, onProgress) => {
    const url = api("/dsh-plugin-pack/import-bundle?stream=1" + (force ? "&force=true" : ""));
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: data
    });
    if (!response.ok) {
      const text = await response.text();
      let error = `HTTP ${response.status}`;
      try {
        error = JSON.parse(text).error || error;
      } catch {
      }
      throw new Error(error);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("streaming not supported");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) {
        const line = event.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = JSON.parse(line.slice(6));
        if (payload.type === "progress") {
          onProgress(payload.index, payload.total, payload.name);
        } else if (payload.type === "done") {
          const { type: _type, ...result } = payload;
          return result;
        } else if (payload.type === "error") {
          throw new Error(payload.error);
        }
      }
    }
    throw new Error("stream ended without result");
  },
  previewImport: (content, force = false) => jsonFetch("/dsh-plugin-pack/preview-import", {
    method: "POST",
    body: JSON.stringify({ content, force })
  }),
  doImport: (content, force = false) => jsonFetch("/dsh-plugin-pack/import", {
    method: "POST",
    body: JSON.stringify({ content, confirm: true, force })
  }),
  listPacks: () => jsonFetch("/dsh-plugin-pack/packs"),
  getVersion: () => jsonFetch("/dsh-plugin-pack/version"),
  checkUpdate: async () => {
    const [{ version: current }, gh] = await Promise.all([
      jsonFetch("/dsh-plugin-pack/version"),
      fetch("https://api.github.com/repos/Robot27-xiaosong/dsh-plugin-pack/releases/latest", {
        headers: { "Accept": "application/vnd.github+json" }
      })
    ]);
    if (gh.status === 404) {
      return { latest: current, current, hasUpdate: false, url: "https://github.com/Robot27-xiaosong/dsh-plugin-pack/releases" };
    }
    if (!gh.ok) throw new Error(`\u68C0\u67E5\u66F4\u65B0\u5931\u8D25\uFF08${gh.status}\uFF09`);
    const data = await gh.json();
    const latest = (data.tag_name || "").replace(/^v/, "");
    return {
      latest,
      current,
      hasUpdate: latest !== "" && compareVersions(latest, current) > 0,
      url: data.html_url || "https://github.com/Robot27-xiaosong/dsh-plugin-pack/releases",
      body: data.body
    };
  },
  updatePlugin: () => jsonFetch(
    "/dsh-plugin-pack/update",
    { method: "POST" }
  ),
  getPackPlugins: (id) => jsonFetch(`/dsh-plugin-pack/packs/${id}/plugins`),
  detachPlugin: (id, plugin) => jsonFetch(`/dsh-plugin-pack/packs/${id}/detach`, {
    method: "POST",
    body: JSON.stringify({ plugin })
  }),
  getPack: (id) => jsonFetch(`/dsh-plugin-pack/packs/${id}`),
  deletePack: (id) => jsonFetch(`/dsh-plugin-pack/packs/${id}/delete`, { method: "POST" }),
  renamePack: (id, newName) => jsonFetch(`/dsh-plugin-pack/packs/${id}/rename`, {
    method: "POST",
    body: JSON.stringify({ newName })
  }),
  duplicatePack: (id, newName) => jsonFetch(`/dsh-plugin-pack/packs/${id}/duplicate`, {
    method: "POST",
    body: JSON.stringify({ newName })
  }),
  /** URL for downloading a pack file (triggers browser download). */
  downloadUrl: (id) => api(`/dsh-plugin-pack/packs/${id}/download`),
  /** Fetch pack content as text (for copy-to-clipboard). */
  fetchPackText: async (id) => {
    const response = await fetch(api(`/dsh-plugin-pack/packs/${id}/download`));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }
};

// src/client/PackSection.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var C = {
  bg: "#ffffff",
  surface: "#f6f8fa",
  border: "#d0d7de",
  borderLight: "#eaeef2",
  text: "#1f2328",
  textSecondary: "#656d76",
  textMuted: "#8b949e",
  accent: "#1f2328",
  accentHover: "#000000",
  accentLight: "#f0f1f3",
  danger: "#cf222e",
  dangerLight: "#ffebe9",
  success: "#1a7f37",
  successLight: "#dafbe1",
  warning: "#9a6700",
  warningLight: "#fff8c5",
  radius: "12px",
  radiusSm: "8px"
};
var s = {
  wrap: { padding: "20px 24px 32px", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", Roboto, sans-serif', color: C.text, background: C.bg, minHeight: "100%" },
  tabs: { display: "flex", gap: "0", borderBottom: `1px solid ${C.borderLight}`, marginBottom: "20px" },
  tab: (active) => ({
    padding: "10px 16px",
    border: "none",
    background: "none",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: active ? 600 : 400,
    color: active ? C.text : C.textSecondary,
    borderBottom: active ? `2px solid ${C.accent}` : "2px solid transparent",
    marginBottom: "-1px",
    transition: "color .15s"
  }),
  toolbar: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" },
  btn: (primary = false, danger = false) => ({
    padding: "6px 14px",
    fontSize: "13px",
    fontWeight: 500,
    borderRadius: C.radiusSm,
    cursor: "pointer",
    border: danger ? `1px solid ${C.danger}` : primary ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
    background: danger ? C.bg : primary ? C.accent : C.bg,
    color: danger ? C.danger : primary ? "#fff" : C.text,
    transition: "background .15s, border-color .15s"
  }),
  btnSm: { padding: "4px 10px", fontSize: "12px", borderRadius: "6px", cursor: "pointer", border: `1px solid ${C.border}`, background: C.bg, color: C.textSecondary },
  btnSmDanger: { padding: "4px 10px", fontSize: "12px", borderRadius: "6px", cursor: "pointer", border: "1px solid #ffcecb", background: C.bg, color: C.danger },
  input: { padding: "7px 12px", fontSize: "13px", borderRadius: C.radiusSm, border: `1px solid ${C.border}`, background: C.bg, color: C.text, outline: "none", width: "220px" },
  inputSm: { padding: "5px 10px", fontSize: "12px", borderRadius: "6px", border: `1px solid ${C.border}`, background: C.bg, color: C.text, outline: "none", width: "160px" },
  textarea: { width: "100%", minHeight: "140px", padding: "12px", fontSize: "12px", fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", monospace', borderRadius: C.radius, border: `1px solid ${C.border}`, background: C.bg, color: C.text, resize: "vertical", outline: "none", lineHeight: 1.5 },
  error: { color: C.danger, fontSize: "13px", padding: "10px 14px", background: C.dangerLight, borderRadius: C.radiusSm, marginBottom: "12px" },
  success: { color: C.success, fontSize: "13px", padding: "10px 14px", background: C.successLight, borderRadius: C.radiusSm, marginBottom: "12px" },
  hint: { color: C.textMuted, fontSize: "12px", marginTop: "8px" },
  sectionTitle: { fontSize: "15px", fontWeight: 600, margin: "0 0 14px 0" },
  // Form styles
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", marginBottom: "12px" },
  formField: { display: "flex", flexDirection: "column", gap: "4px" },
  formLabel: { fontSize: "12px", fontWeight: 500, color: C.textSecondary },
  formInput: { padding: "7px 12px", fontSize: "13px", borderRadius: C.radiusSm, border: `1px solid ${C.border}`, background: C.bg, color: C.text, outline: "none", width: "100%", boxSizing: "border-box" },
  formTextarea: { padding: "8px 12px", fontSize: "13px", borderRadius: C.radiusSm, border: `1px solid ${C.border}`, background: C.bg, color: C.text, outline: "none", width: "100%", boxSizing: "border-box", minHeight: "60px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 },
  empty: { color: C.textMuted, fontSize: "13px", padding: "32px", textAlign: "center", background: C.surface, borderRadius: C.radius, border: `1px solid ${C.borderLight}` },
  // Plugin card (DSH-native style)
  cardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "12px", marginBottom: "20px" },
  card: { background: C.bg, border: `1px solid ${C.borderLight}`, borderRadius: C.radius, padding: "16px", transition: "border-color .15s, box-shadow .15s", cursor: "pointer", outline: "none", userSelect: "none", WebkitTapHighlightColor: "transparent" },
  cardSelected: { borderColor: C.accent, boxShadow: `0 0 0 1px ${C.accent}` },
  cardDeselected: { borderColor: C.borderLight, boxShadow: "none" },
  cardHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "6px" },
  cardName: { fontWeight: 600, fontSize: "15px", color: C.text, wordBreak: "break-all" },
  cardVersion: { fontSize: "12px", color: C.textMuted, fontFamily: "ui-monospace, monospace", marginTop: "2px" },
  cardDesc: { fontSize: "13px", color: C.textSecondary, lineHeight: 1.5, margin: "8px 0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: "39px" },
  cardFooter: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${C.borderLight}` },
  badge: (color, bg) => ({ fontSize: "11px", fontWeight: 500, padding: "2px 8px", borderRadius: "10px", background: bg, color }),
  toggle: (on) => ({
    position: "relative",
    width: "36px",
    height: "20px",
    borderRadius: "10px",
    background: on ? C.accent : "#d1d5db",
    cursor: "pointer",
    border: "none",
    transition: "background .15s",
    flexShrink: 0
  }),
  toggleKnob: (on) => ({
    position: "absolute",
    top: "2px",
    left: on ? "18px" : "2px",
    width: "16px",
    height: "16px",
    borderRadius: "50%",
    background: "#fff",
    transition: "left .15s",
    boxShadow: "0 1px 2px rgba(0,0,0,.2)"
  }),
  // Pack record card
  packCard: { background: C.bg, border: `1px solid ${C.borderLight}`, borderRadius: C.radius, padding: "16px", marginBottom: "10px" },
  packHeader: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px", flexWrap: "wrap" },
  packName: { fontWeight: 600, fontSize: "15px" },
  packMeta: { fontSize: "12px", color: C.textMuted },
  packActions: { display: "flex", gap: "6px", marginLeft: "auto", alignItems: "center", flexWrap: "wrap" },
  pre: { background: C.surface, padding: "12px", borderRadius: C.radiusSm, fontSize: "11px", fontFamily: "ui-monospace, monospace", overflow: "auto", maxHeight: "280px", margin: "10px 0 0", lineHeight: 1.5 },
  listItem: { padding: "8px 0", fontSize: "13px", borderBottom: `1px solid ${C.borderLight}` },
  inlineRow: { display: "flex", gap: "6px", alignItems: "center", marginTop: "8px" }
};
function Toggle({ on, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.toggle(on), onClick: (e) => {
    e.stopPropagation();
    onChange();
  }, "aria-pressed": on, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.toggleKnob(on) }) });
}
function PackSection() {
  const [tab, setTab] = (0, import_react.useState)("scan");
  const [updateChecking, setUpdateChecking] = (0, import_react.useState)(false);
  const [updating, setUpdating] = (0, import_react.useState)(false);
  const [updateResult, setUpdateResult] = (0, import_react.useState)(null);
  const [updateError, setUpdateError] = (0, import_react.useState)("");
  const [updateDone, setUpdateDone] = (0, import_react.useState)(null);
  const checkUpdate = async () => {
    setUpdateChecking(true);
    setUpdateError("");
    setUpdateResult(null);
    setUpdateDone(null);
    try {
      const result = await packApi.checkUpdate();
      setUpdateResult(result);
    } catch (e) {
      setUpdateError(e.message);
    } finally {
      setUpdateChecking(false);
    }
  };
  const doUpdate = async () => {
    setUpdating(true);
    setUpdateError("");
    try {
      const result = await packApi.updatePlugin();
      if (result.alreadyLatest) {
        setUpdateDone(`\u5DF2\u662F\u6700\u65B0\u7248 v${result.version || ""}`);
      } else {
        setUpdateDone(`\u5DF2\u66F4\u65B0\u5230 v${result.version}\uFF0C\u8BF7\u91CD\u542F DSH \u751F\u6548`);
      }
      setUpdateResult(null);
    } catch (e) {
      setUpdateError(e.message);
    } finally {
      setUpdating(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.wrap, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: `@keyframes spin { to { transform: rotate(360deg); } }` }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.tabs, justifyContent: "space-between" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.tab(tab === "scan"), onClick: () => setTab("scan"), children: "\u626B\u63CF / \u5BFC\u51FA" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.tab(tab === "packs"), onClick: () => setTab("packs"), children: "\u63D2\u4EF6\u5305" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.tab(tab === "import"), onClick: () => setTab("import"), children: "\u5BFC\u5165" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          style: { ...s.btnSm, marginRight: "4px", alignSelf: "center" },
          onClick: () => void checkUpdate(),
          disabled: updateChecking || updating,
          children: updateChecking ? "\u68C0\u67E5\u4E2D\u2026" : updating ? "\u66F4\u65B0\u4E2D\u2026" : updateResult?.hasUpdate ? `\u6709\u66F4\u65B0 v${updateResult.latest}` : "\u68C0\u67E5\u66F4\u65B0"
        }
      )
    ] }),
    updateError && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...s.error, marginTop: "-8px" }, children: updateError }),
    updateDone && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...s.success, marginTop: "-8px" }, children: updateDone }),
    updateResult && !updateResult.hasUpdate && !updateDone && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.success, marginTop: "-8px" }, children: [
      "\u5DF2\u662F\u6700\u65B0\u7248\u672C v",
      updateResult.current
    ] }),
    updateResult && updateResult.hasUpdate && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.success, marginTop: "-8px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
        "\u53D1\u73B0\u65B0\u7248\u672C ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
          "v",
          updateResult.latest
        ] }),
        "\uFF08\u5F53\u524D v",
        updateResult.current,
        "\uFF09"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: { ...s.btnSm, background: C.accent, color: "#fff", borderColor: C.accent }, onClick: () => void doUpdate(), disabled: updating, children: updating ? "\u66F4\u65B0\u4E2D\u2026" : "\u7ACB\u5373\u66F4\u65B0" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: updateResult.url, target: "_blank", rel: "noopener noreferrer", style: { fontSize: "12px", color: C.textSecondary }, children: "\u67E5\u770B Release" })
    ] }),
    tab === "scan" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScanExportTab, {}),
    tab === "packs" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PacksTab, {}),
    tab === "import" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ImportTab, {})
  ] });
}
function ScanExportTab() {
  const [plugins, setPlugins] = (0, import_react.useState)([]);
  const [selected, setSelected] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const [packName, setPackName] = (0, import_react.useState)("");
  const [packDesc, setPackDesc] = (0, import_react.useState)("");
  const [packNotes, setPackNotes] = (0, import_react.useState)("");
  const [packVersion, setPackVersion] = (0, import_react.useState)("");
  const [packAuthor, setPackAuthor] = (0, import_react.useState)("");
  const [packTags, setPackTags] = (0, import_react.useState)("");
  const [packPromoUrl, setPackPromoUrl] = (0, import_react.useState)("");
  const [packCompatible, setPackCompatible] = (0, import_react.useState)("");
  const [loading, setLoading] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  const [exportedName, setExportedName] = (0, import_react.useState)("");
  const [expandedCard, setExpandedCard] = (0, import_react.useState)(null);
  const refresh = (0, import_react.useCallback)(async () => {
    setLoading(true);
    setError("");
    setExportedName("");
    try {
      const { plugins: plugins2 } = await packApi.scan();
      setPlugins(plugins2);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  (0, import_react.useEffect)(() => {
    void refresh();
  }, [refresh]);
  const toggle = (name2) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(name2) ? next.delete(name2) : next.add(name2);
    return next;
  });
  const doExport = async () => {
    if (!packName.trim()) {
      setError("\u8BF7\u8F93\u5165\u63D2\u4EF6\u5305\u540D\u79F0");
      return;
    }
    if (selected.size === 0) {
      setError("\u8BF7\u81F3\u5C11\u52FE\u9009\u4E00\u4E2A\u63D2\u4EF6");
      return;
    }
    setLoading(true);
    setError("");
    setExportedName("");
    try {
      const meta = { name: packName.trim() };
      if (packDesc.trim()) meta.description = packDesc.trim();
      if (packNotes.trim()) meta.notes = packNotes.trim();
      if (packVersion.trim()) meta.version = packVersion.trim();
      if (packAuthor.trim()) meta.author = packAuthor.trim();
      if (packTags.trim()) meta.tags = packTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
      if (packPromoUrl.trim()) meta.promoUrl = packPromoUrl.trim();
      if (packCompatible.trim()) meta.dsh = { compatible: packCompatible.trim() };
      const { blob, filename } = await packApi.exportBundle(
        { select: Array.from(selected) },
        meta
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
      setExportedName(filename);
      setPackName("");
      setPackDesc("");
      setPackNotes("");
      setPackVersion("");
      setPackAuthor("");
      setPackTags("");
      setPackPromoUrl("");
      setPackCompatible("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.toolbar, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn(), onClick: refresh, disabled: loading, children: loading ? "\u626B\u63CF\u4E2D\u2026" : "\u91CD\u65B0\u626B\u63CF" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn(), onClick: () => setSelected(new Set(plugins.map((p) => p.name))), children: "\u5168\u9009" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn(), onClick: () => setSelected(/* @__PURE__ */ new Set()), children: "\u6E05\u7A7A" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: "13px", color: C.textSecondary }, children: [
        "\u5DF2\u9009 ",
        selected.size,
        " / ",
        plugins.length
      ] })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.error, children: error }),
    plugins.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.cardGrid, children: plugins.map((p) => {
      const isSel = selected.has(p.name);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "div",
        {
          style: { ...s.card, ...isSel ? s.cardSelected : s.cardDeselected },
          onClick: () => toggle(p.name),
          onMouseDown: (e) => e.preventDefault(),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.cardHeader, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { minWidth: 0, flex: 1 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...s.cardName, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: p.name }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.cardVersion, children: p.version ? "v" + p.version : "\u672C\u5730\u5F00\u53D1" })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    style: { ...s.btnSm, border: "none", background: "none", padding: "2px 6px", fontSize: "11px" },
                    onClick: (e) => {
                      e.stopPropagation();
                      setExpandedCard(expandedCard === p.name ? null : p.name);
                    },
                    children: expandedCard === p.name ? "\u6536\u8D77" : "\u5C55\u5F00"
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, { on: isSel, onChange: () => toggle(p.name) })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: expandedCard === p.name ? { ...s.cardDesc, display: "block", WebkitLineClamp: "unset", overflow: "visible", minHeight: "auto" } : s.cardDesc, children: p.description || "\u6682\u65E0\u63CF\u8FF0" }),
            expandedCard === p.name && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: "11px", color: C.textMuted, fontFamily: "ui-monospace, monospace", marginBottom: "8px", wordBreak: "break-all", lineHeight: 1.5 }, children: [
              "\u6765\u6E90\uFF1A",
              p.rawSpec
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.cardFooter, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }, children: [
                p.enabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.badge(C.success, C.successLight), children: "\u542F\u7528\u4E2D" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.badge(C.textMuted, C.accentLight), children: "\u5DF2\u505C\u7528" }),
                p.portable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.badge(C.textSecondary, C.accentLight), children: "\u53EF\u79FB\u690D" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.badge(C.warning, C.warningLight), children: "\u4E0D\u53EF\u79FB\u690D" })
              ] }),
              expandedCard !== p.name && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: "11px", color: C.textMuted, fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, maxWidth: "50%" }, children: p.rawSpec })
            ] })
          ]
        },
        p.name
      );
    }) }) : !loading && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.empty, children: "\u672A\u53D1\u73B0\u793E\u533A\u63D2\u4EF6" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.packCard, background: C.surface }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: s.sectionTitle, children: "\u5BFC\u51FA\u63D2\u4EF6\u5305" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.formGrid, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.formField, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: s.formLabel, children: [
            "\u63D2\u4EF6\u5305\u540D\u79F0 ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: C.danger }, children: "*" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: s.formInput, placeholder: "\u6211\u7684\u63D2\u4EF6\u5305", value: packName, onChange: (e) => setPackName(e.target.value) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.formField, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: s.formLabel, children: "\u7248\u672C" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: s.formInput, placeholder: "1.0.0", value: packVersion, onChange: (e) => setPackVersion(e.target.value) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.formField, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: s.formLabel, children: "\u4F5C\u8005" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: s.formInput, placeholder: "\u4F60\u7684\u540D\u5B57\u6216\u56E2\u961F", value: packAuthor, onChange: (e) => setPackAuthor(e.target.value) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.formField, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: s.formLabel, children: "\u6807\u7B7E\uFF08\u9017\u53F7\u5206\u9694\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: s.formInput, placeholder: "\u6548\u7387, \u5F00\u53D1, \u4E3B\u9898", value: packTags, onChange: (e) => setPackTags(e.target.value) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.formField, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: s.formLabel, children: "\u5BA3\u4F20\u94FE\u63A5\uFF08\u89C6\u9891/\u7F51\u5740\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: s.formInput, placeholder: "BV\u53F7\u3001\u6296\u97F3\u94FE\u63A5\u6216\u81EA\u5236\u7F51\u7AD9", value: packPromoUrl, onChange: (e) => setPackPromoUrl(e.target.value) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.formField, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: s.formLabel, children: "\u517C\u5BB9 DSH \u7248\u672C" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: s.formInput, placeholder: ">=0.2.0", value: packCompatible, onChange: (e) => setPackCompatible(e.target.value) })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.formField, marginBottom: "14px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: s.formLabel, children: "\u63CF\u8FF0" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { style: s.formTextarea, placeholder: "\u8FD9\u4E2A\u63D2\u4EF6\u5305\u5305\u542B\u4E86\u4EC0\u4E48\uFF0C\u9002\u5408\u4EC0\u4E48\u573A\u666F\u2026", value: packDesc, onChange: (e) => setPackDesc(e.target.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.formField, marginBottom: "14px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: s.formLabel, children: "\u6CE8\u610F\u4E8B\u9879" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { style: { ...s.formTextarea, minHeight: "50px" }, placeholder: "\u5DF2\u77E5\u95EE\u9898\u3001\u4F9D\u8D56\u8981\u6C42\u3001\u4F7F\u7528\u63D0\u793A\u7B49\u2026", value: packNotes, onChange: (e) => setPackNotes(e.target.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "12px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn(true), onClick: doExport, disabled: loading, children: loading ? "\u5BFC\u51FA\u4E2D\u2026" : `\u5BFC\u51FA\u63D2\u4EF6\u5305\uFF08\u5DF2\u9009 ${selected.size} \u4E2A\uFF09` }),
        selected.size === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: "12px", color: C.textMuted }, children: "\u8BF7\u5148\u5728\u4E0A\u65B9\u52FE\u9009\u63D2\u4EF6" })
      ] }),
      exportedName && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.success, children: [
        "\u5DF2\u5BFC\u51FA ",
        exportedName,
        "\uFF08\u79BB\u7EBF\u63D2\u4EF6\u5305\uFF0C\u6D4F\u89C8\u5668\u5DF2\u81EA\u52A8\u4E0B\u8F7D\uFF09"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.hint, children: "\u5BFC\u51FA\u7684 .dshpack \u4F1A\u6253\u5305\u4E0D\u53EF\u79FB\u690D\u63D2\u4EF6\u7684\u5B9E\u4F53\u5B89\u88C5\u5305\uFF0C\u53EF\u79FB\u690D\u63D2\u4EF6\u4FDD\u7559\u539F\u6765\u6E90\uFF08\u5BFC\u5165\u65F6\u9700\u8054\u7F51\u4E0B\u8F7D\uFF09\u3002\u4E0D\u542B\u5BC6\u94A5\u3001\u4F1A\u8BDD\u6216\u7F13\u5B58\u3002" })
    ] })
  ] });
}
function PacksTab() {
  const [records, setRecords] = (0, import_react.useState)([]);
  const [loading, setLoading] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  const [renamingId, setRenamingId] = (0, import_react.useState)("");
  const [renameValue, setRenameValue] = (0, import_react.useState)("");
  const [confirmingDeleteId, setConfirmingDeleteId] = (0, import_react.useState)("");
  const [expandedId, setExpandedId] = (0, import_react.useState)(null);
  const [packPlugins, setPackPlugins] = (0, import_react.useState)({});
  const [detaching, setDetaching] = (0, import_react.useState)("");
  const refresh = (0, import_react.useCallback)(async () => {
    setLoading(true);
    setError("");
    try {
      const { records: records2 } = await packApi.listPacks();
      setRecords(records2.filter((r) => r.kind === "imported"));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  (0, import_react.useEffect)(() => {
    void refresh();
  }, [refresh]);
  const toggleExpand = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!packPlugins[id]) {
      try {
        const { plugins } = await packApi.getPackPlugins(id);
        setPackPlugins((prev) => ({ ...prev, [id]: plugins }));
      } catch (e) {
        setError(e.message);
      }
    }
  };
  const detachPlugin = async (packId, pluginName) => {
    setDetaching(pluginName);
    try {
      await packApi.detachPlugin(packId, pluginName);
      setPackPlugins((prev) => ({
        ...prev,
        [packId]: (prev[packId] ?? []).map((p) => p.name === pluginName ? { ...p, detached: true } : p)
      }));
      setRecords((prev) => prev.map((r) => r.id === packId ? { ...r, detachedPlugins: [...r.detachedPlugins ?? [], pluginName] } : r));
    } catch (e) {
      setError(e.message);
    } finally {
      setDetaching("");
    }
  };
  const startRename = (id, currentName) => {
    setRenamingId(id);
    setRenameValue(currentName);
    setConfirmingDeleteId("");
  };
  const submitRename = async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId("");
      return;
    }
    try {
      await packApi.renamePack(renamingId, renameValue.trim());
      setRenamingId("");
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };
  const deletePack = async (id) => {
    try {
      await packApi.deletePack(id);
      setConfirmingDeleteId("");
      setExpandedId(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };
  const isModified = (r) => (r.detachedPlugins?.length ?? 0) > 0;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.toolbar, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn(), onClick: () => void refresh(), disabled: loading, children: loading ? "\u5237\u65B0\u4E2D\u2026" : "\u5237\u65B0" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: "13px", color: C.textSecondary }, children: [
        "\u5171 ",
        records.length,
        " \u4E2A\u63D2\u4EF6\u5305"
      ] })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.error, children: error }),
    records.length > 0 ? records.map((r) => {
      const modified = isModified(r);
      const plugins = packPlugins[r.id];
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.packCard, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.packHeader, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { ...s.packName, cursor: "pointer" }, onClick: () => void toggleExpand(r.id), children: [
            r.portableCount !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", marginRight: "8px", verticalAlign: "middle" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "span",
                {
                  title: r.portableCount === r.pluginCount ? "\u5168\u90E8\u63D2\u4EF6\u4ECE\u8FDC\u7A0B\u6E90\u5B89\u88C5\uFF0C\u5305\u4F53\u8F7B\u91CF" : r.portableCount === 0 ? "\u5168\u90E8\u63D2\u4EF6\u5DF2\u6253\u5305\u8FDB\u5305\uFF0C\u79BB\u7EBF\u53EF\u88C5" : `${r.portableCount} \u4E2A\u5728\u7EBF\u6E90 + ${r.pluginCount - r.portableCount} \u4E2A\u79BB\u7EBF\u5305`,
                  style: {
                    display: "inline-block",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    marginRight: "5px",
                    background: r.portableCount === r.pluginCount ? C.success : r.portableCount === 0 ? C.warning : C.textMuted
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: "12px", color: C.textSecondary, fontWeight: 500 }, children: r.portableCount === r.pluginCount ? "\u5728\u7EBF\u5305" : r.portableCount === 0 ? "\u79BB\u7EBF\u5305" : "\u6DF7\u5408\u5305" })
            ] }),
            r.name,
            r.version && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: "11px", color: C.textMuted, fontFamily: "ui-monospace, monospace", marginLeft: "6px" }, children: [
              "v",
              r.version
            ] }),
            r.author && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: "11px", color: C.textMuted, marginLeft: "8px" }, children: [
              "by ",
              r.author
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: "11px", color: C.textMuted, marginLeft: "6px" }, children: expandedId === r.id ? "\u25BC" : "\u25B6" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.badge(C.textSecondary, C.accentLight), children: [
            r.pluginCount,
            " \u63D2\u4EF6"
          ] }),
          modified && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.badge(C.warning, C.warningLight), children: "\u5DF2\u4FEE\u6539" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.packMeta, children: new Date(r.createdAt).toLocaleString() }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.packActions, children: [
            modified ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...s.btnSm, color: C.textMuted, cursor: "not-allowed", opacity: 0.5 }, title: "\u5305\u5DF2\u4FEE\u6539\uFF0C\u65E0\u6CD5\u4E0B\u8F7D\u539F\u59CB\u6587\u4EF6", children: "\u4E0B\u8F7D" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: packApi.downloadUrl(r.id), download: true, style: s.btnSm, children: "\u4E0B\u8F7D" }),
            renamingId === r.id ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { display: "flex", gap: "4px", alignItems: "center" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: s.inputSm, value: renameValue, onChange: (e) => setRenameValue(e.target.value), onKeyDown: (e) => {
                if (e.key === "Enter") void submitRename();
              }, autoFocus: true }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: { ...s.btnSm, background: C.accent, color: "#fff", borderColor: C.accent }, onClick: () => void submitRename(), children: "\u786E\u5B9A" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btnSm, onClick: () => setRenamingId(""), children: "\u53D6\u6D88" })
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btnSm, onClick: () => startRename(r.id, r.name), children: "\u91CD\u547D\u540D" }),
            confirmingDeleteId === r.id ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: { ...s.btnSmDanger, background: C.danger, color: "#fff" }, onClick: () => void deletePack(r.id), children: "\u786E\u8BA4\u5220\u9664" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btnSmDanger, onClick: () => {
              setConfirmingDeleteId(r.id);
              setRenamingId("");
            }, children: "\u5220\u9664" }),
            confirmingDeleteId === r.id && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btnSm, onClick: () => setConfirmingDeleteId(""), children: "\u53D6\u6D88" })
          ] })
        ] }),
        confirmingDeleteId === r.id && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
          marginTop: "10px",
          padding: "12px 14px",
          background: C.dangerLight,
          borderRadius: C.radiusSm,
          border: `1px solid #ffcecb`
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: "13px", fontWeight: 600, color: C.danger, marginBottom: "4px" }, children: "\u786E\u8BA4\u5220\u9664\u6B64\u63D2\u4EF6\u5305\uFF1F" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: "12px", color: C.textSecondary, lineHeight: 1.6 }, children: [
            "\u5C06\u5378\u8F7D\u5305\u5185 ",
            plugins ? plugins.filter((p) => !p.detached).length : r.pluginCount,
            " \u4E2A\u4ECD\u5173\u8054\u7684\u63D2\u4EF6",
            modified && `\uFF08${r.detachedPlugins?.length ?? 0} \u4E2A\u5DF2\u79FB\u9664\u7684\u63D2\u4EF6\u4E0D\u53D7\u5F71\u54CD\uFF09`,
            "\uFF0C\u5E76\u5220\u9664\u63D2\u4EF6\u5305\u8BB0\u5F55\u3002"
          ] })
        ] }),
        expandedId === r.id && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${C.borderLight}` }, children: [
          (r.description || r.notes || r.version || r.author || r.tags?.length || r.promoUrl || r.compatible) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: "14px", padding: "10px 12px", background: C.surface, borderRadius: C.radiusSm }, children: [
            r.description && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: "12px", color: C.textSecondary, lineHeight: 1.6, marginBottom: "6px" }, children: r.description }),
            r.notes && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: "12px", color: C.warning, lineHeight: 1.6, marginBottom: "6px", padding: "6px 8px", background: C.warningLight, borderRadius: "4px" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "\u6CE8\u610F\u4E8B\u9879\uFF1A" }),
              r.notes
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: "11px", color: C.textMuted }, children: [
              r.version && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
                "\u7248\u672C ",
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontFamily: "ui-monospace, monospace", color: C.textSecondary }, children: r.version })
              ] }),
              r.author && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
                "\u4F5C\u8005 ",
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: C.textSecondary }, children: r.author })
              ] }),
              r.compatible && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
                "\u517C\u5BB9 ",
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontFamily: "ui-monospace, monospace", color: C.textSecondary }, children: r.compatible })
              ] }),
              r.promoUrl && (() => {
                const isBv = /^bv/i.test(r.promoUrl.trim());
                const href = isBv ? `https://www.bilibili.com/video/${r.promoUrl.trim()}` : /^https?:\/\//i.test(r.promoUrl.trim()) ? r.promoUrl.trim() : `https://${r.promoUrl.trim()}`;
                const label = isBv ? `B\u7AD9 ${r.promoUrl.trim()}` : r.promoUrl.trim();
                return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
                  "\u5BA3\u4F20 ",
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href, target: "_blank", rel: "noopener noreferrer", style: { color: C.accent, textDecoration: "none" }, children: label.length > 40 ? label.slice(0, 40) + "\u2026" : label })
                ] });
              })()
            ] }),
            r.tags && r.tags.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "6px" }, children: r.tags.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...s.badge(C.textSecondary, C.accentLight), fontSize: "10px" }, children: t }, t)) })
          ] }),
          !plugins ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: "12px", color: C.textMuted }, children: "\u52A0\u8F7D\u4E2D\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: "12px", color: C.textSecondary, marginBottom: "8px" }, children: [
              "\u5305\u5185\u63D2\u4EF6\uFF08",
              plugins.filter((p) => !p.detached).length,
              " \u4E2A\u5173\u8054\u4E2D\uFF0C",
              plugins.filter((p) => p.detached).length,
              " \u4E2A\u5DF2\u79FB\u9664\uFF09"
            ] }),
            plugins.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px", padding: "6px 0", borderBottom: `1px solid ${C.borderLight}` }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: "13px", fontWeight: 500 }, children: p.name }),
              p.version && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: "11px", color: C.textMuted, fontFamily: "ui-monospace, monospace" }, children: [
                "v",
                p.version
              ] }),
              p.detached ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...s.badge(C.textMuted, C.accentLight), marginLeft: "auto" }, children: "\u5DF2\u79FB\u9664" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  style: { ...s.btnSm, marginLeft: "auto", color: C.warning, borderColor: C.warning },
                  onClick: () => void detachPlugin(r.id, p.name),
                  disabled: detaching === p.name,
                  children: detaching === p.name ? "\u79FB\u9664\u4E2D\u2026" : "\u4ECE\u5305\u4E2D\u79FB\u9664"
                }
              )
            ] }, p.name)),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: "11px", color: C.textMuted, marginTop: "8px", lineHeight: 1.5 }, children: "\u300C\u4ECE\u5305\u4E2D\u79FB\u9664\u300D\u540E\u63D2\u4EF6\u4ECD\u4FDD\u6301\u5B89\u88C5\uFF0C\u4F46\u4E0D\u518D\u5C5E\u4E8E\u6B64\u63D2\u4EF6\u5305\uFF1B\u5220\u9664\u63D2\u4EF6\u5305\u65F6\u4E0D\u4F1A\u5378\u8F7D\u5DF2\u79FB\u9664\u7684\u63D2\u4EF6\u3002" })
          ] })
        ] })
      ] }, r.id);
    }) : !loading && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.empty, children: "\u8FD8\u6CA1\u6709\u5BFC\u5165\u8FC7\u63D2\u4EF6\u5305\uFF0C\u53BB\u300C\u5BFC\u5165\u300D\u6807\u7B7E\u9875\u9009\u62E9 .dshpack \u6587\u4EF6\u5B89\u88C5\u5427\u3002" })
  ] });
}
function ImportTab() {
  const [binary, setBinary] = (0, import_react.useState)(null);
  const [loading, setLoading] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  const [importResult, setImportResult] = (0, import_react.useState)(null);
  const [force, setForce] = (0, import_react.useState)(false);
  const [fileName, setFileName] = (0, import_react.useState)("");
  const [progress, setProgress] = (0, import_react.useState)(null);
  const fileInputRef = (0, import_react.useRef)(null);
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportResult(null);
    setError("");
    setProgress(null);
    const reader = new FileReader();
    reader.onload = () => {
      setBinary(reader.result);
    };
    reader.onerror = () => setError("\u8BFB\u53D6\u6587\u4EF6\u5931\u8D25");
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const doImport = async () => {
    if (!binary) {
      setError("\u8BF7\u5148\u9009\u62E9 .dshpack \u63D2\u4EF6\u5305\u6587\u4EF6");
      return;
    }
    setLoading(true);
    setError("");
    setImportResult(null);
    setProgress(null);
    try {
      const res = await packApi.importBundleStream(binary, force, (index, total, name2) => {
        setProgress({ index, total, name: name2 });
      });
      setImportResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };
  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: s.sectionTitle, children: "\u5BFC\u5165\u63D2\u4EF6\u5305" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: "13px", color: C.textSecondary, marginBottom: "10px" }, children: [
      "\u9009\u62E9 ",
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { style: { background: C.surface, padding: "1px 5px", borderRadius: "4px", fontSize: "12px" }, children: ".dshpack" }),
      " \u63D2\u4EF6\u5305\u6587\u4EF6\uFF0C\u4E0D\u53EF\u79FB\u690D\u63D2\u4EF6\u4ECE\u5305\u5185\u79BB\u7EBF\u5B89\u88C5\uFF0C\u53EF\u79FB\u690D\u63D2\u4EF6\u4ECE\u539F\u6765\u6E90\u8054\u7F51\u4E0B\u8F7D\uFF0C\u901A\u8FC7 DSH \u5B98\u65B9 pluginManager \u6279\u91CF\u5B89\u88C5\u3002"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginBottom: "10px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          ref: fileInputRef,
          type: "file",
          accept: ".dshpack,.tar.gz,.tgz",
          onChange: handleFileSelect,
          style: { display: "none" }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn(), onClick: () => fileInputRef.current?.click(), children: "\u9009\u62E9\u6587\u4EF6" }),
      fileName && binary && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: "13px", color: C.textSecondary }, children: [
        "\u5DF2\u9009\uFF1A",
        fileName,
        "\uFF08",
        formatSize(binary.byteLength),
        "\uFF09"
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.toolbar, marginTop: "12px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: C.textSecondary, cursor: "pointer" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: force, onChange: (e) => setForce(e.target.checked) }),
        "\u5F3A\u5236\u91CD\u88C5\uFF08\u5DF2\u5B89\u88C5\u7684\u4E5F\u91CD\u65B0\u88C5\uFF09"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn(true), onClick: () => void doImport(), disabled: loading || !binary, children: loading ? "\u5BFC\u5165\u4E2D\u2026" : "\u5BFC\u5165\u5E76\u5B89\u88C5" })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...s.error, marginTop: "12px" }, children: error }),
    loading && progress && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.packCard, marginTop: "16px", background: C.surface }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: {
          display: "inline-block",
          width: "14px",
          height: "14px",
          borderRadius: "50%",
          border: `2px solid ${C.border}`,
          borderTopColor: C.accent,
          animation: "spin 0.8s linear infinite"
        } }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { style: { fontSize: "13px" }, children: [
          "\u6B63\u5728\u5B89\u88C5\uFF1A",
          progress.name
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: "12px", color: C.textMuted, marginLeft: "auto" }, children: [
          progress.index + 1,
          " / ",
          progress.total
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { width: "100%", height: "6px", background: C.borderLight, borderRadius: "3px", overflow: "hidden" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: {
        width: `${(progress.index + 1) / progress.total * 100}%`,
        height: "100%",
        background: C.accent,
        borderRadius: "3px",
        transition: "width 0.3s ease"
      } }) })
    ] }),
    loading && !progress && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.packCard, marginTop: "16px", background: C.surface, display: "flex", alignItems: "center", gap: "10px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: {
        display: "inline-block",
        width: "14px",
        height: "14px",
        borderRadius: "50%",
        border: `2px solid ${C.border}`,
        borderTopColor: C.accent,
        animation: "spin 0.8s linear infinite"
      } }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: "13px", color: C.textSecondary }, children: "\u6B63\u5728\u51C6\u5907\u5B89\u88C5\u2026" })
    ] }),
    importResult && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.packCard, marginTop: "16px", background: C.surface }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h4", { style: { fontSize: "14px", margin: "0 0 10px 0" }, children: [
        "\u5BFC\u5165\u7ED3\u679C\uFF1A",
        importResult.pack.name
      ] }),
      importResult.restartRequired && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: C.warning, background: C.warningLight, padding: "8px 12px", borderRadius: C.radiusSm, marginBottom: "10px", fontSize: "13px", fontWeight: 500 }, children: "\u90E8\u5206\u63D2\u4EF6\u9700\u8981\u91CD\u542F DSH \u540E\u624D\u80FD\u751F\u6548\u3002" }),
      importResult.installed.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: "10px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: "13px", fontWeight: 600, marginBottom: "6px" }, children: [
          "\u5B89\u88C5\u7ED3\u679C\uFF08",
          importResult.installed.filter((i) => i.success).length,
          " \u6210\u529F / ",
          importResult.installed.filter((i) => !i.success).length,
          " \u5931\u8D25\uFF09\uFF1A"
        ] }),
        importResult.installed.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.listItem, display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: {
            fontSize: "11px",
            fontWeight: 600,
            padding: "1px 8px",
            borderRadius: "10px",
            flexShrink: 0,
            background: item.success ? C.successLight : C.dangerLight,
            color: item.success ? C.success : C.danger
          }, children: item.success ? item.application === "restart-required" ? "\u9700\u91CD\u542F" : "\u6210\u529F" : "\u5931\u8D25" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: item.name }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: "11px", color: C.textMuted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: item.spec.startsWith("file:") ? "\u79BB\u7EBF\u5305\u5B89\u88C5" : `\u5B98\u65B9\u5B89\u88C5\uFF1A${item.spec}` }),
          item.error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: "12px", color: C.danger, flexBasis: "100%", paddingLeft: "32px", lineHeight: 1.5 }, children: item.error })
        ] }, item.name))
      ] }),
      importResult.skipped.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: "10px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: "13px", fontWeight: 600, color: C.textSecondary, marginBottom: "6px" }, children: [
          "\u8DF3\u8FC7\uFF08",
          importResult.skipped.length,
          "\uFF09\uFF1A"
        ] }),
        importResult.skipped.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.listItem, color: C.textSecondary, fontSize: "12px" }, children: [
          item.name,
          " \u2014 ",
          item.reason
        ] }, item.name))
      ] }),
      importResult.warnings.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: "13px", fontWeight: 600, color: C.warning, marginBottom: "6px" }, children: "\u8B66\u544A\uFF1A" }),
        importResult.warnings.map((w, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...s.listItem, color: C.warning, fontSize: "12px" }, children: w }, i))
      ] }),
      importResult.installed.length === 0 && importResult.skipped.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.hint, children: "\u6CA1\u6709\u5B89\u88C5\u4EFB\u4F55\u63D2\u4EF6\uFF08\u5168\u90E8\u8DF3\u8FC7\uFF09\u3002\u53EF\u52FE\u9009\u300C\u5F3A\u5236\u91CD\u88C5\u300D\u540E\u91CD\u8BD5\u3002" })
    ] })
  ] });
}

// src/client/index.ts
var name = "dsh-plugin-pack";
var inject = ["slots"];
function apply(ctx) {
  try {
    ctx.slots.inject(
      "settings.section",
      () => ctx.slots.register(
        {
          name: "settings.section",
          id: "plugin-packs",
          order: 50,
          label: () => "\u63D2\u4EF6\u5305"
        },
        // DSH expects the component itself, not a render thunk.
        PackSection
      )
    );
  } catch (e) {
    console.error("[dsh-plugin-pack] apply failed:", e);
  }
}

return module.exports;
}});
