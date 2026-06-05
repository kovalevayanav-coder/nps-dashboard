/**
 * Парсинг welcome-call.xlsx → массив строк дашборда Welcome Call
 */
const WC_EXCEL_SERIAL_MIN = 30000;

function normHeader(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");
}

function findCol(headers, candidates) {
  const lowered = headers.map(normHeader);
  for (const c of candidates) {
    const cc = normHeader(c);
    const idx = lowered.indexOf(cc);
    if (idx >= 0) return idx;
  }
  for (const c of candidates) {
    const cc = normHeader(c);
    const idx = lowered.findIndex((h) => h.includes(cc));
    if (idx >= 0) return idx;
  }
  return -1;
}

function excelDateToJSDate(serial) {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  return new Date(utcValue * 1000);
}

function getMonthLabel(value) {
  let date;

  if (typeof value === "number") {
    date = excelDateToJSDate(value);
  } else if (value instanceof Date) {
    date = value;
  } else {
    date = new Date(value);
  }

  if (!date || Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
}

function monthKeyFromValue(value) {
  let date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number" && value >= WC_EXCEL_SERIAL_MIN) {
    date = excelDateToJSDate(value);
  } else if (typeof value === "string" && value.trim()) {
    const m = value.trim().match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
    date = new Date(value);
  } else {
    return null;
  }

  if (!date || Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${mo}`;
}

function cellStr(val) {
  if (val == null) return "";
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).trim();
}

function cellNum(val) {
  if (val == null || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function isFilled(val) {
  const s = cellStr(val);
  return s !== "" && s !== "—" && s !== "-";
}

function parseWelcomeCallWorkbook(wb, sourceName) {
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });

  if (!rows.length) {
    return { rows: [], meta: { source: sourceName, updatedAt: new Date().toISOString().slice(0, 10) } };
  }

  const headers = rows[0].map((h) => String(h ?? ""));
  const col = {
    month: findCol(headers, ["месяц обзвона", "месяц оценки"]),
    status: findCol(headers, ["статус звонка", "дозвон"]),
    count: findCol(headers, ["количество звонков"]),
    connection: findCol(headers, ["хорошо ли прошел процесс подключения"]),
    connectionComment: findCol(headers, [
      "коментарии к процессу подключения",
      "комментарии к процессу подключения",
    ]),
    manager: findCol(headers, ["оценка менеджера"]),
    managerComment: findCol(headers, [
      "коментарии к оценке менеджера",
      "комментарии к оценке менеджера",
    ]),
    nps: findCol(headers, ["планируете ли вы рекомендовать payme"]),
    npsComment: findCol(headers, ["дополнительные комментарии"]),
  };

  const parsed = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const monthRaw = col.month >= 0 ? row[col.month] : "";
    const monthKey = monthKeyFromValue(monthRaw);
    const monthLabel = getMonthLabel(monthRaw) || (monthKey ? formatMonthKeyLabel(monthKey) : null);
    const monthSort = monthKey ? monthKeyToDate(monthKey).getTime() : 0;

    const callCountRaw = col.count >= 0 ? row[col.count] : "";
    const callCount = cellNum(callCountRaw);
    const count = callCount != null && callCount > 0 ? callCount : 1;

    parsed.push({
      rowIndex: i,
      monthKey,
      monthLabel,
      monthSort,
      callStatus: col.status >= 0 ? cellStr(row[col.status]) : "",
      callCount: count,
      connectionRating: col.connection >= 0 ? cellStr(row[col.connection]) : "",
      connectionComment: col.connectionComment >= 0 ? cellStr(row[col.connectionComment]) : "",
      managerRating: col.manager >= 0 ? row[col.manager] : "",
      managerRatingStr: col.manager >= 0 ? cellStr(row[col.manager]) : "",
      managerComment: col.managerComment >= 0 ? cellStr(row[col.managerComment]) : "",
      npsRating: col.nps >= 0 ? row[col.nps] : "",
      npsRatingStr: col.nps >= 0 ? cellStr(row[col.nps]) : "",
      npsComment: col.npsComment >= 0 ? cellStr(row[col.npsComment]) : "",
    });
  }

  return {
    rows: parsed,
    meta: {
      source: sourceName,
      updatedAt: new Date().toISOString().slice(0, 10),
      sheetName,
    },
    mapping: col,
  };
}

function monthKeyToDate(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

function formatMonthKeyLabel(key) {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return key || "—";
  const d = monthKeyToDate(key);
  return d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

function sortMonthKeys(keys) {
  return [...keys].sort((a, b) => monthKeyToDate(a).getTime() - monthKeyToDate(b).getTime());
}

function buildMonthCatalog(rows) {
  const map = new Map();
  rows.forEach((r) => {
    if (!r.monthKey) return;
    if (!map.has(r.monthKey) || r.monthLabel) {
      map.set(r.monthKey, r.monthLabel || formatMonthKeyLabel(r.monthKey));
    }
  });
  return map;
}
