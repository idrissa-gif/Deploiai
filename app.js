/* Deploia-Green — companion site charts.
   All figures are built from data.json aggregated by build_data.py. */

const COLORS = {
  block: "#f7768e",
  gists: "#e0af68",
  grabs: "#3ddc97",
};
const STRAT_LABEL = { block: "Block", gists: "GISTS", grabs: "GRABS" };
const DARK = {
  paper_bgcolor: "#161b24",
  plot_bgcolor: "#161b24",
  font: { color: "#e8ecf3" },
  xaxis: { gridcolor: "#242a36", zerolinecolor: "#242a36" },
  yaxis: { gridcolor: "#242a36", zerolinecolor: "#242a36" },
  legend: { bgcolor: "rgba(0,0,0,0)" },
  margin: { l: 60, r: 20, t: 30, b: 50 },
};

function base(layout = {}) {
  return {
    ...DARK,
    ...layout,
    xaxis: { ...DARK.xaxis, ...(layout.xaxis || {}) },
    yaxis: { ...DARK.yaxis, ...(layout.yaxis || {}) },
  };
}

async function main() {
  const data = await fetch("data.json").then((r) => r.json());
  window.__DATA__ = data;

  // group summary by strategy for line plots
  const byStrategy = {};
  for (const s of data.strategies) byStrategy[s] = [];
  for (const row of data.summary) {
    byStrategy[row.strategy].push(row);
  }
  for (const s of data.strategies) {
    byStrategy[s].sort((a, b) => a.rho_pct - b.rho_pct);
  }

  drawLinePlot(
    "fig-rmse-vs-rho",
    byStrategy,
    (row) => row.rmse,
    "Sampling rate ρ (%)",
    "Mean test RMSE",
    "Lower is better. Shaded bar shows ±1 σ across 12 configurations (4 archs × 3 capacities).",
  );

  drawLinePlot(
    "fig-energy-vs-rho",
    byStrategy,
    (row) => row.energy_kwh,
    "Sampling rate ρ (%)",
    "Training energy per run (kWh)",
    "CodeCarbon total energy (RAPL + NVML + DRAM) over the training window only.",
    { log_y: true },
  );

  drawLinePlot(
    "fig-time-vs-rho",
    byStrategy,
    (row) => row.time_s,
    "Sampling rate ρ (%)",
    "Wall-clock training time (s)",
    "Average across all 12 configurations.",
    { log_y: true },
  );

  drawLinePlot(
    "fig-eps",
    byStrategy,
    (row) => row.energy_per_sample_kwh,
    "Sampling rate ρ (%)",
    "Energy per training sample (kWh/sample)",
    "Strategy cost per training sample: lower means each sample seen was processed more energy-efficiently.",
    { log_y: true },
  );

  setupPerArchChart(data);
  drawPareto(data);
  setupWeightedScore(byStrategy);
}

function drawLinePlot(divId, byStrategy, pick, xlab, ylab, title, opts = {}) {
  const traces = [];
  for (const s of Object.keys(byStrategy)) {
    const rows = byStrategy[s];
    const x = rows.map((r) => r.rho_pct);
    const y = rows.map((r) => pick(r)?.mean);
    const err = rows.map((r) => pick(r)?.std || 0);
    traces.push({
      x, y,
      error_y: { type: "data", array: err, visible: true, thickness: 1, color: COLORS[s] },
      mode: "lines+markers",
      name: STRAT_LABEL[s],
      line: { color: COLORS[s], width: 2.5 },
      marker: { size: 9, color: COLORS[s] },
      hovertemplate: `<b>${STRAT_LABEL[s]}</b> · ρ=%{x}%<br>${ylab}: %{y:.4g}<extra></extra>`,
    });
  }
  const layout = base({
    title: { text: title, font: { size: 12, color: "#98a3b3" } },
    xaxis: { title: xlab, dtick: 10 },
    yaxis: { title: ylab, type: opts.log_y ? "log" : "linear" },
    hovermode: "x unified",
  });
  Plotly.newPlot(divId, traces, layout, { responsive: true, displaylogo: false });
}

function setupPerArchChart(data) {
  const archSel = document.getElementById("arch-select");
  const metSel = document.getElementById("arch-metric");
  for (const a of data.architectures) {
    const o = document.createElement("option");
    o.value = a; o.textContent = a;
    archSel.appendChild(o);
  }
  archSel.value = "LSTM";
  const redraw = () => drawPerArch(data, archSel.value, metSel.value);
  archSel.onchange = redraw;
  metSel.onchange = redraw;
  redraw();
}

function drawPerArch(data, arch, metric) {
  const byStrategy = {};
  for (const s of data.strategies) byStrategy[s] = [];
  for (const row of data.per_arch) {
    if (row.architecture === arch) byStrategy[row.strategy].push(row);
  }
  for (const s of data.strategies) {
    byStrategy[s].sort((a, b) => a.rho_pct - b.rho_pct);
  }
  const metricLabel = { rmse: "Test RMSE", energy_kwh: "Energy (kWh)", time_s: "Time (s)" }[metric];
  const traces = [];
  for (const s of data.strategies) {
    const rows = byStrategy[s];
    const x = rows.map((r) => r.rho_pct);
    const y = rows.map((r) => r[metric]?.mean);
    const err = rows.map((r) => r[metric]?.std || 0);
    traces.push({
      x, y,
      error_y: { type: "data", array: err, visible: true, thickness: 1, color: COLORS[s] },
      mode: "lines+markers",
      name: STRAT_LABEL[s],
      line: { color: COLORS[s], width: 2.5 },
      marker: { size: 9, color: COLORS[s] },
      hovertemplate: `<b>${STRAT_LABEL[s]}</b> · ${arch} · ρ=%{x}%<br>${metricLabel}: %{y:.4g}<extra></extra>`,
    });
  }
  const layout = base({
    title: { text: `${arch} — ${metricLabel} vs sampling rate`, font: { size: 12, color: "#98a3b3" } },
    xaxis: { title: "Sampling rate ρ (%)", dtick: 10 },
    yaxis: { title: metricLabel, type: metric === "rmse" ? "linear" : "log" },
    hovermode: "x unified",
  });
  Plotly.newPlot("fig-per-arch", traces, layout, { responsive: true, displaylogo: false });
}

function drawPareto(data) {
  const traces = [];
  for (const s of data.strategies) {
    const rows = data.summary
      .filter((r) => r.strategy === s)
      .sort((a, b) => a.rho_pct - b.rho_pct);
    traces.push({
      x: rows.map((r) => r.energy_kwh?.mean),
      y: rows.map((r) => r.rmse?.mean),
      text: rows.map((r) => `ρ=${r.rho_pct}%`),
      mode: "markers+text+lines",
      textposition: "top center",
      textfont: { size: 10, color: "#98a3b3" },
      name: STRAT_LABEL[s],
      line: { color: COLORS[s], width: 1, dash: "dot" },
      marker: { size: 12, color: COLORS[s], line: { width: 1, color: "#0f1218" } },
      hovertemplate: `<b>${STRAT_LABEL[s]}</b> · %{text}<br>Energy: %{x:.4g} kWh<br>RMSE: %{y:.3f}<extra></extra>`,
    });
  }
  const layout = base({
    title: { text: "Each marker = (strategy, ρ). Lower-left dominates.", font: { size: 12, color: "#98a3b3" } },
    xaxis: { title: "Training energy per run (kWh, log)", type: "log" },
    yaxis: { title: "Mean test RMSE" },
    showlegend: true,
  });
  Plotly.newPlot("fig-pareto", traces, layout, { responsive: true, displaylogo: false });
}

function setupWeightedScore(byStrategy) {
  // Min-max normalise RMSE and energy across all (strategy, ρ) points.
  const all = [];
  for (const s of Object.keys(byStrategy)) for (const r of byStrategy[s]) all.push(r);
  const rmses = all.map((r) => r.rmse?.mean).filter((v) => v != null);
  const energies = all.map((r) => r.energy_kwh?.mean).filter((v) => v != null);
  const rMin = Math.min(...rmses), rMax = Math.max(...rmses);
  const eMin = Math.min(...energies), eMax = Math.max(...energies);
  const norm = (v, lo, hi) => (hi === lo ? 0 : (v - lo) / (hi - lo));

  const slider = document.getElementById("score-alpha");
  const valLabel = document.getElementById("score-alpha-val");

  const redraw = () => {
    const alpha = parseFloat(slider.value);
    valLabel.textContent = alpha.toFixed(2);
    drawWeightedScore(byStrategy, alpha, { rMin, rMax, eMin, eMax, norm });
  };
  slider.addEventListener("input", redraw);
  redraw();
}

function drawWeightedScore(byStrategy, alpha, n) {
  const traces = [];
  for (const s of Object.keys(byStrategy)) {
    const rows = byStrategy[s];
    const x = rows.map((r) => r.rho_pct);
    const y = rows.map((r) => {
      if (r.rmse?.mean == null || r.energy_kwh?.mean == null) return null;
      const rN = n.norm(r.rmse.mean, n.rMin, n.rMax);
      const eN = n.norm(r.energy_kwh.mean, n.eMin, n.eMax);
      return alpha * rN + (1 - alpha) * eN;
    });
    traces.push({
      x, y,
      mode: "lines+markers",
      name: STRAT_LABEL[s],
      line: { color: COLORS[s], width: 2.5 },
      marker: { size: 9, color: COLORS[s] },
      hovertemplate: `<b>${STRAT_LABEL[s]}</b> · ρ=%{x}%<br>score = %{y:.3f}<extra></extra>`,
    });
  }
  const accPct = Math.round(alpha * 100);
  const enPct = 100 - accPct;
  const layout = base({
    title: {
      text: `score = α·RMSE_norm + (1-α)·Energy_norm — α=${alpha.toFixed(2)} (Accuracy ${accPct}% · Energy ${enPct}%). Lower is better.`,
      font: { size: 12, color: "#98a3b3" },
    },
    xaxis: { title: "Sampling rate ρ (%)", dtick: 10 },
    yaxis: { title: "Weighted trade-off score", range: [0, 1] },
    hovermode: "x unified",
  });
  Plotly.newPlot("fig-score", traces, layout, { responsive: true, displaylogo: false });
}

main().catch((err) => {
  console.error(err);
  document.querySelectorAll(".plot").forEach((d) => {
    d.innerHTML =
      '<p style="padding:20px;color:#f7768e">' +
      "Failed to load data.json — if you opened this file locally with file://, " +
      "run a static server (e.g. <code>python -m http.server</code>) from docs/site/." +
      "</p>";
  });
});
