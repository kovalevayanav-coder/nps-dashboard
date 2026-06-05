let rawData = null;
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

function formatMonth(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("ru-RU", { year: "numeric", month: "long" });
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function responseMonth(r) {
  return r.surveyMonth || (r.date ? r.date.slice(0, 7) : null);
}

function formatSurveyMonth(monthKeyStr) {
  if (!monthKeyStr) return "—";
  const [y, mo] = monthKeyStr.split("-");
  if (!y || !mo) return monthKeyStr;
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
  });
}

function filterResponses(responses, monthFilter, typeFilter) {
  return responses.filter((r) => {
    if (monthFilter !== "all" && responseMonth(r) !== monthFilter) return false;
    if (typeFilter !== "all" && getScoreType(r.score) !== typeFilter) return false;
    return true;
  });
}

function pct(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function callMonth(c) {
  return c.surveyMonth || (c.date ? c.date.slice(0, 7) : null);
}

function filterCalls(calls, monthFilter) {
  if (!calls?.length) return [];
  if (monthFilter === "all") return calls;
  return calls.filter((c) => callMonth(c) === monthFilter);
}

function calcCallStats(calls) {
  const total = calls.length;
  const connected = calls.filter((c) => isSuccessfulCall(c.status)).length;
  const rate = total ? Math.round((connected / total) * 100) : null;
  const byStatus = {};
  calls.forEach((c) => {
    const st = c.status || "Без статуса";
    byStatus[st] = (byStatus[st] || 0) + 1;
  });
  return { total, connected, rate, byStatus };
}

function updateCallKpis(calls, monthFilter) {
  const filtered = filterCalls(calls, monthFilter);
  const stats = calcCallStats(filtered);
  const hasCalls = calls?.length > 0;

  document.getElementById("kpi-base").textContent = hasCalls ? stats.total : "—";
  document.getElementById("kpi-connected").textContent = hasCalls ? stats.connected : "—";
  document.getElementById("kpi-connected-of-base").textContent = hasCalls
    ? `${pct(stats.connected, stats.total)} от базы`
    : "";

  const rateEl = document.getElementById("kpi-call-rate");
  if (!hasCalls || stats.rate === null) {
    rateEl.textContent = "—";
  } else {
    rateEl.textContent = `${stats.rate}%`;
  }

  const breakdownEl = document.getElementById("kpi-call-breakdown");
  if (!hasCalls) {
    breakdownEl.textContent = "Нет данных — положите data.xlsx в папку проекта";
    return;
  }

  const other = Object.entries(stats.byStatus)
    .filter(([st]) => !isSuccessfulCall(st))
    .sort((a, b) => b[1] - a[1])
    .map(([st, n]) => `${st}: ${n}`)
    .join(" · ");
  breakdownEl.textContent = other || "остальные статусы: 0";
}

function buildMonthlyCallRate(calls, monthFilter) {
  const withMonth = (calls || []).filter((c) => callMonth(c));
  const months = [...new Set(withMonth.map((c) => callMonth(c)))].sort();
  const filteredMonths =
    monthFilter !== "all" ? months.filter((m) => m === monthFilter) : months;

  const labels = filteredMonths.map((m) => {
    const [y, mo] = m.split("-");
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("ru-RU", {
      month: "short",
      year: "2-digit",
    });
  });

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
  const months = [...monthSet].sort().reverse();

  select.innerHTML = '<option value="all">Все месяцы обзвона</option>';
  months.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = formatSurveyMonth(m);
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

function buildMonthlyNps(allResponses, monthFilter) {
  const months = [...new Set(allResponses.map((r) => responseMonth(r)).filter(Boolean))].sort();
  const filteredMonths =
    monthFilter !== "all" ? months.filter((m) => m === monthFilter) : months;

  const labels = filteredMonths.map((m) => {
    const [y, mo] = m.split("-");
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("ru-RU", {
      month: "short",
      year: "2-digit",
    });
  });

  const values = filteredMonths.map((m) => {
    const monthResponses = allResponses.filter((r) => responseMonth(r) === m);
    return calcNps(monthResponses) ?? 0;
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
    type: "line",
    data: {
      labels: monthly.labels,
      datasets: [
        {
          label: "NPS",
          data: monthly.values,
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.12)",
          fill: true,
          tension: 0.35,
          pointRadius: 5,
          pointBackgroundColor: "#3b82f6",
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
            label: (ctx) => `NPS: ${ctx.parsed.y > 0 ? "+" : ""}${ctx.parsed.y}`,
          },
        },
      },
      scales: {
        y: {
          min: -100,
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

  const barColors = dist.map((_, i) => {
    if (i >= 9) return "rgba(34, 197, 94, 0.75)";
    if (i >= 7) return "rgba(234, 179, 8, 0.75)";
    return "rgba(239, 68, 68, 0.75)";
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

  chartAgeNps = new Chart(document.getElementById("chart-age-nps"), {
    type: "bar",
    data: {
      labels: ageSeries.map((x) => x.label),
      datasets: [
        {
          label: "NPS",
          data: ageSeries.map((x) => (x.nps === null ? 0 : x.nps)),
          backgroundColor: ageSeries.map((x) =>
            x.nps === null
              ? "rgba(139, 156, 179, 0.35)"
              : x.nps >= 0
                ? "rgba(16, 185, 129, 0.75)"
                : "rgba(244, 63, 94, 0.75)",
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
          min: -100,
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
    (responseMonth(b) || "").localeCompare(responseMonth(a) || ""),
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
      <td>${formatSurveyMonth(responseMonth(r))}</td>
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

  const monthFilter = document.getElementById("filter-month").value;
  const typeFilter = document.getElementById("filter-type").value;
  const filtered = filterResponses(rawData.responses, monthFilter, typeFilter);
  const calls = rawData.calls || [];

  updateCallKpis(calls, monthFilter);
  updateKpis(filtered);
  updateCharts(filtered, rawData.responses, calls, monthFilter);
  renderTable(filtered);
}

function injectDocs() {
  document.getElementById("doc-local").innerHTML = `
    <p>Дашборд нельзя открыть как обычный файл — браузер не загрузит <code>data.xlsx</code>. Нужен простой локальный сервер.</p>
    <h3>Вариант 1 — двойной щелчок (Windows)</h3>
    <p>В папке проекта запустите файл <code>start.bat</code> — откроется сервер на <a href="http://localhost:3000" target="_blank" rel="noopener">http://localhost:3000</a>.</p>
    <h3>Вариант 2 — терминал в папке проекта</h3>
    <pre>cd путь\\к\\nps-dashboard
npx serve .</pre>
    <p>Нужен Node.js (<a href="https://nodejs.org" target="_blank" rel="noopener">nodejs.org</a>). В терминале появится адрес — откройте его в браузере (часто <code>http://localhost:3000</code>).</p>
    <h3>Вариант 3 — npm</h3>
    <pre>npm start</pre>
    <p>То же самое, если в папке есть <code>package.json</code> со скриптом <code>start</code>.</p>
    <h3>Вариант 4 — Python (если Node нет)</h3>
    <pre>python -m http.server 3000</pre>
    <p>Затем откройте <code>http://localhost:3000</code>.</p>
  `;

  document.getElementById("doc-update").innerHTML = `
    <p>Данные — один Excel-файл <code>data.xlsx</code> в корне проекта. JSON вручную редактировать не нужно.</p>
    <h3>Колонки в Excel (первая строка — заголовки)</h3>
    <ul>
      <li><strong>Дозвон</strong> — статус: Дозвон, Не дозвон, Отказник, 3 гудка…</li>
      <li><strong>Оценка</strong> — число 0–10</li>
      <li><strong>Дата регистрации бизнеса</strong> — для возраста клиента</li>
      <li><strong>Месяц обзвона</strong> — последний столбец в таблице</li>
      <li><strong>Комментарий</strong> — без имён, email, телефонов</li>
      <li><strong>N</strong> — номер строки (необязательно)</li>
    </ul>
    <h3>Как обновить локально</h3>
    <ol>
      <li>Сохраните Excel как <code>data.xlsx</code> в папку <code>nps-dashboard</code></li>
      <li>Запустите <code>start.bat</code> и обновите страницу (Ctrl+F5)</li>
    </ol>
    <h3>Как обновить на Vercel (через GitHub)</h3>
    <ol>
      <li>На GitHub откройте репозиторий → файл <code>data.xlsx</code></li>
      <li>Нажмите <strong>⋯</strong> → <strong>Delete file</strong> (или <strong>Upload files</strong> и замените файл)</li>
      <li>Загрузите новый <code>data.xlsx</code> → <strong>Commit changes</strong></li>
      <li>Через 1–2 мин обновите дашборд (Ctrl+F5)</li>
    </ol>
    <p>Фильтр «Месяц обзвона» — по последнему столбцу. NPS по возрасту — от даты регистрации до сегодня.</p>
  `;

  document.getElementById("doc-deploy").innerHTML = `
    <p>Самый простой способ — через сайты GitHub и Vercel, без терминала.</p>
    <h3>Шаг 1. Загрузить файлы на GitHub</h3>
    <ol>
      <li>Зайдите на <a href="https://github.com" target="_blank" rel="noopener">github.com</a> и войдите (или зарегистрируйтесь).</li>
      <li>Нажмите <strong>+</strong> → <strong>New repository</strong>.</li>
      <li>Имя, например: <code>nps-dashboard</code>. Можно оставить репозиторий <strong>Public</strong>. Нажмите <strong>Create repository</strong>.</li>
      <li>На странице репозитория: <strong>Add file</strong> → <strong>Upload files</strong>.</li>
      <li>Перетащите файлы проекта, главное:
        <code>index.html</code>, <code>styles.css</code>, <code>app.js</code>, <code>parse-workbook.js</code>, <code>data.xlsx</code>, <code>vercel.json</code>
        (папку <code>src</code> и <code>data.json</code> не нужны).</li>
      <li>Внизу нажмите <strong>Commit changes</strong>.</li>
    </ol>
    <h3>Шаг 2. Подключить Vercel</h3>
    <ol>
      <li>Зайдите на <a href="https://vercel.com" target="_blank" rel="noopener">vercel.com</a> → <strong>Sign Up</strong> → войдите через <strong>GitHub</strong>.</li>
      <li><strong>Add New…</strong> → <strong>Project</strong> → выберите репозиторий <code>nps-dashboard</code> → <strong>Import</strong>.</li>
      <li>На экране настроек:
        <ul>
          <li><strong>Framework Preset</strong> — <strong>Other</strong></li>
          <li><strong>Build Command</strong> — удалите всё, оставьте пустым</li>
          <li><strong>Output Directory</strong> — точка <code>.</code> или пусто</li>
        </ul>
      </li>
      <li>Нажмите <strong>Deploy</strong>. Подождите 1–2 минуты.</li>
      <li>Готово: Vercel покажет ссылку вида <code>https://ваш-проект.vercel.app</code> — это адрес дашборда.</li>
    </ol>
    <h3>Как обновить данные после деплоя</h3>
    <ol>
      <li>На GitHub замените файл <code>data.xlsx</code> на новый (Upload files → перетащить → Commit).</li>
      <li>Обновите страницу дашборда (Ctrl+F5).</li>
    </ol>
    <h3>Если что-то не работает</h3>
    <ul>
      <li>На Vercel в проекте → <strong>Settings</strong> → <strong>General</strong> — Build Command должен быть пустым.</li>
      <li>В репозитории в корне должны лежать <code>index.html</code> и <code>data.xlsx</code>, не в подпапке.</li>
      <li>Файл должен называться именно <code>data.xlsx</code> (латиница, без пробелов).</li>
      <li>Дашборд по ссылке Vercel открывается без пароля — не публикуйте ссылку, если она только для команды.</li>
    </ul>
  `;
}

const DATA_XLSX = "data.xlsx";

async function loadFromXlsx() {
  const res = await fetch(DATA_XLSX + "?" + Date.now());
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  return parseNpsWorkbook(wb, DATA_XLSX);
}

async function loadFromJson() {
  const res = await fetch("data.json?" + Date.now());
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data.responses)) return null;
  return data;
}

function applyData(data) {
  rawData = data;
  rawData.responses = (rawData.responses || []).map((r) => normalizeLegacyItem({ ...r }));
  rawData.calls = (rawData.calls || []).map((c) => normalizeLegacyItem({ ...c }));
  const meta = rawData.meta || {};
  const updated = meta.updatedAt
    ? `Обновлено: ${meta.updatedAt}${meta.source ? " · " + meta.source : ""}`
    : "Данные загружены";
  document.getElementById("data-updated").textContent = updated;
  populateMonthFilter(rawData.responses, rawData.calls);
  render();
}

async function loadData() {
  try {
    let data = await loadFromXlsx();
    if (!data) data = await loadFromJson();
    if (!data) throw new Error("no data");
    applyData(data);
  } catch (err) {
    console.error(err);
    document.getElementById("app").classList.add("hidden");
    document.getElementById("load-error").classList.remove("hidden");
  }
}

function setupFilters() {
  document.getElementById("filter-month").addEventListener("change", render);
  document.getElementById("filter-type").addEventListener("change", render);
  document.getElementById("reset-filters").addEventListener("click", () => {
    document.getElementById("filter-month").value = "all";
    document.getElementById("filter-type").value = "all";
    render();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupFilters();
  injectDocs();
  loadData();
});
