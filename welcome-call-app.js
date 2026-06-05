let rawRows = [];
let monthCatalog = new Map();

const DATA_XLSX = "welcome-call.xlsx";
const PAGE_SIZE = 10;
const SUMMARY_TOP = 5;
const COMMENT_FEW_THRESHOLD = 12;

const charts = {};
const pagination = {
  connection: { page: 1, search: "" },
  manager: { page: 1, search: "" },
  nps: { page: 1, search: "" },
};

const STOP_WORDS = new Set([
  "и", "в", "во", "не", "что", "он", "на", "я", "с", "со", "как", "а", "то", "все", "она",
  "так", "его", "но", "да", "ты", "к", "у", "же", "вы", "за", "бы", "по", "ее", "мне",
  "было", "для", "мы", "про", "это", "от", "из", "или", "до", "при", "очень", "есть",
  "тоже", "ещё", "еще", "без", "ни", "нам", "вас", "них", "чем", "где", "когда",
]);

const GRID_COLOR = "rgba(139, 156, 179, 0.15)";
const TEXT_COLOR = "#8b9cb3";

const ZERO_SCALE = {
  beginAtZero: true,
  min: 0,
  grid: { color: GRID_COLOR },
  ticks: { color: TEXT_COLOR },
};

function pct(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function pctNum(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function isYes(val) {
  return normAnswer(val) === "да";
}

function normAnswer(val) {
  return String(val ?? "").trim().toLowerCase();
}

function hasMeaningfulComment(text) {
  const c = String(text ?? "").trim();
  return c && c !== "—" && c !== "-";
}

function parseManagerScore(val) {
  if (val == null || val === "") return null;
  const n = Number(val);
  if (Number.isFinite(n)) return n;
  const s = String(val).trim();
  const m = s.match(/^(\d+(?:[.,]\d+)?)/);
  if (m) return Number(m[1].replace(",", "."));
  return null;
}

function detectManagerScale(scores) {
  const nums = scores.filter((s) => s != null);
  if (!nums.length) return null;
  const max = Math.max(...nums);
  if (max <= 5) return 5;
  return 10;
}

function managerSentiment(score, scale) {
  if (score == null) return null;
  if (scale === 5) {
    if (score >= 4) return "positive";
    if (score === 3) return "neutral";
    return "negative";
  }
  if (score >= 9) return "positive";
  if (score >= 7) return "neutral";
  return "negative";
}

function getNpsType(score) {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

const NPS_TYPE_LABELS = {
  promoter: "Промоутер",
  passive: "Нейтрал",
  detractor: "Критик",
};

function calcNps(scores) {
  if (!scores.length) return null;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
}

function parseNpsScore(val) {
  if (val == null || val === "") return null;
  const n = Number(val);
  if (Number.isFinite(n) && n >= 0 && n <= 10) return Math.round(n);
  const m = String(val).trim().match(/^(\d+)/);
  if (m) {
    const x = Number(m[1]);
    if (x >= 0 && x <= 10) return x;
  }
  return null;
}

function isReached(status) {
  return normAnswer(status) === "дозвон";
}

function hasAnyRating(row) {
  return (
    isFilled(row.connectionRating) ||
    isFilled(row.managerRatingStr) ||
    isFilled(row.npsRatingStr) ||
    parseNpsScore(row.npsRating) != null ||
    parseManagerScore(row.managerRating) != null
  );
}

function getFilterState() {
  const period = document.getElementById("filter-period")?.value || "all";
  const month = document.getElementById("filter-month")?.value || "";
  return { period, month, isAll: period === "all" };
}

function filterRows(rows) {
  const { period, month } = getFilterState();
  if (period === "all") return rows;
  return rows.filter((r) => r.monthKey === month);
}

function monthLabel(key) {
  if (!key) return "—";
  return monthCatalog.get(key) || formatMonthKeyLabel(key);
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    charts[id] = null;
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setStatus(text, isError) {
  const el = document.getElementById("data-updated");
  if (el) {
    el.textContent = text;
    el.classList.toggle("status-error", !!isError);
  }
}

function populateFilters(rows) {
  const periodSelect = document.getElementById("filter-period");
  const monthSelect = document.getElementById("filter-month");
  if (!monthSelect) return;

  const keys = sortMonthKeys([...new Set(rows.map((r) => r.monthKey).filter(Boolean))]);
  monthSelect.innerHTML = "";
  keys.forEach((k) => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = monthLabel(k);
    monthSelect.appendChild(opt);
  });

  if (keys.length && !monthSelect.value) {
    monthSelect.value = keys[keys.length - 1];
  }

  const toggleMonth = () => {
    const isAll = periodSelect?.value === "all";
    monthSelect.disabled = isAll;
    monthSelect.closest(".filter-group")?.classList.toggle("filter-disabled", isAll);
  };

  if (periodSelect && !periodSelect.dataset.bound) {
    periodSelect.dataset.bound = "1";
    periodSelect.addEventListener("change", () => {
      toggleMonth();
      render(true);
    });
  }

  toggleMonth();
}

/* ── Comment summary helpers ── */

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

function topPhrases(comments, limit = 12) {
  const map = new Map();
  comments.forEach((text) => {
    const tokens = tokenize(text);
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const phrase = tokens.slice(i, i + n).join(" ");
        if (phrase.length < 6) continue;
        map.set(phrase, (map.get(phrase) ?? 0) + 1);
      }
    }
  });
  return [...map.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([phrase, count]) => ({ phrase, count }));
}

function buildCommentSummary(items, kind) {
  const withComment = items.filter((x) => hasMeaningfulComment(x.comment));
  if (!withComment.length) return [];

  if (withComment.length <= COMMENT_FEW_THRESHOLD) {
    return withComment.slice(0, SUMMARY_TOP).map((x) => ({
      label: null,
      text: x.comment,
      month: x.monthLabel || monthLabel(x.monthKey),
      score: x.scoreLabel,
      count: 1,
    }));
  }

  const phrases = topPhrases(withComment.map((x) => x.comment));
  const used = new Set();
  const groups = [];

  for (const { phrase, count } of phrases) {
    const matched = withComment.filter((x) => {
      const key = x.rowIndex;
      if (used.has(key)) return false;
      if (x.comment.toLowerCase().includes(phrase)) {
        used.add(key);
        return true;
      }
      return false;
    });
    if (matched.length >= 1) {
      groups.push({
        label: phrase,
        text: matched[0].comment,
        month: matched[0].monthLabel || monthLabel(matched[0].monthKey),
        score: matched[0].scoreLabel,
        count: matched.length >= 2 ? matched.length : count,
      });
    }
    if (groups.length >= SUMMARY_TOP) break;
  }

  if (groups.length < SUMMARY_TOP) {
    for (const x of withComment) {
      if (used.has(x.rowIndex)) continue;
      groups.push({
        label: null,
        text: x.comment,
        month: x.monthLabel || monthLabel(x.monthKey),
        score: x.scoreLabel,
        count: 1,
      });
      if (groups.length >= SUMMARY_TOP) break;
    }
  }

  return groups.slice(0, SUMMARY_TOP);
}

function renderSummaryList(listId, emptyId, items) {
  const list = document.getElementById(listId);
  const empty = document.getElementById(emptyId);
  if (!list) return;

  if (!items.length) {
    list.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");

  list.innerHTML = items
    .map((item) => {
      const title = item.label
        ? `<strong>${escapeHtml(item.label)}</strong> (${item.count})`
        : escapeHtml(item.text);
      const sub = item.label ? `<p class="summary-item-text">${escapeHtml(item.text)}</p>` : "";
      return `
        <li class="summary-item">
          <div class="summary-item-meta">
            ${item.score ? `<span class="score-pill score-pill-sm">${escapeHtml(String(item.score))}</span>` : ""}
            <span class="summary-item-month">${escapeHtml(item.month)}</span>
          </div>
          <p class="summary-item-text">${title}</p>
          ${sub}
        </li>`;
    })
    .join("");
}

function renderCommentTable(config) {
  const {
    rows,
    tableId,
    emptyId,
    countId,
    paginationId,
    pageInfoId,
    prevId,
    nextId,
    searchId,
    pageKey,
    columns,
  } = config;

  const state = pagination[pageKey];
  const search = (document.getElementById(searchId)?.value || state.search || "").trim().toLowerCase();

  let filtered = rows.filter((r) => hasMeaningfulComment(r.comment));
  if (search) {
    filtered = filtered.filter((r) => r.comment.toLowerCase().includes(search));
  }

  filtered.sort((a, b) => (b.monthSort || 0) - (a.monthSort || 0));

  const tbody = document.getElementById(tableId);
  const empty = document.getElementById(emptyId);
  const countEl = document.getElementById(countId);
  const pagEl = document.getElementById(paginationId);
  const pageInfo = document.getElementById(pageInfoId);
  const prevBtn = document.getElementById(prevId);
  const nextBtn = document.getElementById(nextId);

  if (countEl) countEl.textContent = `${filtered.length} записей`;
  if (!tbody) return;

  tbody.innerHTML = "";
  if (!filtered.length) {
    empty?.classList.remove("hidden");
    pagEl?.classList.add("hidden");
    return;
  }
  empty?.classList.add("hidden");

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  if (state.page < 1) state.page = 1;

  const start = (state.page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  pageItems.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = columns(r);
    tbody.appendChild(tr);
  });

  if (pagEl && pageInfo && prevBtn && nextBtn) {
    if (totalPages <= 1) {
      pagEl.classList.add("hidden");
    } else {
      pagEl.classList.remove("hidden");
      pageInfo.textContent = `Страница ${state.page} из ${totalPages} · ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} из ${filtered.length}`;
      prevBtn.disabled = state.page <= 1;
      nextBtn.disabled = state.page >= totalPages;
    }
  }
}

/* ── Block 1: Connection ── */

function renderConnectionBlock(rows, isAll) {
  const rated = rows.filter((r) => isFilled(r.connectionRating));
  const total = rated.length;
  const yesCount = rated.filter((r) => isYes(r.connectionRating)).length;
  const otherCount = total - yesCount;

  setText("conn-total", total);
  setText("conn-yes", yesCount);
  setText("conn-yes-pct", pct(yesCount, total));
  setText("conn-other", otherCount);
  setText("conn-other-pct", pct(otherCount, total));

  destroyChart("chart-conn-dist");
  charts["chart-conn-dist"] = new Chart(document.getElementById("chart-conn-dist"), {
    type: "bar",
    data: {
      labels: ["Да", "Остальные ответы"],
      datasets: [{
        label: "Количество",
        data: [yesCount, otherCount],
        backgroundColor: ["rgba(34, 197, 94, 0.75)", "rgba(239, 68, 68, 0.75)"],
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { ...ZERO_SCALE }, x: { grid: { display: false }, ticks: { color: TEXT_COLOR } } },
    },
  });

  const monthlyPanel = document.getElementById("conn-monthly-panel");
  if (monthlyPanel) monthlyPanel.classList.toggle("hidden", !isAll);

  if (isAll) {
    const months = sortMonthKeys([...new Set(rows.map((r) => r.monthKey).filter(Boolean))]);
    const labels = months.map((m) => monthLabel(m));
    const values = months.map((m) => {
      const monthRated = rows.filter((r) => r.monthKey === m && isFilled(r.connectionRating));
      const yes = monthRated.filter((r) => isYes(r.connectionRating)).length;
      return pctNum(yes, monthRated.length);
    });

    destroyChart("chart-conn-monthly");
    charts["chart-conn-monthly"] = new Chart(document.getElementById("chart-conn-monthly"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "% «Да»",
          data: values,
          backgroundColor: "rgba(59, 130, 246, 0.8)",
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y}%` } },
        },
        scales: {
          y: { ...ZERO_SCALE, max: 100, ticks: { ...ZERO_SCALE.ticks, callback: (v) => v + "%" } },
          x: { grid: { display: false }, ticks: { color: TEXT_COLOR } },
        },
      },
    });
  }

  const commentItems = rows
    .filter((r) => hasMeaningfulComment(r.connectionComment))
    .map((r) => ({
      rowIndex: r.rowIndex,
      comment: r.connectionComment,
      monthKey: r.monthKey,
      monthLabel: r.monthLabel,
      scoreLabel: r.connectionRating || "—",
      isPositive: isYes(r.connectionRating),
    }));

  const positive = buildCommentSummary(commentItems.filter((x) => x.isPositive), "positive");
  const negative = buildCommentSummary(commentItems.filter((x) => !x.isPositive), "negative");

  renderSummaryList("conn-summary-positive", "conn-summary-positive-empty", positive);
  renderSummaryList("conn-summary-negative", "conn-summary-negative-empty", negative);

  renderCommentTable({
    rows: commentItems.map((x) => ({ ...x, comment: x.comment })),
    tableId: "conn-comments-tbody",
    emptyId: "conn-comments-empty",
    countId: "conn-comments-count",
    paginationId: "conn-pagination",
    pageInfoId: "conn-page-info",
    prevId: "conn-prev",
    nextId: "conn-next",
    searchId: "conn-search",
    pageKey: "connection",
    columns: (r) => `
      <td>${escapeHtml(r.monthLabel || monthLabel(r.monthKey))}</td>
      <td>${escapeHtml(String(r.scoreLabel))}</td>
      <td class="comment-cell">${escapeHtml(r.comment)}</td>`,
  });
}

/* ── Block 2: Manager ── */

function renderManagerBlock(rows, isAll) {
  const numericRows = [];
  const textMap = new Map();

  rows.forEach((r) => {
    if (!isFilled(r.managerRatingStr) && r.managerRating == null) return;
    const num = parseManagerScore(r.managerRating);
    if (num != null) {
      numericRows.push({ ...r, score: num });
    } else {
      const key = r.managerRatingStr || String(r.managerRating);
      textMap.set(key, (textMap.get(key) || 0) + 1);
    }
  });

  const isNumeric = numericRows.length > 0;
  const total = isNumeric ? numericRows.length : [...textMap.values()].reduce((a, b) => a + b, 0);

  setText("mgr-total", total);

  const kpiGrid = document.getElementById("mgr-kpi-breakdown");
  if (kpiGrid) {
    kpiGrid.innerHTML = "";
    if (isNumeric) {
      const scores = numericRows.map((r) => r.score);
      const scale = detectManagerScale(scores);
      const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "—";
      setText("mgr-avg", avg);

      const dist = new Map();
      scores.forEach((s) => dist.set(s, (dist.get(s) || 0) + 1));
      const sortedKeys = [...dist.keys()].sort((a, b) => b - a);

      sortedKeys.forEach((score) => {
        const count = dist.get(score);
        const card = document.createElement("article");
        card.className = "kpi-card";
        card.innerHTML = `
          <span class="kpi-label">Оценка ${score}</span>
          <span class="kpi-value">${count}</span>
          <span class="kpi-pct">${pct(count, total)}</span>`;
        kpiGrid.appendChild(card);
      });

      const sent = { positive: 0, neutral: 0, negative: 0 };
      scores.forEach((s) => {
        const t = managerSentiment(s, scale);
        if (t) sent[t]++;
      });

      ["positive", "neutral", "negative"].forEach((t) => {
        const labels = { positive: "Позитивные", neutral: "Нейтральные", negative: "Негативные" };
        const card = document.createElement("article");
        card.className = `kpi-card kpi-${t === "positive" ? "promoter" : t === "neutral" ? "passive" : "detractor"}`;
        card.innerHTML = `
          <span class="kpi-label">${labels[t]}</span>
          <span class="kpi-value">${sent[t]}</span>
          <span class="kpi-pct">${pct(sent[t], total)}</span>`;
        kpiGrid.appendChild(card);
      });

      destroyChart("chart-mgr-dist");
      charts["chart-mgr-dist"] = new Chart(document.getElementById("chart-mgr-dist"), {
        type: "bar",
        data: {
          labels: sortedKeys.map(String),
          datasets: [{
            label: "Количество",
            data: sortedKeys.map((k) => dist.get(k)),
            backgroundColor: sortedKeys.map((s) => {
              const t = managerSentiment(s, scale);
              if (t === "positive") return "rgba(34, 197, 94, 0.75)";
              if (t === "neutral") return "rgba(234, 179, 8, 0.75)";
              return "rgba(239, 68, 68, 0.75)";
            }),
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { ...ZERO_SCALE }, x: { grid: { display: false }, ticks: { color: TEXT_COLOR } } },
        },
      });
    } else {
      setText("mgr-avg", "—");
      [...textMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .forEach(([label, count]) => {
          const card = document.createElement("article");
          card.className = "kpi-card";
          card.innerHTML = `
            <span class="kpi-label">${escapeHtml(label)}</span>
            <span class="kpi-value">${count}</span>
            <span class="kpi-pct">${pct(count, total)}</span>`;
          kpiGrid.appendChild(card);
        });

      const labels = [...textMap.keys()];
      destroyChart("chart-mgr-dist");
      charts["chart-mgr-dist"] = new Chart(document.getElementById("chart-mgr-dist"), {
        type: "bar",
        data: {
          labels,
          datasets: [{
            label: "Количество",
            data: labels.map((l) => textMap.get(l)),
            backgroundColor: "rgba(59, 130, 246, 0.75)",
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { ...ZERO_SCALE }, x: { grid: { display: false }, ticks: { color: TEXT_COLOR, maxRotation: 45 } } },
        },
      });
    }
  }

  const monthlyPanel = document.getElementById("mgr-monthly-panel");
  if (monthlyPanel) monthlyPanel.classList.toggle("hidden", !isAll || !isNumeric);

  if (isAll && isNumeric) {
    const months = sortMonthKeys([...new Set(numericRows.map((r) => r.monthKey).filter(Boolean))]);
    const labels = months.map((m) => monthLabel(m));
    const values = months.map((m) => {
      const ms = numericRows.filter((r) => r.monthKey === m).map((r) => r.score);
      return ms.length ? Number((ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2)) : 0;
    });

    destroyChart("chart-mgr-monthly");
    charts["chart-mgr-monthly"] = new Chart(document.getElementById("chart-mgr-monthly"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Средняя оценка",
          data: values,
          backgroundColor: "rgba(167, 139, 250, 0.75)",
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { ...ZERO_SCALE }, x: { grid: { display: false }, ticks: { color: TEXT_COLOR } } },
      },
    });
  }

  const scale = isNumeric ? detectManagerScale(numericRows.map((r) => r.score)) : null;
  const commentItems = rows
    .filter((r) => hasMeaningfulComment(r.managerComment) && (isFilled(r.managerRatingStr) || r.managerRating != null))
    .map((r) => {
      const score = parseManagerScore(r.managerRating);
      const sentiment = score != null && scale ? managerSentiment(score, scale) : null;
      return {
        rowIndex: r.rowIndex,
        comment: r.managerComment,
        monthKey: r.monthKey,
        monthLabel: r.monthLabel,
        scoreLabel: r.managerRatingStr || score,
        isPositive: sentiment === "positive",
        isNegative: sentiment === "negative",
      };
    });

  const positive = buildCommentSummary(commentItems.filter((x) => x.isPositive), "positive");
  const negative = buildCommentSummary(commentItems.filter((x) => x.isNegative), "negative");

  renderSummaryList("mgr-summary-positive", "mgr-summary-positive-empty", positive);
  renderSummaryList("mgr-summary-negative", "mgr-summary-negative-empty", negative);

  renderCommentTable({
    rows: commentItems,
    tableId: "mgr-comments-tbody",
    emptyId: "mgr-comments-empty",
    countId: "mgr-comments-count",
    paginationId: "mgr-pagination",
    pageInfoId: "mgr-page-info",
    prevId: "mgr-prev",
    nextId: "mgr-next",
    searchId: "mgr-search",
    pageKey: "manager",
    columns: (r) => `
      <td>${escapeHtml(r.monthLabel || monthLabel(r.monthKey))}</td>
      <td>${escapeHtml(String(r.scoreLabel ?? "—"))}</td>
      <td class="comment-cell">${escapeHtml(r.comment)}</td>`,
  });
}

/* ── Block 3: NPS ── */

function renderNpsBlock(rows, isAll) {
  const scored = rows
    .map((r) => ({ ...r, score: parseNpsScore(r.npsRating) }))
    .filter((r) => r.score != null);

  const total = scored.length;
  const promoters = scored.filter((r) => r.score >= 9).length;
  const passives = scored.filter((r) => r.score >= 7 && r.score <= 8).length;
  const detractors = scored.filter((r) => r.score <= 6).length;
  const nps = calcNps(scored.map((r) => r.score));

  const npsEl = document.getElementById("wc-kpi-nps");
  if (npsEl) {
    if (nps == null) {
      npsEl.textContent = "—";
      npsEl.className = "kpi-value";
    } else {
      npsEl.textContent = (nps > 0 ? "+" : "") + nps;
      npsEl.className = "kpi-value " + (nps >= 0 ? "positive" : "negative");
    }
  }

  setText("wc-nps-total", total);
  setText("wc-nps-promoters", promoters);
  setText("wc-nps-promoters-pct", pct(promoters, total));
  setText("wc-nps-passives", passives);
  setText("wc-nps-passives-pct", pct(passives, total));
  setText("wc-nps-detractors", detractors);
  setText("wc-nps-detractors-pct", pct(detractors, total));

  const dist = Array(11).fill(0);
  scored.forEach((r) => { dist[r.score]++; });

  destroyChart("chart-wc-nps-dist");
  charts["chart-wc-nps-dist"] = new Chart(document.getElementById("chart-wc-nps-dist"), {
    type: "bar",
    data: {
      labels: dist.map((_, i) => String(i)),
      datasets: [{
        label: "Ответов",
        data: dist,
        backgroundColor: dist.map((_, i) => {
          if (i >= 9) return "rgba(34, 197, 94, 0.75)";
          if (i >= 7) return "rgba(234, 179, 8, 0.75)";
          return "rgba(239, 68, 68, 0.75)";
        }),
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { ...ZERO_SCALE },
        x: { title: { display: true, text: "Оценка", color: TEXT_COLOR }, grid: { display: false }, ticks: { color: TEXT_COLOR } },
      },
    },
  });

  const monthlyPanel = document.getElementById("wc-nps-monthly-panel");
  if (monthlyPanel) monthlyPanel.classList.toggle("hidden", !isAll);

  if (isAll) {
    const months = sortMonthKeys([...new Set(scored.map((r) => r.monthKey).filter(Boolean))]);
    const labels = months.map((m) => monthLabel(m));
    const realValues = months.map((m) => {
      const ms = scored.filter((r) => r.monthKey === m).map((r) => r.score);
      return calcNps(ms);
    });

    destroyChart("chart-wc-nps-monthly");
    charts["chart-wc-nps-monthly"] = new Chart(document.getElementById("chart-wc-nps-monthly"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "NPS",
          data: realValues.map((v) => (v == null ? 0 : Math.max(0, v))),
          backgroundColor: realValues.map((v) =>
            v == null ? "rgba(139, 156, 179, 0.35)" : "rgba(59, 130, 246, 0.8)",
          ),
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const real = realValues[ctx.dataIndex];
                if (real == null) return "Нет данных";
                return `NPS: ${real > 0 ? "+" : ""}${real}`;
              },
            },
          },
        },
        scales: {
          y: { ...ZERO_SCALE, max: 100 },
          x: { grid: { display: false }, ticks: { color: TEXT_COLOR } },
        },
      },
    });
  }

  const commentItems = rows
    .filter((r) => hasMeaningfulComment(r.npsComment))
    .map((r) => {
      const score = parseNpsScore(r.npsRating);
      const type = getNpsType(score);
      return {
        rowIndex: r.rowIndex,
        comment: r.npsComment,
        monthKey: r.monthKey,
        monthLabel: r.monthLabel,
        score,
        type,
        scoreLabel: score != null ? score : "—",
        typeLabel: type ? NPS_TYPE_LABELS[type] : "—",
        isPositive: type === "promoter",
        isNegative: type === "detractor",
      };
    })
    .filter((r) => r.score != null);

  renderSummaryList(
    "wc-nps-summary-positive",
    "wc-nps-summary-positive-empty",
    buildCommentSummary(commentItems.filter((x) => x.isPositive), "positive"),
  );
  renderSummaryList(
    "wc-nps-summary-negative",
    "wc-nps-summary-negative-empty",
    buildCommentSummary(commentItems.filter((x) => x.isNegative), "negative"),
  );

  renderCommentTable({
    rows: commentItems,
    tableId: "wc-nps-comments-tbody",
    emptyId: "wc-nps-comments-empty",
    countId: "wc-nps-comments-count",
    paginationId: "wc-nps-pagination",
    pageInfoId: "wc-nps-page-info",
    prevId: "wc-nps-prev",
    nextId: "wc-nps-next",
    searchId: "wc-nps-search",
    pageKey: "nps",
    columns: (r) => `
      <td>${escapeHtml(r.monthLabel || monthLabel(r.monthKey))}</td>
      <td><span class="score-pill">${r.score}</span></td>
      <td><span class="badge badge-${r.type}">${escapeHtml(r.typeLabel)}</span></td>
      <td class="comment-cell">${escapeHtml(r.comment)}</td>`,
  });
}

/* ── Block 4: Calls ── */

function calcCallMetrics(rows) {
  const totalCalls = rows.reduce((s, r) => s + r.callCount, 0);
  const reachedCalls = rows.filter((r) => isReached(r.callStatus)).reduce((s, r) => s + r.callCount, 0);
  const ratedCalls = rows.filter((r) => hasAnyRating(r)).reduce((s, r) => s + r.callCount, 0);

  return {
    totalCalls,
    reachedCalls,
    ratedCalls,
    reachedRate: pctNum(reachedCalls, totalCalls),
    ratedRateFromTotal: pctNum(ratedCalls, totalCalls),
    ratedRateFromReached: pctNum(ratedCalls, reachedCalls),
  };
}

function renderCallsBlock(rows, isAll) {
  const m = calcCallMetrics(rows);

  setText("calls-total", m.totalCalls);
  setText("calls-reached", m.reachedCalls);
  setText("calls-reached-pct", `${pct(m.reachedCalls, m.totalCalls)} от всех звонков`);
  setText("calls-rated", m.ratedCalls);
  setText("calls-rated-pct-total", `${pct(m.ratedCalls, m.totalCalls)} от всех звонков`);
  setText("calls-rated-pct-reached", `${pct(m.ratedCalls, m.reachedCalls)} от дозвонов`);

  destroyChart("chart-calls-funnel");
  charts["chart-calls-funnel"] = new Chart(document.getElementById("chart-calls-funnel"), {
    type: "bar",
    data: {
      labels: ["Всего звонков", "Дозвонились", "Получили оценку"],
      datasets: [{
        label: "Количество",
        data: [m.totalCalls, m.reachedCalls, m.ratedCalls],
        backgroundColor: [
          "rgba(59, 130, 246, 0.75)",
          "rgba(167, 139, 250, 0.75)",
          "rgba(34, 197, 94, 0.75)",
        ],
        borderRadius: 6,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ...ZERO_SCALE },
        y: { grid: { display: false }, ticks: { color: TEXT_COLOR } },
      },
    },
  });

  const tbody = document.getElementById("calls-monthly-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const months = isAll
    ? sortMonthKeys([...new Set(rows.map((r) => r.monthKey).filter(Boolean))])
    : sortMonthKeys([...new Set(rows.map((r) => r.monthKey).filter(Boolean))]);

  months.forEach((monthKey) => {
    const monthRows = rows.filter((r) => r.monthKey === monthKey);
    const cm = calcCallMetrics(monthRows);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(monthLabel(monthKey))}</td>
      <td>${cm.totalCalls}</td>
      <td>${cm.reachedCalls}</td>
      <td>${cm.reachedRate}%</td>
      <td>${cm.ratedCalls}</td>
      <td>${cm.ratedRateFromReached}%</td>`;
    tbody.appendChild(tr);
  });

  if (!months.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Нет данных по месяцам</td></tr>`;
  }
}

/* ── Main render ── */

function render(resetPages = false) {
  if (!rawRows.length) return;

  if (resetPages) {
    pagination.connection.page = 1;
    pagination.manager.page = 1;
    pagination.nps.page = 1;
  }

  const { isAll } = getFilterState();
  const rows = filterRows(rawRows);

  renderConnectionBlock(rows, isAll);
  renderManagerBlock(rows, isAll);
  renderNpsBlock(rows, isAll);
  renderCallsBlock(rows, isAll);
}

async function loadData() {
  setStatus("Загрузка данных…", false);

  try {
    const res = await fetch(DATA_XLSX + "?" + Date.now());
    if (!res.ok) {
      const errBox = document.getElementById("load-error");
      const errText = document.getElementById("load-error-text");
      if (errText) {
        errText.textContent = "Файл welcome-call.xlsx не найден. Загрузите его в репозиторий на GitHub.";
      }
      if (errBox) errBox.classList.remove("hidden");
      setStatus("Не удалось загрузить данные", true);
      return;
    }

    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const data = parseWelcomeCallWorkbook(wb, DATA_XLSX);

    rawRows = data.rows || [];
    monthCatalog = buildMonthCatalog(rawRows);

    const meta = data.meta || {};
    setStatus(
      `Обновлено: ${meta.updatedAt || "—"}${meta.source ? " · " + meta.source : ""} · ${rawRows.length} строк`,
      false,
    );

    const errBox = document.getElementById("load-error");
    if (errBox) errBox.classList.add("hidden");

    if (!rawRows.length) {
      setStatus("Файл загружен, но строк данных не найдено. Проверьте колонки в Excel.", true);
    }

    populateFilters(rawRows);
    render(true);
  } catch (err) {
    console.error(err);
    const errBox = document.getElementById("load-error");
    const errText = document.getElementById("load-error-text");
    if (errText) errText.textContent = err.message || String(err);
    if (errBox) errBox.classList.remove("hidden");
    setStatus("Ошибка: " + (err.message || "неизвестная"), true);
  }
}

function setupPagination(prefix, pageKey) {
  const prev = document.getElementById(`${prefix}-prev`);
  const next = document.getElementById(`${prefix}-next`);
  const search = document.getElementById(`${prefix}-search`);

  if (prev) {
    prev.addEventListener("click", () => {
      if (pagination[pageKey].page > 1) {
        pagination[pageKey].page--;
        render();
      }
    });
  }
  if (next) {
    next.addEventListener("click", () => {
      pagination[pageKey].page++;
      render();
    });
  }
  if (search) {
    search.addEventListener("input", () => {
      pagination[pageKey].page = 1;
      render();
    });
  }
}

function setupFilters() {
  const monthSelect = document.getElementById("filter-month");
  if (monthSelect) {
    monthSelect.addEventListener("change", () => render(true));
  }

  const reset = document.getElementById("reset-filters");
  if (reset) {
    reset.addEventListener("click", () => {
      const period = document.getElementById("filter-period");
      if (period) period.value = "all";
      populateFilters(rawRows);
      render(true);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupFilters();
  setupPagination("conn", "connection");
  setupPagination("mgr", "manager");
  setupPagination("wc-nps", "nps");
  loadData();
});
