/* Market Pulse – dashboard logic (no build step, plain JS) */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const PAGE = 40;

  const state = { news: [], summary: null, market: [], history: [], shown: PAGE, charts: {} };

  /* ---------------- theme ---------------- */
  const root = document.documentElement;
  const savedTheme = (() => { try { return localStorage.getItem("theme"); } catch { return null; } })();
  root.dataset.theme = savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  $("#theme").addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch {}
    drawCharts();
  });
  const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();

  /* ---------------- tabs ---------------- */
  $$(".tab").forEach((b) => b.addEventListener("click", () => {
    $$(".tab").forEach((t) => { t.classList.toggle("active", t === b); t.setAttribute("aria-selected", t === b); });
    $$(".tab-panel").forEach((p) => (p.hidden = p.id !== `tab-${b.dataset.tab}`));
    location.hash = b.dataset.tab;
  }));
  if (location.hash === "#analyzer") $('.tab[data-tab="analyzer"]').click();

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtNum = (n, d = 2) => n == null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  const signed = (n, d = 2) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(d);
  const LABEL = {
    positive: { icon: "▲", text: "Positive" },
    neutral: { icon: "●", text: "Neutral" },
    negative: { icon: "▼", text: "Negative" },
  };
  const moodLabel = (s) => s >= 0.15 ? ["positive", "Bullish"] : s <= -0.15 ? ["negative", "Bearish"] : s > 0.05 ? ["positive", "Mildly bullish"] : s < -0.05 ? ["negative", "Mildly bearish"] : ["neutral", "Neutral"];
  const timeAgo = (iso) => {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  };
  const splitBar = (p, n, ng) => {
    const t = p + n + ng || 1;
    return `<div style="width:${(p / t) * 100}%;background:var(--pos-fill)" title="Positive ${p}"></div>` +
      `<div style="width:${(n / t) * 100}%;background:var(--neu-fill)" title="Neutral ${n}"></div>` +
      `<div style="width:${(ng / t) * 100}%;background:var(--neg-fill)" title="Negative ${ng}"></div>`;
  };

  async function getJSON(path) {
    const r = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }

  /* ---------------- load ---------------- */
  async function load() {
    $("#updated").textContent = "Loading…";
    try {
      const [news, summary, market, history] = await Promise.all([
        getJSON("data/news.json"),
        getJSON("data/summary.json"),
        getJSON("data/market.json").catch(() => ({ quotes: [] })),
        getJSON("data/history.json").catch(() => []),
      ]);
      state.news = news.articles || [];
      state.summary = summary;
      state.market = market.quotes || [];
      state.history = history || [];
      $("#sample-banner").hidden = !news.sample;
      const up = new Date(news.updated);
      $("#updated").textContent = `Updated ${timeAgo(news.updated)} · ${up.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`;
      renderAll();
    } catch (e) {
      console.error(e);
      $("#updated").textContent = "Could not load data";
      $("#news").innerHTML = `<li class="empty">No data yet. Run the GitHub Action once to generate <code>docs/data/*.json</code>.</li>`;
    }
  }
  $("#reload").addEventListener("click", load);

  function renderAll() {
    renderMarket();
    renderMood();
    renderWatchlist();
    fillFilters();
    renderNews();
    drawCharts();
  }

  /* ---------------- market strip ---------------- */
  function spark(values, cls) {
    if (!values || values.length < 2) return "";
    const w = 140, h = 30, min = Math.min(...values), max = Math.max(...values), rng = max - min || 1;
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / rng) * (h - 4)}`).join(" ");
    const color = cls === "up" ? "var(--pos-fill)" : cls === "down" ? "var(--neg-fill)" : "var(--muted)";
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" points="${pts}"/></svg>`;
  }
  function renderMarket() {
    const el = $("#market");
    if (!state.market.length) { el.innerHTML = `<div class="quote muted">Market data unavailable</div>`; return; }
    el.innerHTML = state.market.map((q) => {
      const cls = q.change_pct > 0 ? "up" : q.change_pct < 0 ? "down" : "flat";
      const arrow = cls === "up" ? "▲" : cls === "down" ? "▼" : "■";
      const d = q.price > 1000 ? 2 : q.price > 10 ? 2 : 4;
      return `<div class="quote" title="${esc(q.symbol)}">
        <span class="q-name">${esc(q.name)}</span>
        <span class="q-price">${fmtNum(q.price, d)}</span>
        <span class="q-chg ${cls}">${arrow} ${signed(q.change, d)} (${signed(q.change_pct)}%)</span>
        ${spark(q.spark, cls)}
      </div>`;
    }).join("");
  }

  /* ---------------- mood ---------------- */
  function renderMood() {
    const s = state.summary.last_24h?.count ? state.summary.last_24h : state.summary.overall;
    const [cls, txt] = moodLabel(s.avg_score);
    $("#mood-score").textContent = signed(s.avg_score, 2);
    const pill = $("#mood-label");
    pill.className = `pill ${cls}`;
    pill.textContent = `${LABEL[cls].icon} ${txt}`;
    $("#gauge-needle").style.left = `${((s.avg_score + 1) / 2) * 100}%`;
    $("#mood-split").innerHTML = splitBar(s.positive, s.neutral, s.negative);
    $("#mood-split").setAttribute("aria-label", `${s.positive} positive, ${s.neutral} neutral, ${s.negative} negative`);
    const pct = (x) => s.count ? Math.round((x / s.count) * 100) : 0;
    $("#mood-legend").innerHTML =
      `<li><i style="background:var(--pos-fill)"></i>▲ Positive ${s.positive} (${pct(s.positive)}%)</li>` +
      `<li><i style="background:var(--neu-fill)"></i>● Neutral ${s.neutral} (${pct(s.neutral)}%)</li>` +
      `<li><i style="background:var(--neg-fill)"></i>▼ Negative ${s.negative} (${pct(s.negative)}%)</li>` +
      `<li class="muted">${s.count} headlines</li>`;
  }

  /* ---------------- watchlist ---------------- */
  function renderWatchlist() {
    const rows = state.summary.by_ticker || [];
    const sel = $("#f-ticker").value;
    $("#watchlist tbody").innerHTML = rows.map((r) => {
      const cls = r.avg_score > 0.05 ? "up" : r.avg_score < -0.05 ? "down" : "flat";
      return `<tr data-sym="${esc(r.symbol)}" class="${r.symbol === sel ? "selected" : ""}">
        <td><strong>${esc(r.name)}</strong><span class="sym">${esc(r.symbol)}</span></td>
        <td class="num">${r.count}</td>
        <td><div class="mini-split">${r.count ? splitBar(r.positive, r.neutral, r.negative) : ""}</div></td>
        <td class="num ${cls}">${r.count ? signed(r.avg_score) : "—"}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="4" class="empty">Add stocks to <code>watchlist</code> in config.json</td></tr>`;
    $$("#watchlist tbody tr[data-sym]").forEach((tr) => tr.addEventListener("click", () => {
      const f = $("#f-ticker");
      f.value = f.value === tr.dataset.sym ? "" : tr.dataset.sym;
      state.shown = PAGE;
      renderWatchlist();
      renderNews();
      $("#news").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }

  /* ---------------- filters + news ---------------- */
  function fillFilters() {
    const src = $("#f-source"), cur = src.value;
    const counts = {};
    state.news.forEach((a) => (counts[a.source] = (counts[a.source] || 0) + 1));
    src.innerHTML = `<option value="">All sources</option>` +
      Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([s, n]) => `<option value="${esc(s)}">${esc(s)} (${n})</option>`).join("");
    src.value = cur;

    const tk = $("#f-ticker"), curT = tk.value;
    tk.innerHTML = `<option value="">All stocks</option>` +
      (state.summary.by_ticker || []).map((t) => `<option value="${esc(t.symbol)}">${esc(t.name)}</option>`).join("");
    tk.value = curT;
  }

  function filtered() {
    const q = $("#f-search").value.trim().toLowerCase();
    const sent = $("#f-sentiment").value, src = $("#f-source").value, tk = $("#f-ticker").value;
    const since = Date.now() - Number($("#f-time").value) * 3600e3;
    const sort = $("#f-sort").value;
    let list = state.news.filter((a) =>
      (!sent || a.sentiment === sent) &&
      (!src || a.source === src) &&
      (!tk || (a.tickers || []).includes(tk)) &&
      new Date(a.published) >= since &&
      (!q || a.title.toLowerCase().includes(q) || (a.summary || "").toLowerCase().includes(q)));
    if (sort === "pos") list.sort((a, b) => b.score - a.score);
    else if (sort === "neg") list.sort((a, b) => a.score - b.score);
    else list.sort((a, b) => new Date(b.published) - new Date(a.published));
    return list;
  }

  function renderNews() {
    const list = filtered();
    const n = list.length;
    const avg = n ? list.reduce((s, a) => s + a.score, 0) / n : 0;
    $("#news-count").textContent = n ? `· ${n} articles · avg score ${signed(avg)}` : "";
    const nameOf = Object.fromEntries((state.summary.by_ticker || []).map((t) => [t.symbol, t.name]));
    $("#news").innerHTML = list.slice(0, state.shown).map((a) => {
      const L = LABEL[a.sentiment] || LABEL.neutral;
      const p = a.probs || {};
      const barColor = a.sentiment === "positive" ? "var(--pos-fill)" : a.sentiment === "negative" ? "var(--neg-fill)" : "var(--neu-fill)";
      const tags = (a.tickers || []).map((t) => `<span class="tag">${esc(nameOf[t] || t)}</span>`).join("");
      return `<li class="news-item">
        <div class="bar" style="background:${barColor}"></div>
        <div>
          <a class="title" href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a>
          ${a.summary ? `<p class="summary">${esc(a.summary)}</p>` : ""}
          <div class="meta"><span>${esc(a.source)}</span><span title="${esc(new Date(a.published).toLocaleString())}">${timeAgo(a.published)}</span>${tags}</div>
        </div>
        <div class="right">
          <span class="pill ${a.sentiment}">${L.icon} ${L.text}</span>
          <div class="probs" title="Positive ${Math.round((p.positive || 0) * 100)}% · Neutral ${Math.round((p.neutral || 0) * 100)}% · Negative ${Math.round((p.negative || 0) * 100)}%">
            ${splitBar(p.positive || 0, p.neutral || 0, p.negative || 0)}
          </div>
          <span class="score">score ${signed(a.score)}</span>
        </div>
      </li>`;
    }).join("") || `<li class="empty">No articles match these filters.</li>`;
    $("#more").hidden = n <= state.shown;
  }

  ["#f-search", "#f-sentiment", "#f-source", "#f-ticker", "#f-time", "#f-sort"].forEach((id) =>
    $(id).addEventListener("input", () => { state.shown = PAGE; if (id === "#f-ticker") renderWatchlist(); renderNews(); }));
  $("#more").addEventListener("click", () => { state.shown += PAGE; renderNews(); });

  /* ---------------- charts (Chart.js) ---------------- */
  function drawCharts() {
    if (!state.summary) return;
    if (!window.Chart) {
      drawCharts.tries = (drawCharts.tries || 0) + 1;
      if (drawCharts.tries < 60) setTimeout(drawCharts, 250);
      else $$(".chart-box").forEach((b) => (b.innerHTML = `<p class="empty">Chart library failed to load.</p>`));
      return;
    }
    Object.values(state.charts).forEach((c) => c.destroy());
    const text2 = css("--text-2"), muted = css("--muted"), grid = css("--grid"), surface = css("--surface");
    const pos = css("--pos-fill"), neg = css("--neg-fill"), accent = css("--accent");
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.color = muted;
    const tooltip = {
      backgroundColor: surface, titleColor: css("--text"), bodyColor: text2,
      borderColor: css("--border"), borderWidth: 1, padding: 10, displayColors: false,
    };

    // Trend
    const h = state.history.slice(-200);
    state.charts.trend = new Chart($("#trend-chart"), {
      type: "line",
      data: {
        labels: h.map((p) => p.t),
        datasets: [{
          label: "Avg sentiment", data: h.map((p) => p.avg_score),
          borderColor: accent, borderWidth: 2, pointRadius: h.length < 30 ? 3 : 0, pointHoverRadius: 5,
          tension: 0.3, fill: { target: { value: 0 }, above: pos + "22", below: neg + "22" },
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltip,
            callbacks: {
              title: (it) => new Date(h[it[0].dataIndex].t).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
              label: (it) => {
                const p = h[it.dataIndex];
                return [`Score ${signed(p.avg_score, 3)}`, `▲ ${p.positive}  ● ${p.neutral}  ▼ ${p.negative}  (${p.count} headlines)`];
              },
            },
          },
        },
        scales: {
          x: {
            type: "category", grid: { display: false }, border: { color: grid },
            ticks: {
              maxTicksLimit: 7, autoSkip: true,
              callback(v) { const d = new Date(h[v].t); return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); },
            },
          },
          y: { suggestedMin: -0.5, suggestedMax: 0.5, grid: { color: grid }, border: { display: false }, ticks: { callback: (v) => signed(v, 1) } },
        },
      },
    });

    // By source
    const src = (state.summary.by_source || []).slice().sort((a, b) => b.avg_score - a.avg_score);
    state.charts.source = new Chart($("#source-chart"), {
      type: "bar",
      data: {
        labels: src.map((s) => s.source),
        datasets: [{
          data: src.map((s) => s.avg_score),
          backgroundColor: src.map((s) => (s.avg_score >= 0 ? pos : neg)),
          borderRadius: 4, borderSkipped: false, barThickness: 14,
        }],
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltip,
            callbacks: {
              label: (it) => {
                const s = src[it.dataIndex];
                return [`Score ${signed(s.avg_score, 3)} (${s.count} articles)`, `▲ ${s.positive}  ● ${s.neutral}  ▼ ${s.negative}`];
              },
            },
          },
        },
        scales: {
          x: { grid: { color: grid }, border: { display: false }, ticks: { callback: (v) => signed(v, 1) } },
          y: { grid: { display: false }, border: { color: grid }, ticks: { color: text2 } },
        },
      },
    });
  }

  // If the analyzer module (loaded from a CDN) is blocked, say so instead of doing nothing.
  $("#az-run").addEventListener("click", () => {
    if (!window.__azReady) $("#az-status").textContent = "Analyzer could not load — check your connection or ad-blocker and reload.";
  });

  load();
  setInterval(load, 5 * 60 * 1000); // re-check for new data every 5 min
})();
