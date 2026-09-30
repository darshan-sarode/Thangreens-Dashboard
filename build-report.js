"use strict";
/*
 * build-report.js — Recompute REPORT_DATA from raw sensor CSVs + Open-Meteo,
 * then patch the REPORT_DATA blob in report.html in-place.
 *
 * Usage: node build-report.js
 */
const fs   = require("fs");
const path = require("path");
const https = require("https");

/* ── re-use the same CSV machinery as build-data.js ─────────────────── */
function readText(file) {
  const buf = fs.readFileSync(file);
  let s;
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch (e) { s = new TextDecoder("windows-1252").decode(buf); }
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
function parseCsv(text) {
  const rows = []; let row = [], cur = "", inQ = false;
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (inQ) { if (c === '"') { if (chars[i+1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else { if (c === '"') inQ = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c; }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}
function detectCols(headers) {
  const h = headers.map(x => String(x).trim().toLowerCase());
  const find = pats => { for (const p of pats) { const i = h.findIndex(x => x.includes(p)); if (i >= 0) return i; } return -1; };
  const tsCol    = find(["date-time","date_time","datetime","date time","time","date"]);
  const tempCol  = find(["temperature","ambient_temp","ambienttemp","ambient_c","ambientc","temp"]);
  const humCol   = find(["humidity","hum","rh"]);
  const waterCol = find(["water"]);
  let waterCol2 = -1;
  if (waterCol >= 0) { for (let i = waterCol+1; i < h.length; i++) { if (h[i].includes("water")) { waterCol2 = i; break; } } }
  return { tsCol, tempCol, humCol, waterCol, waterCol2 };
}
function buildTsParser(sep, order) {
  return str => {
    if (str == null) return null;
    str = String(str).trim(); if (!str) return null;
    const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!m) { const t = Date.parse(str); return isNaN(t) ? null : t; }
    let [, a, b, yy, hh, mm, ss, ap] = m;
    const mo = order === "DM" ? +b : +a, dd = order === "DM" ? +a : +b;
    let year = +yy; if (year < 100) year += 2000;
    let h = +hh; if (ap) { if (/pm/i.test(ap) && h < 12) h += 12; if (/am/i.test(ap) && h === 12) h = 0; }
    const t = new Date(year, mo-1, dd, h, +mm, +(ss||0)).getTime();
    return isNaN(t) ? null : t;
  };
}
function inRange(v, [lo, hi]) { return v !== null && !isNaN(v) && v >= lo && v <= hi; }

const RANGES = { ambientTemp: [-40, 60], humidity: [0, 100], waterTemp: [-5, 35] };
const DATA_DIR  = "C:\\Users\\darsh\\Downloads\\Thangreens\\data\\";
const DATA_DIR2 = "C:\\Users\\darsh\\Downloads\\tgh\\";
const FILES = [
  { name: "thaangreens_west_gh 2026-02-01 11_36_13 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-04-07 15_45_17 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-04-26 16_47_10 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-05-18 19_19_19 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-05-26 17_09_11 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-08-01 13_49_50 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-08-01 19_19_19 IST (Data IST).xlsx.csv", gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-09-01 19_04_28 IST (Data IST).csv",      gh: "westGH", type: "ambient" },
  { name: "thaangreens_west_gh 2026-09-26 17_08_13 IST (Data IST).csv",      gh: "westGH", type: "ambient", dir: DATA_DIR2 },
  { name: "thaangreens_east_gh 2026-02-01 11_38_56 IST (Data IST).csv",      gh: "eastGH", type: "ambient" },
  { name: "thaangreens_east_gh 2026-04-07 15_41_43 IST (Data IST).csv",      gh: "eastGH", type: "ambient" },
  { name: "thaangreens_east_gh 2026-04-26 16_49_38 IST (Data IST).csv",      gh: "eastGH", type: "ambient" },
  { name: "thaangreens_east_gh 2026-05-18 19_22_21 IST (Data IST).csv",      gh: "eastGH", type: "ambient" },
  { name: "thaangreens_east_gh 2026-05-26 17_12_36 IST (Data IST).csv",      gh: "eastGH", type: "ambient" },
  { name: "thaangreens_east_gh 2026-09-01 19_08_27 IST (Data IST).csv",      gh: "eastGH", type: "ambient" },
  { name: "thaangreens_east_gh 2026-09-26 17_15_32 IST (Data IST).csv",      gh: "eastGH", type: "ambient", dir: DATA_DIR2 },
  { name: "Thangsgreen_West_GH_water-ambient.csv",                            gh: "westGH", type: "water" },
  { name: "water_west.csv",                                                    gh: "westGH", type: "water" },
  { name: "water_west(2).csv",                                                 gh: "westGH", type: "water", dir: DATA_DIR2 },
];

// ── load all sensor data ──────────────────────────────────────────────
// Each point: [tsMs, value, hum?]
const raw = { eastGH: { ambient: [] }, westGH: { ambient: [], water: [] } };

for (const cfg of FILES) {
  const file = path.join(cfg.dir || DATA_DIR, cfg.name);
  if (!fs.existsSync(file)) { console.error("MISSING:", cfg.name); continue; }
  const rows = parseCsv(readText(file));
  if (!rows.length) continue;
  const { tsCol, tempCol, humCol, waterCol, waterCol2 } = detectCols(rows[0]);
  let sep = null, order = "MD";
  const stride = Math.max(1, Math.floor((rows.length - 1) / 400));
  const check = str => {
    if (str == null || !/^\d/.test(String(str).trim())) return;
    const s = String(str).trim(); if (!sep) sep = s.includes("/") ? "/" : "-";
    const p = s.split(/\s+/)[0].split(sep)[0]; if (/^\d{1,2}$/.test(p) && +p > 12) order = "DM";
  };
  for (let i = 1; i < rows.length; i += stride) check(tsCol >= 0 ? rows[i][tsCol] : "");
  check(tsCol >= 0 ? rows[rows.length-1][tsCol] : "");
  if (!sep) sep = "-";
  const parseTs = buildTsParser(sep, order);
  const target = raw[cfg.gh][cfg.type];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const ts = parseTs(tsCol >= 0 ? r[tsCol] : "");
    if (ts === null) continue;
    if (cfg.type === "ambient") {
      const temp = parseFloat(r[tempCol >= 0 ? tempCol : -1]);
      const hum  = parseFloat(r[humCol  >= 0 ? humCol  : -1]);
      if (!inRange(temp, RANGES.ambientTemp)) continue;
      if (!isNaN(hum) && !inRange(hum, RANGES.humidity)) continue;
      target.push([ts, temp, isNaN(hum) ? null : hum]);
    } else {
      const wt1 = parseFloat(r[waterCol >= 0 ? waterCol : -1]);
      const wt2 = waterCol2 >= 0 ? parseFloat(r[waterCol2]) : NaN;
      const v1 = !isNaN(wt1) && inRange(wt1, RANGES.waterTemp);
      const v2 = !isNaN(wt2) && inRange(wt2, RANGES.waterTemp);
      let wt;
      if (v1 && v2) wt = (wt1 + wt2) / 2;
      else if (v1)  wt = wt1;
      else if (v2)  wt = wt2;
      else continue;
      target.push([ts, wt]);
    }
  }
}
// dedupe + sort
for (const gh of Object.keys(raw)) {
  for (const type of Object.keys(raw[gh])) {
    const seen = new Map();
    for (const p of raw[gh][type]) seen.set(p[0], p);
    raw[gh][type] = Array.from(seen.values()).sort((a, b) => a[0] - b[0]);
  }
}

const eastPts  = raw.eastGH.ambient;   // [ts, temp, hum]
const westPts  = raw.westGH.ambient;   // [ts, temp, hum]
const waterPts = raw.westGH.water;     // [ts, wt]

console.log(`Loaded: East=${eastPts.length}, West=${westPts.length}, Water=${waterPts.length}`);

// ── stat helpers ──────────────────────────────────────────────────────
const vals    = pts => pts.map(p => p[1]);
const humVals = pts => pts.map(p => p[2]).filter(v => v !== null);
function stat(arr) {
  if (!arr.length) return { min: null, max: null, mean: null, n: 0 };
  let mn = Infinity, mx = -Infinity, sum = 0;
  for (const v of arr) { if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
  return { min: +mn.toFixed(1), max: +mx.toFixed(1), mean: +(sum / arr.length).toFixed(1), n: arr.length };
}
function pctCond(arr, cond) { return +(arr.filter(cond).length / arr.length * 100).toFixed(1); }
function r2(aArr, bArr) {
  // Pearson r on paired [ts] intersection — bucket to nearest hour
  const bMap = new Map(); for (const p of bArr) bMap.set(Math.round(p[0]/3600000), p[1]);
  let sx=0,sy=0,sxy=0,sx2=0,sy2=0,n=0;
  for (const p of aArr) {
    const b = bMap.get(Math.round(p[0]/3600000));
    if (b === undefined) continue;
    sx += p[1]; sy += b; sxy += p[1]*b; sx2 += p[1]*p[1]; sy2 += b*b; n++;
  }
  const num = n*sxy - sx*sy;
  const den = Math.sqrt((n*sx2 - sx*sx) * (n*sy2 - sy*sy));
  return den === 0 ? null : +( num/den ).toFixed(3);
}

// ── VPD computation ───────────────────────────────────────────────────
function vpd(tempC, rhPct) {
  if (rhPct === null || isNaN(rhPct) || rhPct < 0) return null;
  const esat = 0.6108 * Math.exp(17.27 * tempC / (tempC + 237.3)); // kPa
  return +(esat * (1 - rhPct / 100)).toFixed(3);
}
function vpdBandPcts(pts) {
  // bands: <0.4, 0.4–0.8, 0.8–1.2, 1.2–1.8, >1.8
  const counts = [0,0,0,0,0]; let total = 0;
  for (const p of pts) {
    const v = vpd(p[1], p[2]);
    if (v === null || isNaN(v)) continue;
    total++;
    if (v < 0.4)       counts[0]++;
    else if (v < 0.8)  counts[1]++;
    else if (v < 1.2)  counts[2]++;
    else if (v < 1.8)  counts[3]++;
    else               counts[4]++;
  }
  if (!total) return [0,0,0,0,0];
  return counts.map(c => +(c/total*100).toFixed(1));
}
function vpdMean(pts) {
  let sum = 0, n = 0;
  for (const p of pts) { const v = vpd(p[1], p[2]); if (v !== null && !isNaN(v)) { sum += v; n++; } }
  return n ? +(sum/n).toFixed(2) : null;
}

// ── Diurnal averages (by hour-of-day IST = UTC+5:30) ─────────────────
const IST_OFF = 5.5 * 3600000;
function diurnalMeans(pts, fn) {
  const buckets = Array.from({length:24}, () => ({ sum:0, n:0 }));
  for (const p of pts) {
    const hoIST = Math.floor(((p[0] + IST_OFF) % 86400000) / 3600000);
    const v = typeof fn === 'function' ? fn(p) : p[fn];
    if (v === null || isNaN(v)) continue;
    buckets[hoIST].sum += v;
    buckets[hoIST].n++;
  }
  return buckets.map(b => b.n ? +(b.sum/b.n).toFixed(2) : null);
}

// ── Monthly means ─────────────────────────────────────────────────────
function monthlyMeans(pts, valFn) {
  // returns array of 12 (index 0=Jan): { t: mean, n: count } or null
  const buckets = Array.from({length:12}, () => ({ sum:0, n:0 }));
  for (const p of pts) {
    const mo = new Date(p[0]).getMonth(); // local month
    const v = typeof valFn === 'function' ? valFn(p) : p[valFn];
    if (v === null || isNaN(v)) continue;
    buckets[mo].sum += v;
    buckets[mo].n++;
  }
  return buckets.map(b => b.n ? { t: +(b.sum/b.n).toFixed(1), n: b.n } : null);
}

// ── Overnight / day delta stats ───────────────────────────────────────
// "day" = 08–18 IST, "night" = 20–06 IST
function deltaPairedHours(indoorPts, outdoorHourly) {
  // outdoorHourly: array of [tsMs, temp]
  const outMap = new Map();
  for (const p of outdoorHourly) outMap.set(Math.round(p[0]/3600000), p[1]);
  const day = [], night = [];
  for (const p of indoorPts) {
    const hrIST = Math.floor(((p[0] + IST_OFF) % 86400000) / 3600000);
    const hKey  = Math.round(p[0]/3600000);
    const out   = outMap.get(hKey);
    if (out === undefined) continue;
    const delta = p[1] - out;
    if (hrIST >= 8 && hrIST < 18)  day.push(delta);
    else                            night.push(delta);
  }
  const q = (arr, p) => { if (!arr.length) return null; const s = arr.slice().sort((a,b)=>a-b); return +(s[Math.floor(s.length*p)]).toFixed(1); };
  return {
    dayMedian: q(day, 0.5), dayQ25: q(day, 0.25), dayQ75: q(day, 0.75), nDay: day.length,
    nightMedian: q(night, 0.5), nightQ25: q(night, 0.25), nightQ75: q(night, 0.75), nNight: night.length
  };
}

// ── Fetch Open-Meteo ERA5 outdoor data ───────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 60000 }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse: ' + e.message + '\nBody: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout')); });
  });
}

async function main() {
  // ── Compute all sensor stats ─────────────────────────────────────────
  const eTemps = vals(eastPts);
  const wTemps = vals(westPts);
  const wTempsW = vals(waterPts);
  const eRh    = humVals(eastPts);
  const wRh    = humVals(westPts);

  const eastStat  = stat(eTemps);  eastStat.n  = eastPts.length;
  const westStat  = stat(wTemps);  westStat.n  = westPts.length;
  const waterStat = stat(wTempsW); waterStat.n = waterPts.length;
  const eastRhStat  = stat(eRh); eastRhStat.n  = eastPts.length;
  const westRhStat  = stat(wRh); westRhStat.n  = westPts.length;

  const eastHeat = { over40Pct: pctCond(eTemps, v => v > 40), below0Pct: pctCond(eTemps, v => v < 0) };
  const westHeat = { over40Pct: pctCond(wTemps, v => v > 40), below0Pct: pctCond(wTemps, v => v < 0) };

  const vpdEastBands = vpdBandPcts(eastPts);
  const vpdWestBands = vpdBandPcts(westPts);
  const vpdEast = { mean: vpdMean(eastPts), bandPct: vpdEastBands };
  const vpdWest = { mean: vpdMean(westPts), bandPct: vpdWestBands };

  // diurnal
  const diurnalEast    = diurnalMeans(eastPts, p => p[1]);
  const diurnalWest    = diurnalMeans(westPts, p => p[1]);
  const diurnalVpdEast = diurnalMeans(eastPts, p => vpd(p[1], p[2]));
  const diurnalVpdWest = diurnalMeans(westPts, p => vpd(p[1], p[2]));

  // monthly means
  const monthlyLabels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const moEast  = monthlyMeans(eastPts,  p => p[1]);
  const moWest  = monthlyMeans(westPts,  p => p[1]);
  const moWater = monthlyMeans(waterPts, p => p[1]);

  // correlation
  const corrR    = r2(eastPts, westPts);
  const wDiff    = westPts.length && eastPts.length ? +(wTemps.reduce((a,b)=>a+b,0)/wTemps.length - eTemps.reduce((a,b)=>a+b,0)/eTemps.length).toFixed(2) : null;

  // date range for the report period (avoid spread on huge arrays)
  let minTs = Infinity, maxTs = -Infinity;
  for (const p of eastPts) { if (p[0] < minTs) minTs = p[0]; if (p[0] > maxTs) maxTs = p[0]; }
  for (const p of westPts) { if (p[0] < minTs) minTs = p[0]; if (p[0] > maxTs) maxTs = p[0]; }

  // ── Fetch outdoor weather from Open-Meteo ERA5 ──────────────────────
  const omStart = '2025-09-01';
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
  const omEnd = yesterday.toISOString().slice(0, 10);
  const vars = [
    'temperature_2m','relative_humidity_2m',
    'soil_temperature_0_to_7cm','soil_temperature_7_to_28cm',
    'soil_temperature_28_to_100cm','soil_temperature_100_to_255cm',
    'soil_moisture_100_to_255cm',
    'direct_radiation'
  ].join(',');
  const LAT = 34.0644, LON = 77.5533;
  const omUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&start_date=${omStart}&end_date=${omEnd}&hourly=${vars}&timezone=auto`;
  console.log("Fetching Open-Meteo ERA5…");
  let outdoor = null;
  try {
    outdoor = await fetchJson(omUrl);
  } catch (e) {
    console.error("Open-Meteo fetch failed:", e.message);
  }

  // parse outdoor into arrays of [tsMs, temp]
  let outdoorHourly = [];
  let outTemp = [], outRh = [];
  let soilWinterMeans = [null,null,null,null], soilSummerMeans = [null,null,null,null];
  let deepMoisture = null, outdoorSolar = Array(24).fill(null);
  if (outdoor && outdoor.hourly) {
    const h = outdoor.hourly;
    const n = (h.time || []).length;
    const soilBuckets = Array.from({length:4}, () => ({w:{s:0,n:0}, su:{s:0,n:0}}));
    const deepMoiBuckets = {s:0,n:0};
    const solarByHour = Array.from({length:24},()=>({s:0,n:0}));
    for (let i = 0; i < n; i++) {
      const ts = Date.parse(h.time[i]);
      const t  = h.temperature_2m ? h.temperature_2m[i] : null;
      const rh = h.relative_humidity_2m ? h.relative_humidity_2m[i] : null;
      if (t !== null && !isNaN(t)) {
        outdoorHourly.push([ts, t]);
        outTemp.push(t);
        if (rh !== null && !isNaN(rh)) outRh.push(rh);
      }
      const mo = new Date(ts).getMonth(); // 0=Jan
      const soilKeys = [
        'soil_temperature_0_to_7cm','soil_temperature_7_to_28cm',
        'soil_temperature_28_to_100cm','soil_temperature_100_to_255cm'
      ];
      soilKeys.forEach((k, j) => {
        const v = h[k] ? h[k][i] : null;
        if (v === null || isNaN(v)) return;
        if (mo === 0 || mo === 1) { soilBuckets[j].w.s += v; soilBuckets[j].w.n++; }     // Jan-Feb
        if (mo === 5 || mo === 6) { soilBuckets[j].su.s += v; soilBuckets[j].su.n++; }   // Jun-Jul
      });
      const dm = h['soil_moisture_100_to_255cm'] ? h['soil_moisture_100_to_255cm'][i] : null;
      if (dm !== null && !isNaN(dm)) { deepMoiBuckets.s += dm; deepMoiBuckets.n++; }
      const sol = h['direct_radiation'] ? h['direct_radiation'][i] : null;
      const hrIST = Math.floor(((ts + IST_OFF) % 86400000) / 3600000);
      if (sol !== null && !isNaN(sol)) { solarByHour[hrIST].s += sol; solarByHour[hrIST].n++; }
    }
    soilWinterMeans = soilBuckets.map(b => b.w.n ? +(b.w.s/b.w.n).toFixed(1) : null);
    soilSummerMeans = soilBuckets.map(b => b.su.n ? +(b.su.s/b.su.n).toFixed(1) : null);
    deepMoisture    = deepMoiBuckets.n ? +(deepMoiBuckets.s/deepMoiBuckets.n).toFixed(2) : 0.36;
    outdoorSolar    = solarByHour.map(b => b.n ? +(b.s/b.n).toFixed(2) : 0);
  }

  const outdoorStat    = stat(outTemp);
  outdoorStat.n = outTemp.length;
  // winter (Jan-Feb) outdoor stats
  const outWinter = outdoorHourly.filter(p => { const mo = new Date(p[0]).getMonth(); return mo === 0 || mo === 1; });
  const outWinterNight = outWinter.filter(p => { const hr = Math.floor(((p[0]+IST_OFF)%86400000)/3600000); return hr < 6 || hr >= 20; });
  const owTemps = outWinter.map(p=>p[1]), owNTemps = outWinterNight.map(p=>p[1]);
  const outdoorWinter = {
    mean:      owTemps.length  ? +(owTemps.reduce((a,b)=>a+b,0)/owTemps.length).toFixed(1)   : null,
    nightMean: owNTemps.length ? +(owNTemps.reduce((a,b)=>a+b,0)/owNTemps.length).toFixed(1) : null,
    min:       owTemps.length  ? +(owTemps.reduce((a,b)=>Math.min(a,b), Infinity)).toFixed(1) : null
  };

  // diurnal outdoor
  const diurnalOutdoor = diurnalMeans(outdoorHourly, p => p[1]);

  // delta indoor/outdoor
  const delta = deltaPairedHours(westPts, outdoorHourly);

  // monthly outdoor
  const moOutdoor = monthlyMeans(outdoorHourly, p => p[1]);

  // correlation count
  const corrN = (() => {
    const bMap = new Map(); for (const p of westPts) bMap.set(Math.round(p[0]/3600000), true);
    return eastPts.filter(p => bMap.has(Math.round(p[0]/3600000))).length;
  })();

  // ── Build period string ──────────────────────────────────────────────
  let minTsSensor = Infinity, maxTsSensor = -Infinity;
  for (const p of eastPts) { if (p[0] < minTsSensor) minTsSensor = p[0]; if (p[0] > maxTsSensor) maxTsSensor = p[0]; }
  for (const p of westPts) { if (p[0] < minTsSensor) minTsSensor = p[0]; if (p[0] > maxTsSensor) maxTsSensor = p[0]; }
  const periodStart = new Date(minTsSensor);
  const periodEnd   = new Date(maxTsSensor);
  const fmtShort = d => d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
  const period = `${fmtShort(periodStart)} – ${fmtShort(periodEnd)}`;

  // ── Trim monthly labels to only months with data ─────────────────────
  // but keep all 12 for the chart (show nulls as gaps)

  // ── Assemble REPORT_DATA ─────────────────────────────────────────────
  const REPORT_DATA = {
    meta: {
      generated: new Date().toISOString(),
      period,
      loc: `Stok, Ladakh — ${LAT}°N ${LON}°E`
    },
    diurnal: {
      east:    diurnalEast,
      west:    diurnalWest,
      vpdEast: diurnalVpdEast,
      vpdWest: diurnalVpdWest,
      outdoor: diurnalOutdoor,
      solar:   outdoorSolar
    },
    monthly: {
      labels:  monthlyLabels,
      east:    moEast,
      west:    moWest,
      water:   moWater,
      outdoor: moOutdoor
    },
    soil: {
      depths:  ["0–7 cm","7–28 cm","28–100 cm","100–255 cm"],
      winter:  soilWinterMeans,
      summer:  soilSummerMeans,
      moisture: deepMoisture
    },
    stats: {
      east:    eastStat,
      west:    westStat,
      water:   waterStat,
      eastRh:  eastRhStat,
      westRh:  westRhStat,
      eastHeat,
      westHeat,
      vpdEast,
      vpdWest,
      corr: { r: corrR, nHours: corrN, westMinusEast: wDiff },
      outdoor: outdoorStat,
      outdoorWinter,
      delta
    }
  };

  console.log("\n── Report stats ─────────────────────────────────────────────────");
  console.log(`Period: ${period}`);
  console.log(`East: n=${eastStat.n}, mean=${eastStat.mean}°C, range=${eastStat.min}–${eastStat.max}°C`);
  console.log(`West: n=${westStat.n}, mean=${westStat.mean}°C, range=${westStat.min}–${westStat.max}°C`);
  console.log(`Water: n=${waterStat.n}, mean=${waterStat.mean}°C, range=${waterStat.min}–${waterStat.max}°C`);
  console.log(`East RH: mean=${eastRhStat.mean}%, West RH: mean=${westRhStat.mean}%`);
  console.log(`East VPD mean=${vpdEast.mean} kPa, bands=${vpdEastBands}`);
  console.log(`West VPD mean=${vpdWest.mean} kPa, bands=${vpdWestBands}`);
  console.log(`Corr r=${corrR}, West-East offset=${wDiff}°C`);
  console.log(`Delta day=${delta.dayMedian}°C (IQR ${delta.dayQ25}–${delta.dayQ75}), night=${delta.nightMedian}°C`);
  if (outdoor) {
    console.log(`Outdoor: n=${outdoorStat.n}, mean=${outdoorStat.mean}°C, range=${outdoorStat.min}–${outdoorStat.max}°C`);
    console.log(`Outdoor winter: mean=${outdoorWinter.mean}°C, night=${outdoorWinter.nightMean}°C, min=${outdoorWinter.min}°C`);
    console.log(`Soil winter: ${soilWinterMeans} | summer: ${soilSummerMeans}`);
  } else {
    console.log("⚠ No outdoor data — soil / delta stats will be null");
  }

  // ── Patch report.html ────────────────────────────────────────────────
  const reportPath = path.join(__dirname, "report.html");
  let html = fs.readFileSync(reportPath, "utf-8");

  // Replace the REPORT_DATA blob
  const newBlob = "window.REPORT_DATA = " + JSON.stringify(REPORT_DATA) + ";";
  html = html.replace(/window\.REPORT_DATA\s*=\s*\{[\s\S]*?\};/, newBlob);

  // Update the period string in the hero sub-text
  // "Jan 1 – Sep 5, 2026" → dynamic period
  const [periodFrom, periodTo] = period.split(' – ');
  html = html.replace(
    /What the sensor recorded <span class="num">[^<]*<\/span>/,
    `What the sensor recorded <span class="num">${periodFrom}&nbsp;–&nbsp;${periodTo}</span>`
  );

  fs.writeFileSync(reportPath, html, "utf-8");
  console.log("\n✓ report.html patched with fresh REPORT_DATA");
  console.log(`  Period: ${period}`);
  console.log(`  Total indoor readings: ${(eastStat.n + westStat.n + waterStat.n).toLocaleString()}`);
}

main().catch(e => { console.error(e); process.exit(1); });
