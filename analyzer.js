/* In-browser FinBERT sentiment analyzer (Transformers.js + ONNX FinBERT weights).
   The model (~110 MB quantized) downloads once from Hugging Face and is then
   cached by the browser, so later visits load in a second or two. */
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

window.__azReady = true;
const MODEL = "Xenova/finbert"; // ONNX export of ProsusAI/finbert
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LABEL = {
  positive: { icon: "▲", text: "Positive", color: "var(--pos-fill)" },
  neutral: { icon: "●", text: "Neutral", color: "var(--neu-fill)" },
  negative: { icon: "▼", text: "Negative", color: "var(--neg-fill)" },
};

let classifierPromise = null;

function loadModel() {
  if (classifierPromise) return classifierPromise;
  const bar = $("#az-progress"), fill = bar.firstElementChild, status = $("#az-status");
  const files = {};
  bar.hidden = false;
  status.textContent = "Downloading FinBERT model (first time only)…";
  classifierPromise = pipeline("text-classification", MODEL, {
    dtype: "q8",
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        files[p.file] = { loaded: p.loaded, total: p.total };
        const all = Object.values(files);
        const pct = (all.reduce((s, f) => s + f.loaded, 0) / all.reduce((s, f) => s + f.total, 0)) * 100;
        fill.style.width = `${pct.toFixed(0)}%`;
        status.textContent = `Downloading FinBERT… ${pct.toFixed(0)}%`;
      }
    },
  }).then((clf) => {
    bar.hidden = true;
    status.textContent = "Model ready ✓";
    return clf;
  }).catch((err) => {
    classifierPromise = null;
    bar.hidden = true;
    status.textContent = `Could not load model: ${err.message}`;
    throw err;
  });
  return classifierPromise;
}

function toProbs(res) {
  const probs = { positive: 0, neutral: 0, negative: 0 };
  for (const r of res) probs[r.label.toLowerCase()] = r.score;
  const label = Object.keys(probs).reduce((a, b) => (probs[a] >= probs[b] ? a : b));
  return { probs, label, score: probs.positive - probs.negative };
}

const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(3);

function resultCard(text, r) {
  const L = LABEL[r.label];
  const rows = ["positive", "neutral", "negative"].map((k) => `
    <div class="prob-row">
      <span>${LABEL[k].icon} ${LABEL[k].text}</span>
      <div class="prob-track"><div style="width:${(r.probs[k] * 100).toFixed(1)}%;background:${LABEL[k].color}"></div></div>
      <span class="num">${(r.probs[k] * 100).toFixed(1)}%</span>
    </div>`).join("");
  return `<div class="az-result">
    <div class="az-head"><span class="pill ${r.label}">${L.icon} ${L.text}</span><span class="score">score ${signed(r.score)}</span></div>
    <div class="az-text">${esc(text)}</div>
    ${rows}
  </div>`;
}

async function analyze() {
  const raw = $("#az-input").value.trim();
  if (!raw) { $("#az-input").focus(); return; }
  const btn = $("#az-run");
  btn.disabled = true;
  btn.textContent = "Analyzing…";
  try {
    const clf = await loadModel();
    const texts = $("#az-lines").checked
      ? raw.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 100)
      : [raw];
    const t0 = performance.now();
    const results = [];
    for (const t of texts) results.push(toProbs(await clf(t, { top_k: 3 })));
    const ms = performance.now() - t0;

    let html = "";
    if (results.length > 1) {
      const c = { positive: 0, neutral: 0, negative: 0 };
      results.forEach((r) => c[r.label]++);
      const avg = results.reduce((s, r) => s + r.score, 0) / results.length;
      html += `<div class="az-summary">
        <span><strong>${results.length}</strong> headlines</span>
        <span>Avg score <strong>${signed(avg)}</strong></span>
        <span>▲ ${c.positive} positive</span><span>● ${c.neutral} neutral</span><span>▼ ${c.negative} negative</span>
      </div>`;
    }
    html += results.map((r, i) => resultCard(texts[i], r)).join("");
    $("#az-results").innerHTML = html;
    $("#az-status").textContent = `Done in ${(ms / 1000).toFixed(2)}s`;
  } catch (e) {
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = "Analyze";
  }
}

$("#az-run").addEventListener("click", analyze);
$("#az-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) analyze(); });
document.querySelectorAll(".chip[data-ex]").forEach((c) => c.addEventListener("click", () => {
  $("#az-input").value = c.dataset.ex;
  analyze();
}));
// Start downloading the model as soon as the analyzer tab is opened.
document.querySelector('.tab[data-tab="analyzer"]').addEventListener("click", () => loadModel().catch(() => {}));
if (location.hash === "#analyzer") loadModel().catch(() => {});
