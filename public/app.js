const $ = selector => document.querySelector(selector);
const dashboard = $("#dashboard");
const refresh = $("#refresh");
const notice = $("#notice");
let snapshot = null;
let controller = null;
const names = {
  github: ["GitHub", "Code & repositories", "⌘", "https://github.com/GoreeCloud"],
  cloudflare: ["Cloudflare Pages", "Deployments & projects", "▤", "https://dash.cloudflare.com/"],
  openrouter: ["OpenRouter", "Usage snapshot", "◉", "https://openrouter.ai/"],
  openai: ["OpenAI API", "Usage & organization costs", "✧", "https://platform.openai.com/usage"],
};
const pages = {
  overview: ["Overview", "Infrastructure, in focus", "One clear view across your code, deployments, and API activity."],
  github: ["GitHub", "Your code universe", "Repository activity and health, straight from GitHub."],
  deployments: ["Deployments", "Every deployment, visible", "Your Cloudflare Pages projects and their last reported deployment."],
  usage: ["API usage", "Understand your usage", "Model provider spend, usage and account-level reporting."],
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
  const gh = source("github").data, cf = source("cloudflare").data, ai = source("openai").data, router = source("openrouter").data;
  const grid = element("section", "stats-grid");
  grid.setAttribute("aria-label", "Key metrics");
  grid.classList.add("overview-stats");
  return append(grid,
    stat("Public repositories", gh ? fmt(gh.repositoryCount) + (gh.truncated ? "+" : "") : "—", gh ? "Active public repositories" : "GitHub data unavailable", "⌘"),
    stat("Pages projects", cf ? fmt(cf.projectCount) + (cf.truncated ? "+" : "") : "—", cf ? "Visible Cloudflare projects" : "Connect Cloudflare Pages", "▤"),
    stat("7-day API cost", ai ? money(ai.costUsd) : "—", ai ? (ai.partial ? "Partial data available" : "OpenAI organization costs") : "Connect OpenAI API", "◈"),
    stat("API requests", ai ? fmt(ai.requests) : "—", ai ? "Completions · last 7 days" : "OpenAI usage unavailable", "↗"),
    stat("OpenRouter week", router ? money(router.key?.weeklyUsd) : "—", "Current API key · weekly spend", "◉"),
    stat("OpenRouter remaining", router ? money(router.key?.limitRemainingUsd) : "—", "Current key spending limit", "◎"));
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
  Object.keys(names).forEach(key => panel.append(sourceRow(key)));
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
function workflowPanel() {
  const gh = source("github").data;
  const panel = makePanel("Recent workflow runs", "Latest public GitHub Actions activity · " + (gh?.workflowRepository || "Manager"));
  if (!gh || gh.workflowRuns === null || gh.workflowRuns === undefined) {
    panel.append(empty("Workflow activity unavailable", "GitHub Actions could not be retrieved. Repository data is still shown independently."));
    return panel;
  }
  panel.append(table(["Workflow", "Branch", "Result", "Updated"], gh.workflowRuns.map(run => {
    const result = run.conclusion || run.status || "unknown";
    const state = result === "success" ? "connected" :
      ["failure", "cancelled", "timed_out", "startup_failure"].includes(result) ? "error" : "unconfigured";
    return [
      append(element("div", "name-cell"), linkNode(run.name, run.url, "https://github.com/")),
      run.branch || "—",
      element("span", "status-tag " + state, result.replaceAll("_", " ")),
      when(run.updatedAt),
    ];
  }), "No workflow runs", "GitHub reported no recent workflow runs for this repository."));
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
  if (cf?.truncated) panel.append(element("p", "panel-caption", "Only the first 500 projects were queried; reported totals may be incomplete."));
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
function openrouterPanel() {
  const router = source("openrouter").data;
  const keyPanel = makePanel("Key-level usage", "OpenRouter · authenticated key only · USD");
  if (router?.key) {
    const key = router.key;
    const grid = element("div", "stats-grid");
    append(grid,
      stat("Today", money(key.dailyUsd), "Current UTC day", "◷"),
      stat("This week", money(key.weeklyUsd), "Weekly key spend", "◉"),
      stat("This month", money(key.monthlyUsd), "Monthly key spend", "◈"),
      stat("Lifetime", money(key.usageUsd), "This key only", "⌁"));
    keyPanel.append(grid);
    keyPanel.append(element("p", "detail-heading", key.limitUsd === null
      ? "No spending limit was reported for this key."
      : "Key limit: " + money(key.limitUsd) + " · Remaining: " +
        money(key.limitRemainingUsd) + (key.limitReset ? " · Resets " + key.limitReset : "")));
  } else {
    keyPanel.append(empty("Key usage not available",
      "A dedicated, spend-limited OpenRouter key is required for this report."));
  }
  const accountPanel = makePanel("Account reporting", "Optional management-level reports · USD");
  if (router?.credits || router?.activity) {
    const grid = element("div", "stats-grid");
    append(grid,
      stat("Purchased", money(router.credits?.purchasedUsd), "Account credits", "◈"),
      stat("Lifetime used", money(router.credits?.lifetimeUsageUsd), "Account usage", "$"),
      stat("Available", money(router.credits?.availableUsd), "Account balance", "◉"),
      stat("30-day spend", money(router.activity?.spendUsd), "30 completed UTC days", "◷"));
    accountPanel.append(grid);
    if (router.activity) {
      const activity = router.activity;
      accountPanel.append(element("p", "detail-heading",
        "30 completed UTC days · " + fmt(activity.requests) + " requests · " +
        fmt(activity.inputTokens) + " input tokens · " + fmt(activity.outputTokens) + " output tokens"));
      accountPanel.append(table(["Model", "Requests", "Spend"], (activity.topModels || []).map(row => [
        element("span", "name-cell", row.model), fmt(row.requests), money(row.spendUsd),
      ]), "No model details", "No model activity was returned for the period."));
    }
  } else {
    accountPanel.append(empty("Account reporting not connected",
      "A separately authorized OpenRouter management key is required for credits and activity."));
  }
  if (router?.partial) accountPanel.append(element("p", "detail-heading",
    "Some reports failed. Unavailable values are not displayed as zero."));
  return [keyPanel, accountPanel];
}
function connections() {
  const group = element("div", "connection-grid");
  for (const key of Object.keys(names)) {
    const data = source(key), meta = names[key], card = element("article", "connection-card");
    const description = key === "github" ? "Public repository metadata is available without a token. An optional limited read-only GitHub token improves API limits." :
      key === "cloudflare" ? "Requires a Cloudflare API token limited to Pages:Read and the matching account ID." :
      key === "openrouter" ? "A capped dedicated key exposes per-key spending. Optional management credentials provide account credit and 30-day activity, but have broader privileges." :
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
    append(content, sectionHeading("GitHub repositories"), repositoryPanel(12), sectionHeading("GitHub Actions"), workflowPanel());
  } else if (view === "deployments") {
    append(content, sectionHeading("Cloudflare Pages"), deploymentPanel());
  } else if (view === "usage") {
    append(content, sectionHeading("OpenAI API"), usagePanel(), chart(), sectionHeading("OpenRouter"), openrouterPanel());
  } else {
    append(content, sectionHeading("Provider connections"), element("p", "detail-heading", "All data access is read-only in Manager. Provider permissions are configured privately on Cloudflare Pages, not here."), connections());
  }
  dashboard.replaceChildren(content);
}
async function load() {
  if (controller) controller.abort();
  const active = new AbortController();
  controller = active;
  refresh.disabled = true;
  notice.hidden = true;
  $("#overall-status").textContent = "Refreshing provider data";
  try {
    const res = await fetch("/api/overview", { credentials: "same-origin", cache: "no-store", signal: active.signal });
    if (res.status === 401) throw new Error("A valid Cloudflare Access session is required. Sign in to the protected application.");
    if (res.status === 403) throw new Error("Access denied. Confirm that your Cloudflare Access identity is permitted by the private Manager owner allowlist.");
    if (!res.ok) throw new Error("Unable to load dashboard data (HTTP " + res.status + ").");
    const result = await res.json();
    if (active.signal.aborted) return;
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
    if (active.signal.aborted || error.name === "AbortError") return;
    snapshot = null;
    $("#overall-status").textContent = "Dashboard unavailable";
    $("#sync-time").textContent = "No verified data";
    notice.hidden = false;
    notice.textContent = error.message;
    render();
  } finally {
    if (controller === active) {
      controller = null;
      refresh.disabled = false;
    }
  }
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
load();
