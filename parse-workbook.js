/**
 * Парсинг Excel-книги NPS → { meta, calls, responses }
 */
const AGE_COHORTS = [
  { key: "0-3", label: "До 3 мес. вкл." },
  { key: "3-6", label: "3–6 мес." },
  { key: "6-12", label: "6 мес. – 1 год" },
  { key: "12+", label: "От 1 года" },
];

const MONTH_ABBR = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTH_FULL = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

const RU_MONTH_STEMS = [
  ["янв", 1], ["фев", 2], ["мар", 3], ["апр", 4], ["май", 5], ["мая", 5],
  ["июн", 6], ["июл", 7], ["авг", 8], ["сен", 9], ["окт", 10], ["ноя", 11], ["дек", 12],
  ["январ", 1], ["феврал", 2], ["март", 3], ["апрел", 4],
  ["июл", 7], ["август", 8], ["сентябр", 9], ["октябр", 10], ["ноябр", 11], ["декабр", 12],
];

function normHeader(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, " ");
}

function findCol(headers, candidates) {
  const lowered = headers.map(normHeader);
  for (const c of candidates) {
    const cc = normHeader(c);
    const idx = lowered.findIndex((h) => h === cc || h.includes(cc) || cc.includes(h));
    if (idx >= 0) return idx;
  }
  return -1;
}

function lastHeaderColIndex(headers) {
  for (let i = headers.length - 1; i >= 0; i--) {
    if (String(headers[i] ?? "").trim()) return i;
  }
  return -1;
}

function excelSerialToDate(serial) {
  if (!Number.isFinite(serial)) return null;
  const utc = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(utc);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === "number") {
    const d = excelSerialToDate(v);
    if (d) return d;
  }
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseScore(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").trim());
  if (Number.isNaN(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 0 || rounded > 10) return null;
  return rounded;
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toMonthKey(y, m) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function expandYear(y) {
  const n = Number(y);
  if (n >= 100) return n;
  return 2000 + n;
}

function buildMonthLabel(monthNum, year, raw) {
  const abbr = MONTH_ABBR[monthNum - 1];
  const full = MONTH_FULL[monthNum - 1];
  const yy = String(year).slice(-2);
  const rawN = String(raw).trim().toLowerCase().replace(/\u00a0/g, " ");
  if (/\.|(?:\s)\d{2}$/.test(rawN) && !/20\d{2}/.test(rawN)) {
    return `${abbr}.${yy}`;
  }
  return `${full} ${year}`;
}

function isValidSurveyYear(year) {
  return year >= 2020 && year <= 2035;
}

function monthResult(monthNum, year, raw) {
  if (!isValidSurveyYear(year) || monthNum < 1 || monthNum > 12) return null;
  return {
    key: toMonthKey(year, monthNum),
    label: buildMonthLabel(monthNum, year, raw),
  };
}

function rawMonthFallback(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const key = text.toLowerCase().replace(/\u00a0/g, " ");
  return { key, label: text };
}

function parseSurveyMonth(v) {
  if (v === null || v === undefined || v === "") return null;

  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const r = monthResult(v.getMonth() + 1, v.getFullYear(), v);
    return r || rawMonthFallback(v);
  }

  if (typeof v === "number" && Number.isFinite(v)) {
    const rounded = Math.round(v);
    const s = String(rounded);
    if (s.length === 6 && rounded >= 202001 && rounded <= 203512) {
      const y = Number(s.slice(0, 4));
      const mo = Number(s.slice(4));
      const r = monthResult(mo, y, s);
      if (r) return r;
    }
    // Excel serial только для дат 2020+ (серийный номер ~43831)
    if (rounded >= 43831) {
      const fromSerial = excelSerialToDate(v);
      if (fromSerial) {
        const r = monthResult(fromSerial.getMonth() + 1, fromSerial.getFullYear(), v);
        if (r) return r;
      }
    }
    return null;
  }

  const raw = String(v).trim();
  const s = raw.toLowerCase().replace(/\u00a0/g, " ");

  let m = s.match(/^(\d{4})[.\-\/](\d{1,2})$/);
  if (m) {
    const r = monthResult(Number(m[2]), Number(m[1]), raw);
    if (r) return r;
  }

  m = s.match(/^(\d{1,2})[.\-\/](\d{4})$/);
  if (m) {
    const r = monthResult(Number(m[1]), Number(m[2]), raw);
    if (r) return r;
  }

  m = s.match(/^([а-яё]{3,12})[\s.]+(\d{2,4})$/);
  if (m) {
    const stem = m[1];
    const year = expandYear(m[2]);
    for (const [name, mo] of RU_MONTH_STEMS) {
      if (stem === name || stem.startsWith(name) || name.startsWith(stem)) {
        const r = monthResult(mo, year, raw);
        if (r) return r;
      }
    }
  }

  for (const [stem, mo] of RU_MONTH_STEMS) {
    if (!s.includes(stem)) continue;
    const y4 = s.match(/20\d{2}/);
    if (y4) {
      const r = monthResult(mo, Number(y4[0]), raw);
      if (r) return r;
    }
    const y2 = s.match(/(?:[\s.])(\d{2})\s*$/);
    if (y2) {
      const r = monthResult(mo, expandYear(y2[1]), raw);
      if (r) return r;
    }
  }

  const asDate = parseDate(raw);
  if (asDate) {
    const r = monthResult(asDate.getMonth() + 1, asDate.getFullYear(), raw);
    if (r) return r;
  }

  return rawMonthFallback(raw);
}

function getSurveyMonthCellValue(ws, rowIndex, colIndex, rawFallback) {
  if (ws && colIndex >= 0) {
    const addr = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
    const cell = ws[addr];
    if (cell?.w) return cell.w;
    if (cell?.v != null && typeof cell.v === "string") return cell.v;
  }
  return rawFallback;
}

function isSuccessfulCall(status) {
  const s = normHeader(status);
  return s === "дозвон" || (s.includes("дозвон") && !s.includes("не дозвон"));
}

function ageInMonths(regDate, refDate) {
  const years = refDate.getFullYear() - regDate.getFullYear();
  const months = refDate.getMonth() - regDate.getMonth();
  let total = years * 12 + months;
  if (refDate.getDate() < regDate.getDate()) total--;
  return Math.max(0, total);
}

function getAgeCohortKey(regDate, refDate) {
  if (!regDate) return null;
  const m = ageInMonths(regDate, refDate);
  if (m <= 3) return "0-3";
  if (m <= 6) return "3-6";
  if (m <= 12) return "6-12";
  return "12+";
}

function getAgeCohortLabel(key) {
  const c = AGE_COHORTS.find((x) => x.key === key);
  return c ? c.label : key;
}

function parseNpsRows(rowsArr, sourceLabel, ws) {
  if (!rowsArr.length) throw new Error("Файл пустой");

  const sheetName = sourceLabel || "лист 1";
  const headers = (rowsArr[0] ?? []).map((c) => String(c ?? "").trim());

  const idxId = findCol(headers, ["n", "№", "id", "#", "номер"]);
  const idxRegDate = findCol(headers, [
    "дата регистрации бизнеса",
    "дата регистрации",
    "дата активации клиента",
    "дата активации",
    "дата создания",
    "activation date",
  ]);
  const idxCall = findCol(headers, ["дозвон", "статус звонка", "call"]);
  const idxScore = findCol(headers, ["оценка", "nps", "score", "балл"]);
  const idxComment = findCol(headers, ["комментарий", "comment", "отзыв", "текст"]);

  const idxSurveyMonthByName = findCol(headers, [
    "месяц обзвона",
    "месяц опроса",
    "месяц nps",
    "месяц",
  ]);
  const idxSurveyMonth =
    idxSurveyMonthByName >= 0 ? idxSurveyMonthByName : lastHeaderColIndex(headers);

  if (idxScore < 0) {
    throw new Error(`Не найдена колонка «Оценка». Заголовки: ${headers.join(" | ")}`);
  }
  if (idxCall < 0) {
    throw new Error(`Не найдена колонка «Дозвон». Заголовки: ${headers.join(" | ")}`);
  }
  if (idxSurveyMonth < 0) {
    throw new Error("Не найден столбец «Месяц обзвона» (последний столбец пустой).");
  }

  const mapping = {
    sheet: sheetName,
    id: idxId >= 0 ? headers[idxId] : "(номер строки)",
    registrationDate: idxRegDate >= 0 ? headers[idxRegDate] : null,
    surveyMonth: headers[idxSurveyMonth] || "(последний столбец)",
    call: headers[idxCall],
    score: headers[idxScore],
    comment: idxComment >= 0 ? headers[idxComment] : null,
  };

  const calls = [];
  const responses = [];
  const skipped = {
    empty: 0,
    noScore: 0,
    noSurveyMonth: 0,
    noCallStatus: 0,
  };

  for (let r = 1; r < rowsArr.length; r++) {
    const line = rowsArr[r] ?? [];
    const idCell = idxId >= 0 ? line[idxId] : r;
    const id = String(idCell ?? r).trim() || `r${r}`;
    const callStatus = String(line[idxCall] ?? "").trim();
    const score = parseScore(line[idxScore]);
    const comment = idxComment >= 0 ? String(line[idxComment] ?? "").trim() : "";
    const regDateObj = idxRegDate >= 0 ? parseDate(line[idxRegDate]) : null;
    const monthRaw = getSurveyMonthCellValue(ws, r, idxSurveyMonth, line[idxSurveyMonth]);
    const monthParsed = parseSurveyMonth(monthRaw);

    const empty = !callStatus && score === null && !comment && !regDateObj && !monthParsed;
    if (empty) {
      skipped.empty++;
      continue;
    }

    if (!callStatus) {
      skipped.noCallStatus++;
      continue;
    }

    calls.push({
      surveyMonth: monthParsed?.key ?? null,
      surveyMonthLabel: monthParsed?.label ?? null,
      registrationDate: regDateObj ? toIsoDate(regDateObj) : null,
      status: callStatus,
    });

    if (!isSuccessfulCall(callStatus)) continue;

    if (score === null) {
      skipped.noScore++;
      continue;
    }

    if (!monthParsed?.key) {
      skipped.noSurveyMonth++;
      continue;
    }

    responses.push({
      id: id.startsWith("r") ? id : `r${id}`,
      surveyMonth: monthParsed.key,
      surveyMonthLabel: monthParsed.label,
      registrationDate: regDateObj ? toIsoDate(regDateObj) : null,
      score,
      comment: comment || "—",
    });
  }

  responses.sort(
    (a, b) =>
      (b.surveyMonth || "").localeCompare(a.surveyMonth || "") ||
      a.id.localeCompare(b.id),
  );

  const connected = calls.filter((c) => isSuccessfulCall(c.status)).length;
  const today = new Date().toISOString().slice(0, 10);
  const label = sourceLabel || "Excel";

  return {
    meta: {
      updatedAt: today,
      source: `${label} · база ${calls.length}, дозвон ${connected}, оценок ${responses.length}`,
    },
    calls,
    responses,
    mapping,
    skipped,
  };
}

function parseNpsWorkbook(wb, sourceLabel) {
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error("В книге нет листов");

  const rowsArr = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  return parseNpsRows(rowsArr, sourceLabel || sheetName, ws);
}

function formatMonthKeyLabel(key) {
  const [y, mo] = String(key).split("-");
  if (!y || !mo || Number.isNaN(Number(mo)) || Number(y) < 2020) return String(key);
  const abbr = MONTH_ABBR[Number(mo) - 1];
  if (!abbr) return key;
  return `${abbr}.${y.slice(-2)}`;
}

function normalizeLegacyItem(item) {
  if (!item) return item;
  if (!item.surveyMonth && item.date) {
    item.surveyMonth = item.date.length >= 7 ? item.date.slice(0, 7) : item.date;
  }
  if (!item.surveyMonthLabel && item.surveyMonth) {
    item.surveyMonthLabel = formatMonthKeyLabel(item.surveyMonth);
  }
  if (!item.registrationDate && item.date && item.date.length === 10) {
    item.registrationDate = item.date;
  }
  return item;
}

const exportsObj = {
  parseNpsWorkbook,
  parseNpsRows,
  isSuccessfulCall,
  AGE_COHORTS,
  ageInMonths,
  getAgeCohortKey,
  getAgeCohortLabel,
  normalizeLegacyItem,
  formatMonthKeyLabel,
};

if (typeof window !== "undefined") {
  Object.assign(window, exportsObj);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = exportsObj;
}
