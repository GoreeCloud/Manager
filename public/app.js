const $ = selector => document.querySelector(selector);
const dashboard = $("#dashboard");
const refresh = $("#refresh");
const notice = $("#notice");
let snapshot = null;
let controller = null;
let dataRevision = 0;
const names = {
  github: ["GitHub", "Code & repositories", "⌘", "https://github.com/GoreeCloud"],
  cloudflare: ["Cloudflare Pages", "Deployments & projects", "▤", "https://dash.cloudflare.com/"],
  openai: ["OpenAI API", "Usage & organization costs", "✧", "https://platform.openai.com/usage"],
};
const pages = {
  overview: ["Overview", "Infrastructure, in focus", "One clear view across your code, deployments, and API activity."],
  github: ["GitHub", "Your code universe", "Repository activity and health, straight from GitHub."],
  deployments: ["Deployments", "Every deployment, visible", "Your Cloudflare Pages projects and their last reported deployment."],
  usage: ["API usage", "Understand your usage", "Organization-level OpenAI token consumption and cost."],
  connections: ["Connections", "One connected ecosystem", "Live provider state, permissions, and setup guidance."],
};
function element(tag, cls, value) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}
function append(parent, ...children) { children.flat().forEach(child => child && parent.append(child)); return parent; }
function fmt(value) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : new Intl.NumberFormat("en-US").format(value); }
function money(value) { return value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
function when(value) { if (!value || !Number.isFinite(Date.parse(value))) return "Not available"; return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function source(name) { return snapshot?.sources?.find(item => item.name === name) || { name, status: "unconfigured", data: null, message: "Not available" }; }
function sectionHeading(label) { return append(element("h2", "section-label"), element("span", "", label), element("span", "line")); }
function makePanel(title, subtitle) {
  const panel = element("section", "panel");
  const head = element("div", "panel-head");
  const left = element("div");
  append(left, element("h3", "panel-title", title), element("p", "panel-caption", subtitle));
  append(head, left);
  panel.append(head);
  return panel;
}
function stateLabel(status) {
  return status === "connected" ? "Connected" : status === "error" ? "Unavailable" : "Not configured";
}
function sourceRow(key) {
  const s = source(key), meta = names[key];
  const row = element("div", "source-row");
  const main = element("div", "source-main");
  append(main, element("strong", "", meta[0]), element("small", "", s.message || meta[1]));
  append(row, element("div", "source-icon", meta[2]), main,
    element("span", "status-tag " + s.status, stateLabel(s.status)));
  return row;
}
function empty(title, body) {
  return append(element("div", "empty-state"),
    element("span", "empty-glyph", "◇"), element("strong", "", title), element("span", "", body));
}
function stat(label, value, foot, glyph) {
  const box = element("article", "stat-card");
  const top = element("div", "stat-top");
  append(top, element("span", "stat-name", label), element("span", "stat-icon", glyph));
  return append(box, top, element("p", "stat-value", value), element("p", "stat-foot", foot));
}
function stats() {
  const gh = source("github").data, cf = source("cloudflare").data, ai = source("openai").data;
  const grid = element("section", "stats-grid");
  grid.setAttribute("aria-label", "Key metrics");
  return append(grid,
    stat("Public repositories", gh ? fmt(gh.repositoryCount) + (gh.truncated ? "+" : "") : "—", gh ? "Active public repositories" : "GitHub data unavailable", "⌘"),
    stat("Pages projects", cf ? fmt(cf.projectCount) + (cf.truncated ? "+" : "") : "—", cf ? "Visible Cloudflare projects" : "Connect Cloudflare Pages", "▤"),
    stat("7-day API cost", ai ? money(ai.costUsd) : "—", ai ? (ai.partial ? "Partial data available" : "OpenAI organization costs") : "Connect OpenAI API", "◈"),
    stat("API requests", ai ? fmt(ai.requests) : "—", ai ? "Completions · last 7 days" : "OpenAI usage unavailable", "↗"));
}
function chart() {
  const pane = makePanel("API spend", "Reported daily organization costs · USD");
  const ai = source("openai").data;
  const items = ai?.dailyCosts;
  if (!items || !items.length) { pane.append(empty("Cost chart unavailable", "Connect OpenAI with an authorized organization admin key to view actual spending.")); return pane; }
  const chart = element("div", "chart");
  chart.setAttribute("role", "img");
  chart.setAttribute("aria-label", "Seven-day OpenAI costs: " + items.map(item => item.date + " " + money(item.usd)).join(", "));
  const max = Math.max(...items.map(item => item.usd), 0.01);
  items.forEach(item => {
    const col = element("div", "chart-col");
    const wrap = element("div", "chart-bar-wrap");
    const bar = element("div", "chart-bar");
    bar.style.height = Math.max(4, Math.round(item.usd / max * 142)) + "px";
    wrap.append(bar);
    const date = new Date(item.date + "T12:00:00Z");
    append(col, element("span", "chart-value", money(item.usd)), wrap,
      element("span", "chart-day", new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date)));
    chart.append(col);
  });
  pane.append(chart);
  return pane;
}
function providersPanel() {
  const panel = makePanel("Connected sources", "A live view of your integrations");
  ["github", "cloudflare", "openai"].forEach(key => panel.append(sourceRow(key)));
  return panel;
}
function linkNode(text, href, prefix) {
  if (typeof href !== "string" || !href.startsWith(prefix)) return element("span", "", text);
  const node = element("a", "", text);
  node.href = href; node.target = "_blank"; node.rel = "noopener noreferrer";
  return node;
}
function table(headers, rows, emptyTitle, emptyDescription) {
  if (!rows?.length) return empty(emptyTitle, emptyDescription);
  const container = element("div", "table-wrap");
  const table = element("table", "data-table");
  const head = element("thead"), hr = element("tr");
  headers.forEach(h => hr.append(element("th", "", h)));
  head.append(hr);
  const body = element("tbody");
  rows.forEach(cells => { const tr = element("tr"); cells.forEach(cell => { const td = element("td"); if (cell instanceof Node) td.append(cell); else td.textContent = String(cell ?? "—"); tr.append(td); }); body.append(tr); });
  append(table, head, body); container.append(table);
  return container;
}
function repositoryPanel(limit) {
  const panel = makePanel("Repositories", "Most recently updated public repositories");
  const gh = source("github").data;
  const repos = (gh?.repositories || []).slice(0, limit || 12);
  panel.append(table(["Repository", "Language", "Open work", "Last push"], repos.map(repo => [
    append(element("div", "name-cell"), linkNode(repo.name, repo.url, "https://github.com/")),
    repo.language || "—",
    fmt(repo.openWorkItems),
    when(repo.updatedAt),
  ]), "No repositories available", "GitHub is not connected or returned no public repositories."));
  if (gh?.truncated) panel.append(element("p", "panel-caption", "Showing a capped subset; totals may be incomplete."));
  return panel;
}
function deploymentPanel() {
  const panel = makePanel("Pages projects", "Latest deployment reported by Cloudflare");
  const cf = source("cloudflare").data;
  panel.append(table(["Project", "Branch", "Deployment", "Updated"], (cf?.projects || []).map(p => [
    append(element("div", "name-cell"), linkNode(p.name, p.url, "https://")),
    p.branch || "—",
    append(element("span", "", ""), element("span", "small-indicator " + p.status), element("span", "", p.status)),
    when(p.deployedAt)
  ]), "Deployment details unavailable", "Configure a Cloudflare Pages:Read token and account ID to load real projects."));
  if (cf?.truncated) panel.append(element("p", "panel-caption", "Only the first 100 projects were queried; reported totals are incomplete."));
  return panel;
}
function usagePanel() {
  const ai = source("openai").data;
  const panel = makePanel("Token activity", "Completion usage · past 7 days, UTC");
  const grid = element("div", "stats-grid");
  append(grid,
    stat("Input tokens", ai ? fmt(ai.inputTokens) : "—", "All available completion models", "↙"),
    stat("Output tokens", ai ? fmt(ai.outputTokens) : "—", "All available completion models", "↗"),
    stat("Requests", ai ? fmt(ai.requests) : "—", "Completions only", "◌"),
    stat("Organization cost", ai ? money(ai.costUsd) : "—", "All reported cost line items", "$"));
  panel.append(grid);
  if (ai?.partial) panel.append(element("p", "detail-heading", "The provider returned partial data. Missing metrics are marked with a dash, never reported as zero."));
  if (!ai) panel.append(empty("OpenAI reporting not connected", "This feature needs an organization admin key stored as an encrypted Cloudflare Pages secret."));
  return panel;
}
function connections() {
  const group = element("div", "connection-grid");
  for (const key of ["github", "cloudflare", "openai"]) {
    const data = source(key), meta = names[key], card = element("article", "connection-card");
    const description = key === "github" ? "Public repository metadata is available without a token. An optional limited read-only GitHub token improves API limits." :
      key === "cloudflare" ? "Requires a Cloudflare API token limited to Pages:Read and the matching account ID." :
      "Cost and completion usage endpoints require an OpenAI organization admin key. Protect it carefully; the key has broader privileges than this dashboard uses.";
    append(card, sourceRow(key), element("p", "", description), linkNode("Open provider dashboard", meta[3], "https://"));
    group.append(card);
  }
  return group;
}
function render() {
  const view = pages[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
  $("#breadcrumb-label").textContent = pages[view][0];
  $("#page-title").replaceChildren(document.createTextNode(pages[view][1]), element("span", "title-period", "."));
  $("#page-description").textContent = pages[view][2];
  document.querySelectorAll(".nav-link").forEach(link => {
    const active = link.dataset.view === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
  if (!snapshot) { dashboard.replaceChildren(empty("Waiting for live data", "Use Refresh data to retry the provider connections.")); return; }
  const content = document.createDocumentFragment();
  if (view === "overview") {
    append(content, sectionHeading("At a glance"), stats());
    const split = element("div", "split-grid"); append(split, chart(), providersPanel());
    append(content, sectionHeading("Your workspace"), split, repositoryPanel(6));
  } else if (view === "github") {
    append(content, sectionHeading("GitHub repositories"), repositoryPanel(12));
  } else if (view === "deployments") {
    append(content, sectionHeading("Cloudflare Pages"), deploymentPanel());
  } else if (view === "usage") {
    append(content, sectionHeading("OpenAI API"), usagePanel(), chart());
  } else {
    append(content, sectionHeading("Provider connections"), element("p", "detail-heading", "All data access is read-only in Manager. Provider permissions are configured privately on Cloudflare Pages, not here."), connections());
  }
  dashboard.replaceChildren(content);
}
async function load() {
  if (controller) controller.abort();
  controller = new AbortController();
  const revision = ++dataRevision;
  refresh.disabled = true;
  notice.hidden = true;
  $("#overall-status").textContent = "Refreshing provider data";
  try {
    const res = await fetch("/api/overview", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
    if (res.status === 401) throw new Error("A valid Cloudflare Access session is required. Configure or sign in to the protected application.");
    if (!res.ok) throw new Error("Unable to load dashboard data (HTTP " + res.status + ").");
    const result = await res.json();
    if (revision !== dataRevision) return;
    if (!Array.isArray(result.sources) || result.readOnly !== true) throw new Error("Unexpected dashboard response.");
    snapshot = result;
    const connected = result.sources.filter(s => s.status === "connected").length;
    $("#overall-status").textContent = connected + " of " + result.sources.length + " sources connected";
    $("#sync-time").textContent = "Last checked " + when(result.generatedAt);
    if (connected < result.sources.length) {
      notice.hidden = false;
      notice.textContent = "Some providers are unavailable or not configured. Metrics shown as dashes have not been verified; check Connections for details.";
    }
    render();
  } catch (error) {
    if (revision !== dataRevision || error.name === "AbortError") return;
    snapshot = null;
    $("#overall-status").textContent = "Dashboard unavailable";
    $("#sync-time").textContent = "No verified data";
    notice.hidden = false;
    notice.textContent = error.message;
    render();
  } finally {
    if (revision === dataRevision) refresh.disabled = false;
  }
}

// An Access check on returning to the tab prevents stale private dashboard DOM
// from remaining visible after a separate logout or expired identity session.
// This endpoint makes no provider requests; network uncertainty fails closed.
async function validateVisibleSession() {
  if (!snapshot || document.visibilityState === "hidden") return;
  const revision = dataRevision;
  try {
    const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
    if (revision !== dataRevision) return; // A newer overview refresh owns the state.
    // A login page, static fallback or malformed 200 is NOT an authenticated API response.
    if (response.ok) {
      const session = await response.json();
      if (revision !== dataRevision) return;
      if (session?.authenticated === true) return;
    }
  } catch {
    // A failed session check cannot establish continued authorization.
  }
  if (revision !== dataRevision) return;
  dataRevision++;
  if (controller) controller.abort();
  snapshot = null;
  refresh.disabled = false;
  $("#overall-status").textContent = "Private session unavailable";
  $("#sync-time").textContent = "Private data cleared";
  notice.hidden = false;
  notice.textContent = "Your private session could not be verified. Sign in again and refresh to load current data.";
  render();
}
function theme(mode) {
  document.documentElement.dataset.theme = mode;
  $("#theme-toggle").textContent = mode === "dark" ? "☼" : "☾";
  $("#theme-toggle").setAttribute("aria-label", mode === "dark" ? "Switch to light appearance" : "Switch to dark appearance");
  try { localStorage.setItem("gc-manager-theme", mode); } catch { /* storage is optional */ }
}
let initialMode = "dark";
try { initialMode = localStorage.getItem("gc-manager-theme") === "light" ? "light" : "dark"; } catch {}
theme(initialMode);
$("#theme-toggle").addEventListener("click", () => theme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
refresh.addEventListener("click", load);
window.addEventListener("hashchange", render);
window.addEventListener("focus", () => { void validateVisibleSession(); });
window.addEventListener("pageshow", () => { void validateVisibleSession(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void validateVisibleSession();
});
load();
