"use strict";
/*
 * build-data.js — Convert the Thangreens sensor CSVs into data.js
 * (a minimal embedded dataset the dashboard auto-loads on startup).
 *
 * Usage:  node build-data.js
 * Output: data.js  (same folder as this script)
 *
 * Steps per file: decode (UTF-8 w/ fatal, fallback Windows-1252, strip BOM),
 * parse CSV (quoted fields), detect columns, parse timestamps (local time),
 * validate against range rules, then merge by (greenhouse, type), dedupe by
 * timestamp, sort, and decimate (LTTB) so Chart.js stays responsive.
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = "C:\\Users\\darsh\\Downloads\\Thangreens\\data\\";
const DATA_DIR2 = "C:\\Users\\darsh\\Downloads\\tgh\\";
const OUT_FILE = path.join(__dirname, "data.js");

const MAX_POINTS_PER_SERIES = 2000;

/* Validation ranges (same as dashboard) */
const RANGES = {
  ambientTemp: [-40, 60],
  humidity:    [0, 100],
  waterTemp:   [-5, 35],
};

/* ── File config: name → (greenhouse, type) ────────────────────────── */
const FILES = [
  // West GH ambient
  { name: "thaangreens_west_gh 2026-02-01 11_36_13 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-04-07 15_45_17 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-04-26 16_47_10 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-05-18 19_19_19 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-05-26 17_09_11 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-08-01 13_49_50 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-08-01 19_19_19 IST (Data IST).xlsx.csv", gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-09-01 19_04_28 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  // East GH ambient
  { name: "thaangreens_east_gh 2026-02-01 11_38_56 IST (Data IST).csv",      gh: "eastGH", type: "ambient" },
  { name: "thaangreens_east_gh 2026-04-07 15_41_43 IST (Data IST).csv",      gh: "eastGH", type: "ambient" },
  { name: "thaangreens_east_gh 2026-04-26 16_49_38 IST (Data IST).csv",      gh: "eastGH", type: "ambient" },
  { name: "thaangreens_east_gh 2026-05-18 19_22_21 IST (Data IST).csv",      gh: "eastGH", type: "ambient" },
  { name: "thaangreens_east_gh 2026-05-26 17_12_36 IST (Data IST).csv",      gh: "eastGH", type: "ambient" },
  { name: "thaangreens_east_gh 2026-09-01 19_08_27 IST (Data IST).csv",      gh: "eastGH", type: "ambient" },
  // East GH ambient (Sep 2026)
  { name: "thaangreens_east_gh 2026-09-26 17_15_32 IST (Data IST).csv", gh: "eastGH", type: "ambient", dir: DATA_DIR2 },
  // West GH ambient (Sep 2026)
  { name: "thaangreens_west_gh 2026-09-26 17_08_13 IST (Data IST).csv", gh: "westGH", type: "ambient", dir: DATA_DIR2 },
  // West GH water
  { name: "Thangsgreen_West_GH_water-ambient.csv", gh: "westGH", type: "water" },
  { name: "water_west.csv",                        gh: "westGH", type: "water" },
  { name: "water_west(2).csv",                     gh: "westGH", type: "water", dir: DATA_DIR2 },
  { name: "water_west_2_.csv",                     gh: "westGH", type: "water", dir: DATA_DIR2 },
];

/* ── Decode file with encoding fallback ────────────────────────────── */
function readText(file) {
  const buf = fs.readFileSync(file);
  let s;
  try {
    s = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (e) {
    s = new TextDecoder("windows-1252").decode(buf);
  }
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip BOM
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/* ── CSV parser (handles quoted fields with commas / "" escapes) ───── */
function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (inQ) {
      if (c === '"') {
        if (chars[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += c;
    }
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/* ── Timestamp parser — built per file after scanning ALL raw values ──
 * Separator: slash or dash. Dash files are month-first ("04-26-2026"
 * = Apr 26). For slash files: if any first component across the whole
 * file is > 12 the order is day-first (DD/MM/YYYY, Indian convention);
 * otherwise month-first (MM/DD/YY). Optional AM/PM, 2-digit years. ───── */
function buildTsParser(sep, order) {
  return (str) => {
    if (str == null) return null;
    str = String(str).trim();
    if (!str) return null;
    const m = str.match(
      /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i
    );
    if (!m) {
      const t = Date.parse(str);
      return isNaN(t) ? null : t;
    }
    let [, a, b, yy, hh, mm, ss, ap] = m;
    const mo = order === "DM" ? +b : +a;
    const dd = order === "DM" ? +a : +b;
    let year = +yy;
    if (year < 100) year += 2000;
    let h = +hh;
    if (ap) {
      if (/pm/i.test(ap) && h < 12) h += 12;
      if (/am/i.test(ap) && h === 12) h = 0;
    }
    const t = new Date(year, mo - 1, dd, h, +mm, +(ss || 0)).getTime();
    return isNaN(t) ? null : t;
  };
}

/* ── Column detection from headers ─────────────────────────────────── */
function detectCols(headers) {
  const h = headers.map((x) => String(x).trim().toLowerCase());
  const find = (pats) => {
    for (const p of pats) {
      const i = h.findIndex((x) => x.includes(p));
      if (i >= 0) return i;
    }
    return -1;
  };
  const tsCol = find(["date-time", "date_time", "datetime", "date time", "time", "date"]);
  const tempCol = find(["temperature", "ambient_temp", "ambienttemp", "ambient_c", "ambientc", "temp"]);
  const humCol = find(["humidity", "hum", "rh"]);
  const waterCol = find(["water"]);
  // Second water column (e.g. WaterTemp2_C): search from waterCol+1 onwards
  let waterCol2 = -1;
  if (waterCol >= 0) {
    for (let i = waterCol + 1; i < h.length; i++) {
      if (h[i].includes("water")) { waterCol2 = i; break; }
    }
  }
  return { tsCol, tempCol, humCol, waterCol, waterCol2 };
}

function inRange(v, [lo, hi]) {
  return v !== null && !isNaN(v) && v >= lo && v <= hi;
}

/* ── LTTB downsampling (shape-preserving) ─────────────────────────── */
function lttb(data, threshold) {
  const n = data.length;
  if (threshold >= n || threshold < 3) return data.slice();
  const sampled = [];
  let a = 0;
  const every = (n - 2) / (threshold - 2);
  sampled.push(data[0]);
  for (let i = 0; i < threshold - 2; i++) {
    const avgRangeStart = Math.floor((i + 1) * every) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
    const avgLength = (avgRangeEnd - avgRangeStart) || 1;
    let avgX = 0, avgY = 0;
    for (let j = avgRangeStart; j < avgRangeEnd; j++) { avgX += data[j][0]; avgY += data[j][1]; }
    avgX /= avgLength; avgY /= avgLength;
    const rangeOffs = Math.floor(i * every) + 1;
    const rangeTo = Math.floor((i + 1) * every) + 1;
    const ax = data[a][0], ay = data[a][1];
    let maxArea = -1, nextA = rangeOffs;
    for (let j = rangeOffs; j < rangeTo; j++) {
      const area = Math.abs((ax - avgX) * (data[j][1] - ay) - (ax - data[j][0]) * (avgY - ay));
      if (area > maxArea) { maxArea = area; nextA = j; }
    }
    sampled.push(data[nextA]);
    a = nextA;
  }
  sampled.push(data[n - 1]);
  return sampled;
}

/* ── Build ─────────────────────────────────────────────────────────── */
const series = {
  eastGH: { ambient: { points: [], valid: 0, filtered: 0 } },
  westGH: { ambient: { points: [], valid: 0, filtered: 0 }, water: { points: [], valid: 0, filtered: 0 } },
};
const fileMeta = [];
const perFile = [];

for (const cfg of FILES) {
  const file = path.join(cfg.dir || DATA_DIR, cfg.name);
  if (!fs.existsSync(file)) {
    console.error("MISSING:", cfg.name);
    continue;
  }
  const text = readText(file);
  const rows = parseCsv(text);
  if (!rows.length) { console.error("EMPTY:", cfg.name); continue; }

  const headers = rows[0];
  const { tsCol, tempCol, humCol, waterCol, waterCol2 } = detectCols(headers);
  const records = { file: cfg.name, rows: rows.length - 1, valid: 0, filtered: 0, first: null, last: null };
  const target = series[cfg.gh][cfg.type];

  // Detect separator + date order by scanning ALL timestamp values
  // (handles MM-DD vs DD-MM consistently, even when only late rows disambiguate).
  let sep = null, order = "MD";
  const stride = Math.max(1, Math.floor((rows.length - 1) / 400));
  const check = (str) => {
    if (str == null || !/^\d/.test(String(str).trim())) return;
    const s = String(str).trim();
    if (!sep) sep = s.includes("/") ? "/" : "-";
    const p = s.split(/\s+/)[0].split(sep)[0];
    if (/^\d{1,2}$/.test(p) && +p > 12) order = "DM";
  };
  for (let i = 1; i < rows.length; i += stride) check(tsCol >= 0 ? rows[i][tsCol] : "");
  check(tsCol >= 0 ? rows[rows.length - 1][tsCol] : "");
  if (!sep) sep = "-";
  const parseTs = buildTsParser(sep, order);

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const ts = parseTs(tsCol >= 0 ? r[tsCol] : "");
    let ok = true, issue = "";

    // timestamp required & valid
    if (ts === null) { ok = false; issue = "invalid timestamp"; }
    else {
      let temp = null, hum = null, wt = null;
      if (cfg.type === "ambient") {
        temp = parseFloat(r[tempCol >= 0 ? tempCol : -1]);
        hum = parseFloat(r[humCol >= 0 ? humCol : -1]);
        if (isNaN(temp)) { ok = false; issue = "missing temp"; }
        else if (!inRange(temp, RANGES.ambientTemp)) { ok = false; issue = "temp out of range"; }
        else if (!isNaN(hum) && !inRange(hum, RANGES.humidity)) { ok = false; issue = "humidity out of range"; }
        else target.points.push([ts, temp, isNaN(hum) ? null : hum]);
      } else {
        const wt1 = parseFloat(r[waterCol >= 0 ? waterCol : -1]);
        const wt2 = waterCol2 >= 0 ? parseFloat(r[waterCol2]) : NaN;
        // Use average of both sensors when both are valid; otherwise whichever is valid
        let wt;
        const v1 = !isNaN(wt1) && inRange(wt1, RANGES.waterTemp);
        const v2 = !isNaN(wt2) && inRange(wt2, RANGES.waterTemp);
        if (v1 && v2) wt = (wt1 + wt2) / 2;
        else if (v1)  wt = wt1;
        else if (v2)  wt = wt2;
        else          wt = NaN;
        if (isNaN(wt)) { ok = false; issue = "missing water temp"; }
        else target.points.push([ts, wt]);
      }
    }

    if (ok) { records.valid++; if (records.first === null) records.first = ts; records.last = ts; }
    else records.filtered++;
  }

  target.valid += records.valid;
  target.filtered += records.filtered;
  perFile.push(records);
}

/* Dedupe + sort each series (full resolution — zoom needs the detail) */
for (const gh of Object.keys(series)) {
  for (const type of Object.keys(series[gh])) {
    const s = series[gh][type];
    const seen = new Map();
    for (const p of s.points) seen.set(p[0], p);
    s.points = Array.from(seen.values()).sort((a, b) => a[0] - b[0]);
  }
}

/* __ Write data.js __ */
const out = {
  meta: {
    generated: new Date().toISOString(),
    totalValid: series.eastGH.ambient.valid + series.westGH.ambient.valid + series.westGH.water.valid,
    totalFiltered: series.eastGH.ambient.filtered + series.westGH.ambient.filtered + series.westGH.water.filtered,
    files: perFile,
  },
  eastGH: {
    ambient: { n: series.eastGH.ambient.valid, points: series.eastGH.ambient.points },
  },
  westGH: {
    ambient: { n: series.westGH.ambient.valid, points: series.westGH.ambient.points },
    water: { n: series.westGH.water.valid, points: series.westGH.water.points },
  },
};

const js = "window.DEFAULT_DATA = " + JSON.stringify(out) + ";\n";
fs.writeFileSync(OUT_FILE, js, "utf-8");

/* ── Report ────────────────────────────────────────────────────────── */
console.log("Generated", OUT_FILE, "—", (fs.statSync(OUT_FILE).size / 1024).toFixed(1), "KB");
for (const f of perFile) {
  console.log(
    `  ${f.file.slice(0, 52).padEnd(52)} rows=${String(f.rows).padStart(6)} valid=${String(f.valid).padStart(6)} filtered=${f.filtered}  ${f.first ? "[" + new Date(f.first).toISOString().slice(0, 10) : "–"} → ${f.last ? new Date(f.last).toISOString().slice(0, 10) : "–"}]`
  );
}
for (const gh of Object.keys(series)) {
  for (const type of Object.keys(series[gh])) {
    const s = series[gh][type];
    console.log(`${gh}/${type}: ${s.points.length.toLocaleString()} points embedded (full resolution)`);
  }
}
console.log("TOTAL valid:", out.meta.totalValid.toLocaleString(), "| filtered:", out.meta.totalFiltered.toLocaleString());