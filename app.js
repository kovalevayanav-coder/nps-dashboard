let rawData = null;
let monthCatalog = new Map();
let chartMonthly = null;
let chartDistribution = null;
let chartCallRate = null;
let chartAgeNps = null;
const REF_DATE = new Date();

const TYPE_LABELS = {
  promoter: "Промоутер",
  passive: "Нейтрал",
  detractor: "Критик",
};

function getScoreType(score) {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

function calcNps(responses) {
  if (!responses.length) return null;
  const promoters = responses.filter((r) => r.score >= 9).length;
  const detractors = responses.filter((r) => r.score <= 6).length;
  const total = responses.length;
  return Math.round(((promoters - detractors) / total) * 100);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Ключ месяца оценки (YYYY-MM) — только колонка «месяц оценки», не дата активации */
function responseMonth(r) {
  return r.surveyMonth || null;
}

function monthLabel(key) {
  if (!key) return "—";
  return monthCatalog.get(key) || formatMonthKeyLabel(key);
}

function callMonth(c) {
  return c.surveyMonth || null;
}

function buildMonthCatalog(responses, calls) {
  const map = new Map();
  const add = (key, label) => {
    if (!key) return;
    if (!map.has(key) || label) map.set(key, label || formatMonthKeyLabel(key));
  };
  (calls || []).forEach((c) => add(callMonth(c), c.surveyMonthLabel));
  (responses || []).forEach((r) => add(responseMonth(r), r.surveyMonthLabel));
  return map;
}

function sortMonthKeys(keys) {
  return [...keys].sort((a, b) => {
    if (/^\d{4}-\d{2}$/.test(a) && /^\d{4}-\d{2}$/.test(b)) return a.localeCompare(b);
    return String(a).localeCompare(String(b), "ru");
  });
}

function filterByMonth(items, monthFilter, getMonth) {
  if (monthFilter === "all") return items;
  return items.filter((x) => getMonth(x) === monthFilter);
}

function filterResponsesForDashboard(responses, monthFilter) {
  return filterByMonth(responses, monthFilter, responseMonth);
}

function filterResponsesForTable(responses, monthFilter, typeFilter, scoreFilter) {
  return filterResponsesForDashboard(responses, monthFilter).filter((r) => {
    if (typeFilter !== "all" && getScoreType(r.score) !== typeFilter) return false;
    if (scoreFilter !== "all" && r.score !== Number(scoreFilter)) return false;
    return true;
  });
}

function pct(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function calcCallStats(calls) {
  const total = calls.length;
  const connected = calls.filter((c) => isSuccessfulCall(c.status)).length;
  const rate = total ? Math.round((connected / total) * 100) : null;
  return { total, connected, rate };
}

function updateCallKpis(calls, responses, monthFilter) {
  const filteredCalls = filterByMonth(calls || [], monthFilter, callMonth);
  const filteredResponses = filterResponsesForDashboard(responses || [], monthFilter);
  const stats = calcCallStats(filteredCalls);
  const scored = filteredResponses.length;
  const hasCalls = (calls || []).length > 0;

  document.getElementById("kpi-base").textContent = hasCalls ? stats.total : "—";
  document.getElementById("kpi-connected").textContent = hasCalls ? stats.connected : "—";
  document.getElementById("kpi-connected-pct").textContent = hasCalls
    ? `${pct(stats.connected, stats.total)} от базы`
    : "";

  document.getElementById("kpi-scored").textContent = hasCalls ? scored : "—";
  document.getElementById("kpi-scored-pct").textContent = hasCalls
    ? `${pct(scored, stats.total)} от базы`
    : "";
}

function buildMonthlyCallRate(calls, monthFilter) {
  const withMonth = (calls || []).filter((c) => callMonth(c));
  const months = sortMonthKeys([...new Set(withMonth.map((c) => callMonth(c)))]);
  const filteredMonths =
    monthFilter !== "all" ? months.filter((m) => m === monthFilter) : months;

  const labels = filteredMonths.map((m) => monthLabel(m));
  const values = filteredMonths.map((m) => {
    const monthCalls = withMonth.filter((c) => callMonth(c) === m);
    const { rate } = calcCallStats(monthCalls);
    return rate ?? 0;
  });

  return { labels, values };
}

function populateMonthFilter(responses, calls) {
  const select = document.getElementById("filter-month");
  const monthSet = new Set();
  responses.forEach((r) => {
    const m = responseMonth(r);
    if (m) monthSet.add(m);
  });
  (calls || []).forEach((c) => {
    const m = callMonth(c);
    if (m) monthSet.add(m);
  });
  const months = sortMonthKeys(monthSet).reverse();

  select.innerHTML = '<option value="all">Все месяцы оценки</option>';
  months.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = monthLabel(m);
    select.appendChild(opt);
  });
}

function updateKpis(responses) {
  const nps = calcNps(responses);
  const promoters = responses.filter((r) => r.score >= 9).length;
  const passives = responses.filter((r) => r.score >= 7 && r.score <= 8).length;
  const detractors = responses.filter((r) => r.score <= 6).length;
  const total = responses.length;

  const npsEl = document.getElementById("kpi-nps");
  if (nps === null) {
    npsEl.textContent = "—";
    npsEl.className = "kpi-value";
  } else {
    npsEl.textContent = (nps > 0 ? "+" : "") + nps;
    npsEl.className = "kpi-value " + (nps >= 0 ? "positive" : "negative");
  }

  document.getElementById("kpi-total").textContent = total;
  document.getElementById("kpi-promoters").textContent = promoters;
  document.getElementById("kpi-passives").textContent = passives;
  document.getElementById("kpi-detractors").textContent = detractors;
  document.getElementById("kpi-promoters-pct").textContent = pct(promoters, total);
  document.getElementById("kpi-passives-pct").textContent = pct(passives, total);
  document.getElementById("kpi-detractors-pct").textContent = pct(detractors, total);
}

/** NPS по месяцам — группировка только по «месяц оценки» (surveyMonth) */
function buildMonthlyNps(allResponses, monthFilter) {
  const withMonth = allResponses.filter((r) => responseMonth(r));
  const months = sortMonthKeys([...new Set(withMonth.map((r) => responseMonth(r)))]);
  const filteredMonths =
    monthFilter !== "all" ? months.filter((m) => m === monthFilter) : months;

  const labels = filteredMonths.map((m) => monthLabel(m));
  const values = filteredMonths.map((m) => {
    const monthResponses = withMonth.filter((r) => responseMonth(r) === m);
    return calcNps(monthResponses);
  });

  return { labels, values };
}

function buildAgeNpsSeries(responses) {
  const scoresByCohort = Object.fromEntries(AGE_COHORTS.map((c) => [c.key, []]));

  responses.forEach((r) => {
    if (!r.registrationDate) return;
    const reg = new Date(r.registrationDate + "T12:00:00");
    const key = getAgeCohortKey(reg, REF_DATE);
    if (key) scoresByCohort[key].push(r.score);
  });

  return AGE_COHORTS.map((c) => {
    const scores = scoresByCohort[c.key];
    const count = scores.length;
    return {
      label: c.label,
      nps: count ? calcNps(scores.map((s) => ({ score: s }))) : null,
      count,
    };
  });
}

function buildDistribution(responses) {
  const counts = Array(11).fill(0);
  responses.forEach((r) => {
    if (r.score >= 0 && r.score <= 10) counts[r.score]++;
  });
  return counts;
}

function updateCharts(responses, allResponses, calls, monthFilter) {
  const monthly = buildMonthlyNps(allResponses, monthFilter);
  const dist = buildDistribution(responses);
  const callMonthly = buildMonthlyCallRate(calls, monthFilter);
  const ageSeries = buildAgeNpsSeries(responses);

  if (chartMonthly) chartMonthly.destroy();
  if (chartDistribution) chartDistribution.destroy();
  if (chartCallRate) chartCallRate.destroy();
  if (chartAgeNps) chartAgeNps.destroy();

  const gridColor = "rgba(139, 156, 179, 0.15)";
  const textColor = "#8b9cb3";

  chartMonthly = new Chart(document.getElementById("chart-nps-monthly"), {
    type: "bar",
    data: {
      labels: monthly.labels,
      datasets: [
        {
          label: "NPS",
          data: monthly.values.map((v) => (v === null ? 0 : v)),
          backgroundColor: monthly.values.map((v) =>
            v === null
              ? "rgba(139, 156, 179, 0.35)"
              : v >= 0
                ? "rgba(59, 130, 246, 0.8)"
                : "rgba(239, 68, 68, 0.8)",
          ),
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const real = monthly.values[ctx.dataIndex];
              if (real === null || real === undefined) return "Нет данных";
              return `NPS: ${real > 0 ? "+" : ""}${real}`;
            },
          },
        },
      },
      scales: {
        y: {
          min: -100,
          max: 100,
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            callback: (v) => (v > 0 ? `+${v}` : String(v)),
          },
        },
        x: {
          grid: { display: false },
          ticks: { color: textColor },
        },
      },
    },
  });

  const barColors = dist.map((_, i) => {
    if (i >= 9) return "rgba(34, 197, 94, 0.75)";
    if (i >= 7) return "rgba(234, 179, 8, 0.75)";
    return "rgba(239, 68, 68, 0.75)";
  });

  chartAgeNps = new Chart(document.getElementById("chart-age-nps"), {
    type: "bar",
    data: {
      labels: ageSeries.map((x) => x.label),
      datasets: [
        {
          label: "NPS",
          data: ageSeries.map((x) => (x.nps === null ? 0 : Math.max(0, x.nps))),
          backgroundColor: ageSeries.map((x) =>
            x.nps === null
              ? "rgba(139, 156, 179, 0.35)"
              : "rgba(16, 185, 129, 0.75)",
          ),
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pt = ageSeries[ctx.dataIndex];
              if (!pt || pt.nps === null) return "Нет данных";
              return `NPS: ${pt.nps > 0 ? "+" : ""}${pt.nps} · ${pt.count} ответов`;
            },
          },
        },
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: { color: gridColor },
          ticks: { color: textColor },
        },
        x: {
          grid: { display: false },
          ticks: { color: textColor },
        },
      },
    },
  });

  chartDistribution = new Chart(document.getElementById("chart-distribution"), {
    type: "bar",
    data: {
      labels: dist.map((_, i) => String(i)),
      datasets: [
        {
          label: "Ответов",
          data: dist,
          backgroundColor: barColors,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, color: textColor },
          grid: { color: gridColor },
        },
        x: {
          title: { display: true, text: "Оценка", color: textColor },
          grid: { display: false },
          ticks: { color: textColor },
        },
      },
    },
  });

  chartCallRate = new Chart(document.getElementById("chart-call-rate"), {
    type: "bar",
    data: {
      labels: callMonthly.labels,
      datasets: [
        {
          label: "% дозвона",
          data: callMonthly.values,
          backgroundColor: "rgba(167, 139, 250, 0.75)",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.y}%`,
          },
        },
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { callback: (v) => v + "%", color: textColor },
          grid: { color: gridColor },
        },
        x: {
          grid: { display: false },
          ticks: { color: textColor },
        },
      },
    },
  });
}

function renderTable(responses) {
  const tbody = document.getElementById("reviews-tbody");
  const empty = document.getElementById("reviews-empty");
  const countEl = document.getElementById("reviews-count");

  countEl.textContent = `${responses.length} записей`;
  tbody.innerHTML = "";

  if (!responses.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const sorted = [...responses].sort((a, b) =>
    String(responseMonth(b) || "").localeCompare(String(responseMonth(a) || ""), "ru"),
  );

  sorted.forEach((r) => {
    const type = getScoreType(r.score);
    let ageLabel = "—";
    if (r.registrationDate) {
      const reg = new Date(r.registrationDate + "T12:00:00");
      const key = getAgeCohortKey(reg, REF_DATE);
      ageLabel = key ? getAgeCohortLabel(key) : "—";
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.surveyMonthLabel || monthLabel(responseMonth(r)))}</td>
      <td>${r.registrationDate ? formatDate(r.registrationDate) : "—"}</td>
      <td>${ageLabel}</td>
      <td><span class="score-pill">${r.score}</span></td>
      <td><span class="badge badge-${type}">${TYPE_LABELS[type]}</span></td>
      <td class="comment-cell">${escapeHtml(r.comment || "—")}</td>
    `;
    tbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function render() {
  if (!rawData) return;

  try {
    const monthFilter = document.getElementById("filter-month")?.value || "all";
    const reviewType = document.getElementById("review-filter-type")?.value || "all";
    const reviewScore = document.getElementById("review-filter-score")?.value || "all";

    const dashboardResponses = filterResponsesForDashboard(rawData.responses || [], monthFilter);
    const tableResponses = filterResponsesForTable(
      rawData.responses || [],
      monthFilter,
      reviewType,
      reviewScore,
    );
    const calls = rawData.calls || [];

    updateKpis(dashboardResponses);
    updateCharts(dashboardResponses, rawData.responses || [], calls, monthFilter);
    renderTable(tableResponses);
    updateCallKpis(calls, rawData.responses || [], monthFilter);
  } catch (err) {
    console.error(err);
    setStatus("Ошибка отображения: " + err.message, true);
  }
}

const DATA_XLSX = "data.xlsx";

async function loadFromXlsx() {
  try {
    const res = await fetch(DATA_XLSX + "?" + Date.now());
    if (!res.ok) return { data: null, error: null };
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    return { data: parseNpsWorkbook(wb, DATA_XLSX), error: null };
  } catch (err) {
    console.warn("data.xlsx:", err);
    return { data: null, error: err.message || String(err) };
  }
}

async function loadFromJson() {
  const res = await fetch("data.json?" + Date.now());
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data.responses)) return null;
  return data;
}

function setStatus(text, isError) {
  const el = document.getElementById("data-updated");
  if (el) {
    el.textContent = text;
    el.classList.toggle("status-error", !!isError);
  }
}

function applyData(data) {
  if (typeof parseNpsWorkbook !== "function" || typeof normalizeLegacyItem !== "function") {
    throw new Error("Не загружен parse-workbook.js — проверьте файл на GitHub");
  }
  if (typeof Chart === "undefined") {
    throw new Error("Не загрузилась библиотека графиков (Chart.js). Проверьте интернет");
  }

  rawData = data;
  rawData.responses = (rawData.responses || []).map((r) => normalizeLegacyItem({ ...r }));
  rawData.calls = (rawData.calls || []).map((c) => normalizeLegacyItem({ ...c }));
  monthCatalog = buildMonthCatalog(rawData.responses, rawData.calls);

  const meta = rawData.meta || {};
  let updated = meta.updatedAt
    ? `Обновлено: ${meta.updatedAt}${meta.source ? " · " + meta.source : ""}`
    : "Данные загружены";
  if (rawData.mapping?.surveyMonthHeader) {
    updated += ` · колонка месяца: «${rawData.mapping.surveyMonthHeader}»`;
  }
  setStatus(updated, false);
  const errBox = document.getElementById("load-error");
  if (errBox) errBox.classList.add("hidden");
  populateMonthFilter(rawData.responses, rawData.calls);

  if (!rawData.responses.length && !rawData.calls.length) {
    setStatus("Файл загружен, но строк данных не найдено. Проверьте колонки в Excel.", true);
  } else {
    const noMonth = (rawData.responses || []).filter((r) => !responseMonth(r)).length;
    if (noMonth > 0) {
      setStatus(
        `${updated} · ⚠ ${noMonth} ответов без «месяц оценки» — проверьте колонку в Excel`,
        true,
      );
    }
  }

  render();
}

async function loadData() {
  setStatus("Загрузка данных…", false);
  let xlsxError = null;

  try {
    const xlsxResult = await loadFromXlsx();
    if (xlsxResult?.data) {
      applyData(xlsxResult.data);
      return;
    }
    xlsxError = xlsxResult?.error;

    const jsonData = await loadFromJson();
    if (jsonData) {
      applyData(jsonData);
      return;
    }

    const errBox = document.getElementById("load-error");
    const errText = document.getElementById("load-error-text");
    if (errText) {
      errText.textContent = xlsxError
        ? `Ошибка в data.xlsx: ${xlsxError}. Загрузите исправленный Excel на GitHub.`
        : "Файл data.xlsx не найден на сайте. Загрузите data.xlsx в репозиторий на GitHub.";
    }
    if (errBox) errBox.classList.remove("hidden");
    setStatus("Не удалось загрузить данные", true);
  } catch (err) {
    console.error(err);
    const errBox = document.getElementById("load-error");
    const errText = document.getElementById("load-error-text");
    if (errText) errText.textContent = err.message || String(err);
    if (errBox) errBox.classList.remove("hidden");
    setStatus("Ошибка: " + (err.message || "неизвестная"), true);
  }
}

function setupFilters() {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", fn);
  };
  bind("filter-month", render);
  bind("review-filter-type", render);
  bind("review-filter-score", render);

  const reset = document.getElementById("reset-filters");
  if (reset) {
    reset.addEventListener("click", () => {
      const m = document.getElementById("filter-month");
      const t = document.getElementById("review-filter-type");
      const s = document.getElementById("review-filter-score");
      if (m) m.value = "all";
      if (t) t.value = "all";
      if (s) s.value = "all";
      render();
    });
  }
}

function injectDocs() {
  const update = document.getElementById("doc-update");
  const deploy = document.getElementById("doc-deploy");
  if (!update || !deploy) return;

  update.innerHTML = `
    <p>Данные — файл <code>data.xlsx</code> в корне проекта на GitHub.</p>
    <h3>Колонки в Excel</h3>
    <ul>
      <li><strong>Дозвон</strong>, <strong>Оценка</strong>, <strong>Дата регистрации бизнеса</strong>, <strong>Комментарий</strong></li>
      <li><strong>месяц оценки</strong> — для графика NPS по месяцам (дата или 4.26)</li>
    </ul>
    <h3>Обновление</h3>
    <ol>
      <li>GitHub → замените <code>data.xlsx</code> → Commit</li>
      <li>Ctrl+F5 на дашборде</li>
    </ol>
  `;

  deploy.innerHTML = `
    <p>На GitHub должны быть: <code>index.html</code>, <code>app.js</code>, <code>parse-workbook.js</code>, <code>styles.css</code>, <code>data.xlsx</code>, <code>vercel.json</code></p>
    <p>Vercel: Framework <strong>Other</strong>, Build Command пустой.</p>
  `;
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    setupFilters();
    injectDocs();
    loadData();
  } catch (err) {
    console.error(err);
    setStatus("Ошибка запуска: " + err.message, true);
  }
});
