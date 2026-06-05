/**
 * Парсинг Excel → { meta, calls, responses }
 * Группировка по месяцам — колонка «месяц оценки» (не дата активации).
 */
const AGE_COHORTS = [
  { key: "0-3", label: "До 3 мес. вкл." },
  { key: "3-6", label: "3–6 мес." },
  { key: "6-12", label: "6 мес. – 1 год" },
  { key: "12+", label: "От 1 года" },
];

function normHeader(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, " ");
}

function findColExact(headers, candidates) {
  const lowered = headers.map(normHeader);
  for (const c of candidates) {
    const cc = normHeader(c);
    const idx = lowered.indexOf(cc);
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Заголовок содержит фразу целиком (не «оценка» внутри «месяц оценки» наоборот) */
function findColContains(headers, candidates) {
  const lowered = headers.map(normHeader);
  for (const c of candidates) {
    const cc = normHeader(c);
    const idx = lowered.findIndex((h) => h.includes(cc));
    if (idx >= 0) return idx;
  }
  return -1;
}

function resolveCol(headers, exactCandidates, containsCandidates = []) {
  let idx = findColExact(headers, exactCandidates);
  if (idx < 0 && containsCandidates.length) {
    idx = findColContains(headers, containsCandidates);
  }
  return idx;
}

function lastColIndex(rowsArr) {
  let maxIdx = (rowsArr[0]?.length ?? 1) - 1;
  for (let r = 1; r < rowsArr.length; r++) {
    const len = (rowsArr[r] ?? []).length;
    if (len > 0) maxIdx = Math.max(maxIdx, len - 1);
  }
  return Math.max(0, maxIdx);
}

const EXCEL_SERIAL_MIN = 30000;

/** Колонка «месяц оценки» — строгий поиск, без путаницы с «Оценка» */
function findEvaluationMonthCol(headers, rowsArr) {
  const lowered = headers.map(normHeader);

  const exactNames = ["месяц оценки", "месяц обзвона", "месяц оценки nps"];
  for (const name of exactNames) {
    const idx = lowered.indexOf(name);
    if (idx >= 0) return idx;
  }

  const fuzzy = lowered.findIndex(
    (h) => h.includes("месяц") && (h.includes("оценк") || h.includes("обзвон")),
  );
  if (fuzzy >= 0) return fuzzy;

  return lastColIndex(rowsArr);
}

function excelDateToJSDate(serial) {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  return new Date(utcValue * 1000);
}

function excelSerialToDate(serial) {
  if (!Number.isFinite(serial)) return null;
  if (serial >= EXCEL_SERIAL_MIN) return excelDateToJSDate(serial);
  return null;
}

function getMonthLabel(value) {
  let date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number") {
    date = value >= EXCEL_SERIAL_MIN ? excelDateToJSDate(value) : null;
    if (!date || Number.isNaN(date.getTime())) return null;
  } else {
    date = new Date(value);
  }

  if (!date || Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
}

function parseDdMmYyyy(text) {
  const m = String(text).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year = expandYear(year);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
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
  const ru = parseDdMmYyyy(s);
  if (ru) return ru;
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

function getCellDisplay(ws, row, col, fallback) {
  if (ws && col >= 0) {
    const addr = XLSX.utils.encode_cell({ r: row, c: col });
    const cell = ws[addr];
    if (cell?.w != null && String(cell.w).trim()) return String(cell.w).trim();
    if (cell?.v != null && typeof cell.v === "string") return String(cell.v).trim();
    if (cell?.v != null && typeof cell.v === "number" && cell.v >= 1 && cell.v < 100 && !Number.isInteger(cell.v)) {
      return cell.v.toFixed(2);
    }
  }
  if (fallback == null || fallback === "") return "";
  if (typeof fallback === "number" && fallback >= 1 && fallback < 100 && !Number.isInteger(fallback)) {
    return fallback.toFixed(2);
  }
  return String(fallback).trim();
}

function monthKeyFromDate(d) {
  return toMonthKey(d.getFullYear(), d.getMonth() + 1);
}

function parseMonthShorthand(input) {
  const text = String(input ?? "").trim().replace(",", ".");
  if (!text) return null;

  let m = text.match(/^(\d{1,2})\.(\d{2})$/);
  if (m) {
    const month = Number(m[1]);
    const year = expandYear(m[2]);
    if (month >= 1 && month <= 12) {
      const label = `${month}.${m[2]}`;
      return { key: toMonthKey(year, month), label, sortKey: toMonthKey(year, month) };
    }
  }

  m = text.match(/^(\d{4})$/);
  if (m) {
    const digits = m[1];
    const month = Number(digits.slice(0, 2));
    const yy = digits.slice(2);
    const year = expandYear(yy);
    if (month >= 1 && month <= 12) {
      const label = `${month}.${yy}`;
      return { key: toMonthKey(year, month), label, sortKey: toMonthKey(year, month) };
    }
  }

  const num = Number(text);
  if (!Number.isNaN(num) && text.match(/^[\d.]+$/)) {
    if (num >= 1 && num < 100 && !Number.isInteger(num)) {
      const parts = num.toFixed(2).split(".");
      const month = Number(parts[0]);
      const year = expandYear(parts[1]);
      if (month >= 1 && month <= 12) {
        const label = `${month}.${parts[1]}`;
        return { key: toMonthKey(year, month), label, sortKey: toMonthKey(year, month) };
      }
    }
    if (Number.isInteger(num) && num >= 1 && num <= 12) {
      const year = new Date().getFullYear();
      const yy = String(year).slice(-2);
      const label = `${num}.${yy}`;
      return { key: toMonthKey(year, num), label, sortKey: toMonthKey(year, num) };
    }
    if (Number.isInteger(num) && num >= 101 && num <= 9999) {
      const s = String(num);
      if (s.length === 4) {
        const month = Number(s.slice(0, 2));
        const yy = s.slice(2);
        const year = expandYear(yy);
        if (month >= 1 && month <= 12) {
          const label = `${month}.${yy}`;
          return { key: toMonthKey(year, month), label, sortKey: toMonthKey(year, month) };
        }
      }
      if (s.length === 3) {
        const month = Number(s[0]);
        const year = expandYear(s.slice(1));
        if (month >= 1 && month <= 12) {
          const label = `${month}.${s.slice(1)}`;
          return { key: toMonthKey(year, month), label, sortKey: toMonthKey(year, month) };
        }
      }
    }
    if (num >= 202001 && num <= 203512 && String(num).length === 6) {
      const s = String(num);
      const year = Number(s.slice(0, 4));
      const month = Number(s.slice(4));
      if (month >= 1 && month <= 12) {
        const label = `${month}.${s.slice(2, 4)}`;
        return { key: toMonthKey(year, month), label, sortKey: toMonthKey(year, month) };
      }
    }
  }

  return null;
}

/** Парсит колонку «месяц оценки»: Excel serial, дата, 4.26, текст */
function parseEvaluationMonth(raw, formattedText) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime()) && raw.getFullYear() >= 2020) {
    const key = monthKeyFromDate(raw);
    return { key, label: getMonthLabel(raw), sortKey: key };
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw >= EXCEL_SERIAL_MIN) {
      const d = excelDateToJSDate(raw);
      if (d && !Number.isNaN(d.getTime()) && d.getFullYear() >= 2020) {
        const key = monthKeyFromDate(d);
        return { key, label: getMonthLabel(raw), sortKey: key };
      }
    }
    if (raw >= 1 && raw < 100 && !Number.isInteger(raw)) {
      return parseEvaluationMonth(null, raw.toFixed(2));
    }
  }

  const text = String(formattedText ?? raw ?? "").trim().replace(",", ".");
  if (!text) return null;

  const ruDate = parseDdMmYyyy(text);
  if (ruDate && ruDate.getFullYear() >= 2020) {
    const key = monthKeyFromDate(ruDate);
    return { key, label: getMonthLabel(ruDate), sortKey: key };
  }

  const parsedDate = parseDate(text);
  if (parsedDate && parsedDate.getFullYear() >= 2020) {
    const key = monthKeyFromDate(parsedDate);
    return { key, label: getMonthLabel(parsedDate), sortKey: key };
  }

  const shorthand = parseMonthShorthand(text);
  if (shorthand) {
    const [y, mo] = shorthand.key.split("-");
    const d = new Date(Number(y), Number(mo) - 1, 1);
    return { key: shorthand.key, label: getMonthLabel(d), sortKey: shorthand.key };
  }

  return { key: text, label: text, sortKey: text };
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

  const headers = (rowsArr[0] ?? []).map((c) => String(c ?? "").trim());
  const idxSurveyMonth = findEvaluationMonthCol(headers, rowsArr);

  const idxId = resolveCol(headers, ["n", "№", "id", "#", "номер"], ["номер"]);
  const idxRegDate = resolveCol(
    headers,
    ["дата регистрации бизнеса", "дата регистрации"],
    [
      "дата регистрации бизнеса",
      "дата регистрации",
      "дата активации клиента",
      "дата активации",
      "дата создания",
    ],
  );
  const idxCall = resolveCol(headers, ["дозвон", "статус звонка", "call"], [
    "дозвон",
    "статус звонка",
    "call",
  ]);
  const idxScore = resolveCol(headers, ["оценка", "nps", "score", "балл"], [
    "nps",
    "score",
    "балл",
  ]);
  const idxComment = resolveCol(
    headers,
    ["комментарий", "comment", "отзыв", "текст"],
    ["комментарий", "comment", "отзыв", "текст"],
  );

  if (idxScore < 0) {
    throw new Error(`Не найдена колонка «Оценка». Заголовки: ${headers.join(" | ")}`);
  }
  if (idxCall < 0) {
    throw new Error(`Не найдена колонка «Дозвон». Заголовки: ${headers.join(" | ")}`);
  }

  let idxEvalMonth = idxSurveyMonth;
  const monthHeaderNorm = normHeader(headers[idxEvalMonth] || "");
  if (idxEvalMonth === idxScore || monthHeaderNorm === "оценка" || monthHeaderNorm === "nps") {
    idxEvalMonth = lastColIndex(rowsArr);
  }

  const mapping = {
    sheet: sourceLabel || "лист 1",
    surveyMonthCol: idxEvalMonth,
    surveyMonthHeader: headers[idxEvalMonth] || "(последний столбец)",
    allHeaders: headers,
    registrationDate: idxRegDate >= 0 ? headers[idxRegDate] : null,
    call: headers[idxCall],
    score: headers[idxScore],
    comment: idxComment >= 0 ? headers[idxComment] : null,
  };

  const calls = [];
  const responses = [];
  const skipped = { empty: 0, noScore: 0, noCallStatus: 0 };

  for (let r = 1; r < rowsArr.length; r++) {
    const line = rowsArr[r] ?? [];
    const idCell = idxId >= 0 ? line[idxId] : r;
    const id = String(idCell ?? r).trim() || `r${r}`;
    const callStatus = String(line[idxCall] ?? "").trim();
    const score = parseScore(line[idxScore]);
    const comment = idxComment >= 0 ? String(line[idxComment] ?? "").trim() : "";
    const regDateObj = idxRegDate >= 0 ? parseDate(line[idxRegDate]) : null;

    const monthCellVal = line[idxEvalMonth];
    const monthFormatted = getCellDisplay(ws, r, idxEvalMonth, monthCellVal);
    const monthParsed = parseEvaluationMonth(monthCellVal, monthFormatted);

    const empty =
      !callStatus && score === null && !comment && !regDateObj && !monthFormatted && monthCellVal == null;
    if (empty) {
      skipped.empty++;
      continue;
    }

    if (!callStatus) {
      skipped.noCallStatus++;
      continue;
    }

    const monthKey = monthParsed?.key ?? null;
    const monthLabel = monthParsed?.label || monthFormatted || null;

    calls.push({
      surveyMonth: monthKey,
      surveyMonthLabel: monthLabel,
      registrationDate: regDateObj ? toIsoDate(regDateObj) : null,
      status: callStatus,
    });

    if (!isSuccessfulCall(callStatus)) continue;

    if (score === null) {
      skipped.noScore++;
      continue;
    }

    responses.push({
      id: id.startsWith("r") ? id : `r${id}`,
      surveyMonth: monthKey,
      surveyMonthLabel: monthLabel,
      registrationDate: regDateObj ? toIsoDate(regDateObj) : null,
      score,
      comment: comment || "—",
    });
  }

  responses.sort((a, b) => {
    const ka = a.surveyMonth || "";
    const kb = b.surveyMonth || "";
    if (/^\d{4}-\d{2}$/.test(ka) && /^\d{4}-\d{2}$/.test(kb)) return kb.localeCompare(ka);
    return kb.localeCompare(ka, "ru");
  });

  const connected = calls.filter((c) => isSuccessfulCall(c.status)).length;
  const today = new Date().toISOString().slice(0, 10);

  return {
    meta: {
      updatedAt: today,
      source: `${sourceLabel || "Excel"} · база ${calls.length}, дозвон ${connected}, оценок ${responses.length}`,
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
  const m = String(key).match(/^(\d{4})-(\d{2})$/);
  if (m && Number(m[1]) >= 2020) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    return getMonthLabel(d) || key;
  }
  return String(key);
}

function normalizeLegacyItem(item) {
  if (!item) return item;
  if (!item.surveyMonth && item.date && /^\d{4}-\d{2}$/.test(item.date)) {
    item.surveyMonth = item.date;
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
  parseEvaluationMonth,
  parseMonthShorthand,
  excelDateToJSDate,
  getMonthLabel,
};

if (typeof window !== "undefined") {
  Object.assign(window, exportsObj);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = exportsObj;
}
