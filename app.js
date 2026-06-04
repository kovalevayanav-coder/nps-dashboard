let rawData = null;
let chartMonthly = null;
let chartDistribution = null;

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

function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

function filterResponses(responses, monthFilter, typeFilter) {
  return responses.filter((r) => {
    if (monthFilter !== "all" && monthKey(r.date) !== monthFilter) return false;
    if (typeFilter !== "all" && getScoreType(r.score) !== typeFilter) return false;
    return true;
  });
}

function pct(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function populateMonthFilter(responses) {
  const select = document.getElementById("filter-month");
  const months = [...new Set(responses.map((r) => monthKey(r.date)))].sort().reverse();

  select.innerHTML = '<option value="all">Все месяцы</option>';
  months.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    const [y, mo] = m.split("-");
    const labelDate = new Date(Number(y), Number(mo) - 1, 1);
    opt.textContent = labelDate.toLocaleDateString("ru-RU", { year: "numeric", month: "long" });
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
  const months = [...new Set(allResponses.map((r) => monthKey(r.date)))].sort();
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
    const monthResponses = allResponses.filter((r) => monthKey(r.date) === m);
    return calcNps(monthResponses) ?? 0;
  });

  return { labels, values };
}

function buildDistribution(responses) {
  const counts = Array(11).fill(0);
  responses.forEach((r) => {
    if (r.score >= 0 && r.score <= 10) counts[r.score]++;
  });
  return counts;
}

function updateCharts(responses, allResponses, monthFilter) {
  const monthly = buildMonthlyNps(allResponses, monthFilter);
  const dist = buildDistribution(responses);

  if (chartMonthly) chartMonthly.destroy();
  if (chartDistribution) chartDistribution.destroy();

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

  const sorted = [...responses].sort((a, b) => b.date.localeCompare(a.date));

  sorted.forEach((r) => {
    const type = getScoreType(r.score);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(r.date)}</td>
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

  updateKpis(filtered);
  updateCharts(filtered, rawData.responses, monthFilter);
  renderTable(filtered);
}

function injectDocs() {
  document.getElementById("doc-local").innerHTML = `
    <p>Дашборд нельзя открыть как обычный файл — браузер не загрузит <code>data.json</code>. Нужен простой локальный сервер.</p>
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
    <h3>Формат файла</h3>
    <p>Данные лежат в <code>data.json</code> в корне проекта. Структура:</p>
    <pre>{
  "meta": {
    "updatedAt": "2026-06-01",
    "source": "Описание источника"
  },
  "responses": [
    {
      "id": "уникальный-id",
      "date": "2026-05-15",
      "score": 9,
      "comment": "Текст отзыва без персональных данных"
    }
  ]
}</pre>
    <h3>Правила</h3>
    <ul>
      <li><code>score</code> — целое число от 0 до 10</li>
      <li><code>date</code> — формат <code>YYYY-MM-DD</code></li>
      <li>Не добавляйте имена, email, телефоны — только деперсонализированные комментарии</li>
      <li>NPS считается автоматически: промоутеры 9–10, нейтралы 7–8, критики 0–6</li>
    </ul>
    <h3>Как обновить</h3>
    <ol>
      <li>Откройте <code>data.json</code> в редакторе</li>
      <li>Добавьте или измените объекты в массиве <code>responses</code></li>
      <li>Обновите <code>meta.updatedAt</code></li>
      <li>Сохраните файл и задеплойте заново (или дождитесь автодеплоя на Vercel)</li>
      <li>Обновите страницу дашборда в браузере (Ctrl+F5)</li>
    </ol>
  `;

  document.getElementById("doc-deploy").innerHTML = `
    <p>Самый простой способ — через сайты GitHub и Vercel, без терминала.</p>
    <h3>Шаг 1. Загрузить файлы на GitHub</h3>
    <ol>
      <li>Зайдите на <a href="https://github.com" target="_blank" rel="noopener">github.com</a> и войдите (или зарегистрируйтесь).</li>
      <li>Нажмите <strong>+</strong> → <strong>New repository</strong>.</li>
      <li>Имя, например: <code>nps-dashboard</code>. Можно оставить репозиторий <strong>Public</strong>. Нажмите <strong>Create repository</strong>.</li>
      <li>На странице репозитория: <strong>Add file</strong> → <strong>Upload files</strong>.</li>
      <li>Перетащите из папки проекта на компьютере эти файлы:
        <code>index.html</code>, <code>styles.css</code>, <code>app.js</code>, <code>data.json</code>, <code>vercel.json</code>
        (папку <code>src</code> загружать не нужно).</li>
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
      <li>На GitHub откройте файл <code>data.json</code> → иконка карандаша <strong>Edit</strong>.</li>
      <li>Измените ответы, сохраните (<strong>Commit changes</strong>).</li>
      <li>Vercel сам пересоберёт сайт (обычно 1–2 мин). Обновите страницу дашборда (Ctrl+F5).</li>
    </ol>
    <h3>Если что-то не работает</h3>
    <ul>
      <li>На Vercel в проекте → <strong>Settings</strong> → <strong>General</strong> — Build Command должен быть пустым.</li>
      <li>В репозитории в корне должны лежать <code>index.html</code> и <code>data.json</code>, не в подпапке.</li>
      <li>Дашборд по ссылке Vercel открывается без пароля — не публикуйте ссылку, если она только для команды.</li>
    </ul>
  `;
}

async function loadData() {
  try {
    const res = await fetch("data.json?" + Date.now());
    if (!res.ok) throw new Error("fetch failed");
    rawData = await res.json();

    if (!Array.isArray(rawData.responses)) {
      throw new Error("invalid schema");
    }

    const meta = rawData.meta || {};
    const updated = meta.updatedAt
      ? `Обновлено: ${meta.updatedAt}${meta.source ? " · " + meta.source : ""}`
      : "Данные загружены";
    document.getElementById("data-updated").textContent = updated;

    populateMonthFilter(rawData.responses);
    render();
  } catch {
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
