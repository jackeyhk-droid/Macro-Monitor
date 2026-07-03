#!/usr/bin/env node
/**
 * fetch-fred.mjs — bakes live macro data into macro-monitor.html
 *
 * Single backbone: FRED. Mirrors BLS CPI/CES, BEA PCE, Dallas/Cleveland/Atlanta
 * Fed alt-inflation, JOLTS, and the H.4.1 liquidity series. One API + one key.
 *
 * CPI YoY is computed from the NOT-seasonally-adjusted index (BLS/press convention);
 * MoM and 3m/6m annualized use the SA index. Net liquidity = WALCL − TGA − RRP, in $tn
 * (WALCL & TGA are FRED millions -> /1000; RRP is already $bn).
 *
 * FRED can't supply: consensus -> scripts/consensus.json ; narrative/calendar -> scripts/manual.json
 *
 *   FRED_API_KEY=xxxx node scripts/fetch-fred.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const KEY = process.env.FRED_API_KEY;
if (!KEY) { console.error("Missing FRED_API_KEY"); process.exit(1); }
const HTML = process.env.HTML_PATH || "index.html";
const CONSENSUS = process.env.CONSENSUS_PATH || "scripts/consensus.json";
const MANUAL = process.env.MANUAL_PATH || "scripts/manual.json";
const START = "//__MM_DATA_START__", END = "//__MM_DATA_END__";
const HISTORY_START = "2015-01-01";
const NL_WEEKS = 522; // ~10y weekly, mirrors the Guide to the Market dashboard

const S = {
  // CPI — SA (for MoM / momentum)
  cpiHeadline:["CPIAUCSL"], cpiCore:["CPILFESL"], cpiEnergy:["CPIENGSL"], cpiFood:["CPIUFDSL"],
  cpiShelter:["CUSR0000SAH1"], cpiCoreGoods:["CUSR0000SACL1E"], cpiCoreSvcs:["CUSR0000SASLE"],
  // CPI — NSA (for YoY, BLS/press convention)
  cpiHeadlineN:["CPIAUCNS"], cpiCoreN:["CPILFENS"], cpiEnergyN:["CPIENGNS"], cpiFoodN:["CPIUFDNS"],
  cpiShelterN:["CUUR0000SAH1"], cpiCoreGoodsN:["CUUR0000SACL1E"], cpiCoreSvcsN:["CUUR0000SASLE"],
  trimCPI:["TRMMEANCPIM159SFRBCLE"], medianCPI:["MEDCPIM159SFRBCLE"],
  stickyCPI:["CORESTICKM159SFRBATL"], flexCPI:["COREFLEXCPIM159SFRBATL"],
  // Table A line items (SA for MoM, NSA for YoY) — mirrors the BLS release summary table
  taFoodHome:["CUSR0000SAF11"], taFoodHomeN:["CUUR0000SAF11"],
  taFoodAway:["CUSR0000SEFV"], taFoodAwayN:["CUUR0000SEFV"],
  taEnCom:["CUSR0000SACE"], taEnComN:["CUUR0000SACE"],
  taGas:["CUSR0000SETB01"], taGasN:["CUUR0000SETB01"],
  taFuelOil:["CUSR0000SEHE"], taFuelOilN:["CUUR0000SEHE"],
  taEnSvc:["CUSR0000SEHF"], taEnSvcN:["CUUR0000SEHF"],
  taElec:["CUSR0000SEHF01"], taElecN:["CUUR0000SEHF01"],
  taPipedGas:["CUSR0000SEHF02"], taPipedGasN:["CUUR0000SEHF02"],
  taNewVeh:["CUSR0000SETA01"], taNewVehN:["CUUR0000SETA01"],
  taUsedCars:["CUSR0000SETA02"], taUsedCarsN:["CUUR0000SETA02"],
  taApparel:["CPIAPPSL"], taApparelN:["CPIAPPNS"],
  taMedCom:["CUSR0000SAM1"], taMedComN:["CUUR0000SAM1"],
  taTransSvc:["CUSR0000SAS4"], taTransSvcN:["CUUR0000SAS4"],
  taMedSvc:["CUSR0000SAM2"], taMedSvcN:["CUUR0000SAM2"],
  // PPI Final Demand–Intermediate Demand (SA for MoM, NSA for YoY; FRED aliases + wps/wpu codes)
  ppiFD:["PPIFIS"], ppiFDN:["PPIFID"],
  ppiGoods:["PPIDGS"], ppiGoodsN:["PPIFDG"],
  ppiFoods:["PPIDFS"], ppiFoodsN:["PPIFDF"],
  ppiEnergy:["PPIDES"], ppiEnergyN:["PPIFDE"],
  ppiGoodsX:["WPSFD413"], ppiGoodsXN:["WPUFD413"],
  ppiSvcs:["PPIDSS"], ppiSvcsN:["PPIFDS"],
  ppiTrade:["PPITSS"], ppiTradeN:["PPIDTS"],
  ppiTrans:["PPIAWS"], ppiTransN:["PPITAW"],
  ppiSvcsX:["PPITWS"], ppiSvcsXN:["PPITTW"],
  ppiConstr:["PPIDCS"], ppiConstrN:["PPIFDC"],
  ppiCore:["PPIFES"], ppiCoreN:["PPICOR"],
  ppiCoreXT:["WPSFD49116"], ppiCoreXTN:["WPUFD49116"],
  ppiIDProc:["WPSID61"], ppiIDProcN:["WPUID61"],
  ppiIDUnproc:["WPSID62"], ppiIDUnprocN:["WPUID62"],
  ppiIDSvcs:["WPSID63"], ppiIDSvcsN:["WPUID63"],
  // PCE
  pceHeadline:["PCEPI"], pceCore:["PCEPILFE"], trimPCE:["PCETRIM12M159SFRBDAL"],
  pceGoods:["DGDSRG3M086SBEA"], pceServices:["DSERRG3M086SBEA"], pceSuperServ:["IA001176M"],
  income:["PI"], dpi:["DSPI"], spend:["PCE"], savingRate:["PSAVERT"], gdpSAAR:["A191RL1Q225SBEA"],
  // Jobs
  payems:["PAYEMS"], unrate:["UNRATE"], u6:["U6RATE"], ahe:["CES0500000003"],
  partic:["CIVPART"], epop:["EMRATIO"], sahm:["SAHMCURRENT"],
  joOpen:["JTSJOL"], joHires:["JTSHIL"], joQuits:["JTSQUL"], joSep:["JTSTSL"], joQuitsRate:["JTSQUR"],
  // Jobs — sector levels (thousands)
  secLeisure:["USLAH"], secLocalGov:["CES9093000001"], secHealth:["CES6562000101"], secSocial:["CES6562400001"],
  secMfg:["MANEMP"], secProf:["USPBS"], secMining:["USMINE"], secTransWhse:["CES4300000001"],
  secConstr:["USCONS"], secRetail:["USTRADE"], secInfo:["USINFO"], secFin:["USFIRE"],
  // Liquidity (Guide to the Market)
  walcl:["WALCL"], tga:["WTREGEN"], rrp:["RRPONTSYD"], sofr:["SOFR"], iorb:["IORB"], sp500:["SP500"]
};

const api = id => `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${KEY}&file_type=json&observation_start=${HISTORY_START}`;
async function obs(id) {
  // retry transient failures (429 rate-limit, 5xx, network) with backoff; 400 = bad ID, no retry
  const waits = [0, 1500, 4000, 9000];
  let lastErr;
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await new Promise(r => setTimeout(r, waits[i]));
    try {
      const r = await fetch(api(id));
      if (r.ok) {
        const j = await r.json();
        return (j.observations || []).filter(o => o.value !== "." && o.value !== "").map(o => ({ d: o.date, v: +o.value }));
      }
      if (r.status === 400) throw new Error(`FRED ${id} -> 400 (bad series id)`);
      lastErr = new Error(`FRED ${id} -> ${r.status}`);
      if (r.status !== 429 && r.status < 500) throw lastErr;
    } catch (e) {
      if (String(e.message).includes("400")) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}
const r1 = x => (x == null || Number.isNaN(x)) ? null : Math.round(x * 10) / 10;
const r2 = x => (x == null || Number.isNaN(x)) ? null : Math.round(x * 100) / 100;
const yoy = a => { if (a.length < 2) return null; const L = a.at(-1); const b = at(a, addMonths(L.d, 12)); return b ? r1((L.v / b.v - 1) * 100) : (a.length > 12 ? r1((L.v / a.at(-13).v - 1) * 100) : null); };
const mom = a => { if (a.length < 2) return null; const L = a.at(-1); const b = at(a, addMonths(L.d, 1)) || a.at(-2); return b ? r1((L.v / b.v - 1) * 100) : null; };
const ann = (a, m) => { if (a.length <= m) return null; const L = a.at(-1); const b = at(a, addMonths(L.d, m)) || a.at(-1 - m); return b ? r1((Math.pow(L.v / b.v, 12 / m) - 1) * 100) : null; };
const addMonths = (d, n) => { if (!d) return null; let [y, m] = d.split("-").map(Number); m -= n; while (m <= 0) { m += 12; y--; } return `${y}-${String(m).padStart(2, "0")}-01`; };
const at = (a, d) => d ? (a.find(o => o.d === d) || null) : null;
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtMon = d => { const [y, m] = d.split("-"); return `${MON[+m - 1]} '${y.slice(2)}`; };
const readJSON = p => { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; } };
const asof = (arr, d) => { let r = null; for (const o of arr) { if (o.d <= d) r = o; else break; } return r ? r.v : null; };

async function main() {
  const need = [...new Set(Object.values(S).map(x => x[0]))];
  const raw = {};
  for (const id of need) {
    try { raw[id] = await obs(id); } catch (e) { console.warn("skip", id, e.message); raw[id] = []; }
    await new Promise(r => setTimeout(r, 650)); // ~115 series: stay well under FRED 120/min
  }
  // If the anchor series came back empty, FRED is unreachable or the key was rejected —
  // stop with a clear message and leave the last good index.html untouched.
  const anchors = ["CPIAUCSL", "PAYEMS", "WALCL", "PPIFIS", "PCEPI"];
  const dead = anchors.filter(id => !(raw[id] && raw[id].length));
  if (dead.length) {
    console.error(`FATAL: FRED returned no data for anchor series ${dead.join(", ")} after retries \u2014 network block, outage, or rejected key. index.html left untouched.`);
    process.exit(1);
  }
  if (!existsSync(HTML)) {
    console.error(`FATAL: ${HTML} not found at the repo root \u2014 nothing to bake into.`);
    process.exit(1);
  }
  const get = k => raw[S[k][0]] || [];
  const last = k => get(k).at(-1)?.v ?? null;
  const prior = k => get(k).at(-2)?.v ?? null;
  const chg = k => { const a = get(k); return a.length > 1 ? Math.round(a.at(-1).v - a.at(-2).v) : null; };
  const ym = k => { const d = get(k).at(-1)?.d; return d ? `${MON[+d.split("-")[1] - 1]} ${d.split("-")[0]}` : ""; };

  // CPI: YoY from NSA, MoM/momentum from SA
  const cpiYoY = (saK, nsaK) => ({ yoy: yoy(get(nsaK)), mom: mom(get(saK)), a3: ann(get(saK), 3), a6: ann(get(saK), 6) });
  const prevYoY = a => { if (a.length < 2) return null; const P = a.at(-2); const b = at(a, addMonths(P.d, 12)); return b ? r1((P.v / b.v - 1) * 100) : null; };
  const cpiH = cpiYoY("cpiHeadline", "cpiHeadlineN"), cpiC = cpiYoY("cpiCore", "cpiCoreN");
  // Supercore proxy = core services − shelter (documented approximation; component
  // weights differ so this is a proxy, not the exact BLS services-less-shelter index).
  // Compute from UNROUNDED YoY so two near-equal rounded prints don't cancel to 0.
  const rawYoY = a => { if (a.length < 2) return null; const Lp = a.at(-1); const b = at(a, addMonths(Lp.d, 12)); return b ? (Lp.v / b.v - 1) * 100 : null; };
  const rawMoM = a => { if (a.length < 2) return null; const Lp = a.at(-1); const b = at(a, addMonths(Lp.d, 1)) || a.at(-2); return b ? (Lp.v / b.v - 1) * 100 : null; };
  const csYr = rawYoY(get("cpiCoreSvcsN")), shYr = rawYoY(get("cpiShelterN"));
  const csMr = rawMoM(get("cpiCoreSvcs")), shMr = rawMoM(get("cpiShelter"));
  const cpiSuper = { yoy: (csYr != null && shYr != null) ? r1(csYr - shYr) : null,
                     mom: (csMr != null && shMr != null) ? r1(csMr - shMr) : null };
  const idxP = key => { const a = get(key); return { yoy: yoy(a), mom: mom(a), a3: ann(a, 3), a6: ann(a, 6) }; };
  const pceH = idxP("pceHeadline"), pceC = idxP("pceCore");

  const M = readJSON(MANUAL) || {};
  const regime = M.regime || { inflation: "Re-accelerating (energy/war)", labor: "Solid but narrow", fed: "On hold \u00b7 restrictive", bias: "Hike-risk skew \u00b7 no 2026 cuts priced" };
  const next = M.next || { cpi:{d:"TBD",l:"Next CPI"}, jobs:{d:"TBD",l:"Next jobs"}, pce:{d:"TBD",l:"Next PCE"}, fomc:{d:"TBD",l:"FOMC decision"} };

  const pay = get("payems");
  const nfp = chg("payems");
  const nfpPrior = pay.length > 2 ? Math.round(pay.at(-2).v - pay.at(-3).v) : null;
  const nfp3 = pay.length > 3 ? Math.round((pay.at(-1).v - pay.at(-4).v) / 3) : null;
  const lh = chg("secLeisure") ?? 0;

  const sectorDefs = [
    ["Leisure & hospitality","\u4f11\u9592\u8207\u9152\u5e97","secLeisure"], ["Local government","\u5730\u65b9\u653f\u5e9c","secLocalGov"],
    ["Health care","\u91ab\u7642\u4fdd\u5065","secHealth"], ["Social assistance","\u793e\u6703\u63f4\u52a9","secSocial"],
    ["Manufacturing","\u88fd\u9020\u696d","secMfg"], ["Prof. & business svcs","\u5c08\u696d\u8207\u5546\u696d\u670d\u52d9","secProf"],
    ["Mining & logging","\u63a1\u7926\u8207\u4f10\u6728","secMining"], ["Transport & warehousing","\u904b\u8f38\u8207\u5009\u5132","secTransWhse"],
    ["Construction","\u71df\u5efa","secConstr"], ["Retail trade","\u96f6\u552e","secRetail"],
    ["Information","\u8cc7\u8a0a","secInfo"], ["Financial activities","\u91d1\u878d\u6d3b\u52d5","secFin"]
  ];
  const sectors = sectorDefs.map(([k, tc, key]) => ({ k, tc, v: chg(key) ?? 0 })).sort((a, b) => b.v - a.v);

  // ---- Table A (BLS release summary hierarchy: 21 rows, SA MoM ×3 + NSA YoY) ----
  const TA = [
    ["All items","所有項目",0,"cpiHeadline","cpiHeadlineN"],
    ["Food","食品",1,"cpiFood","cpiFoodN"],
    ["Food at home","居家食品",2,"taFoodHome","taFoodHomeN"],
    ["Food away from home","外出用餐",2,"taFoodAway","taFoodAwayN"],
    ["Energy","能源",1,"cpiEnergy","cpiEnergyN"],
    ["Energy commodities","能源商品",2,"taEnCom","taEnComN"],
    ["Gasoline (all types)","汽油（全類型）",3,"taGas","taGasN"],
    ["Fuel oil & other fuels","燃油及其他燃料",3,"taFuelOil","taFuelOilN"],
    ["Energy services","能源服務",2,"taEnSvc","taEnSvcN"],
    ["Electricity","電力",3,"taElec","taElecN"],
    ["Utility (piped) gas","管道燃氣",3,"taPipedGas","taPipedGasN"],
    ["All items less food & energy","核心（扣除食品能源）",1,"cpiCore","cpiCoreN"],
    ["Commodities less food & energy","核心商品",2,"cpiCoreGoods","cpiCoreGoodsN"],
    ["New vehicles","新車",3,"taNewVeh","taNewVehN"],
    ["Used cars and trucks","二手車",3,"taUsedCars","taUsedCarsN"],
    ["Apparel","服飾",3,"taApparel","taApparelN"],
    ["Medical care commodities","醫療商品",3,"taMedCom","taMedComN"],
    ["Services less energy services","核心服務",2,"cpiCoreSvcs","cpiCoreSvcsN"],
    ["Shelter","居住",3,"cpiShelter","cpiShelterN"],
    ["Transportation services","運輸服務",3,"taTransSvc","taTransSvcN"],
    ["Medical care services","醫療服務",3,"taMedSvc","taMedSvcN"]
  ];
  const taDates = get("cpiHeadline").slice(-3).map(o => o.d);
  // SA first for MoM; NSA fallback (BLS shows unadjusted changes for NSA-only items)
  const momOn = (sa, nsa, d) => {
    const p = addMonths(d, 1);
    for (const arr of [sa, nsa]) {
      const a1 = at(arr, d), a0 = at(arr, p);
      if (a1 && a0) return r1((a1.v / a0.v - 1) * 100);
    }
    return null;
  };
  const yoyOn = (nsa, sa, d) => {
    const b = addMonths(d, 12);
    for (const arr of [nsa, sa]) {
      const a1 = at(arr, d), a0 = at(arr, b);
      if (a1 && a0) return r1((a1.v / a0.v - 1) * 100);
    }
    return null;
  };
  const buildBreakdown = (def, anchorKey) => {
    const dts = get(anchorKey).slice(-3).map(o => o.d);
    return {
      months: dts.map(fmtMon),
      rows: def.map(([k, tc, i, saK, nsaK]) => ({
        k, tc, i,
        yoy: yoyOn(get(nsaK), get(saK), dts.at(-1)),
        m: dts.map(d => momOn(get(saK), get(nsaK), d))
      }))
    };
  };
  const tableA = buildBreakdown(TA, "cpiHeadline");

  // ---- PPI (Final Demand–Intermediate Demand) ----
  const PT = [
    ["Final demand","最終需求",0,"ppiFD","ppiFDN"],
    ["Final demand goods","最終需求商品",1,"ppiGoods","ppiGoodsN"],
    ["Foods","食品",2,"ppiFoods","ppiFoodsN"],
    ["Energy","能源",2,"ppiEnergy","ppiEnergyN"],
    ["Goods less foods & energy","商品（扣除食品能源）",2,"ppiGoodsX","ppiGoodsXN"],
    ["Final demand services","最終需求服務",1,"ppiSvcs","ppiSvcsN"],
    ["Trade services (margins)","貿易服務（利潤率）",2,"ppiTrade","ppiTradeN"],
    ["Transportation & warehousing","運輸與倉儲",2,"ppiTrans","ppiTransN"],
    ["Services less trade, transp. & whse.","服務（扣除貿易運輸倉儲）",2,"ppiSvcsX","ppiSvcsXN"],
    ["Final demand construction","最終需求營建",1,"ppiConstr","ppiConstrN"],
    ["Less foods & energy (core)","核心（扣除食品能源）",1,"ppiCore","ppiCoreN"],
    ["Less foods, energy & trade svcs","核心（扣除食品能源貿易）",1,"ppiCoreXT","ppiCoreXTN"]
  ];
  const PID = [
    ["Processed goods for intermediate demand","中間需求：加工品",0,"ppiIDProc","ppiIDProcN"],
    ["Unprocessed goods for intermediate demand","中間需求：未加工品",0,"ppiIDUnproc","ppiIDUnprocN"],
    ["Services for intermediate demand","中間需求：服務",0,"ppiIDSvcs","ppiIDSvcsN"]
  ];
  const ppiTable = buildBreakdown(PT, "ppiFD");
  const ppiID = buildBreakdown(PID, "ppiFD");

  // ---- Net liquidity (Guide to the Market): NL = WALCL/1000 - TGA/1000 - RRP, in $bn ----
  const wal = get("walcl"), tg = get("tga"), rr = get("rrp"), spx = get("sp500");
  const nlBnAt = w => w.v / 1000 - (asof(tg, w.d) ?? 0) / 1000 - (asof(rr, w.d) ?? 0);
  const wk = wal.slice(-NL_WEEKS);
  const nlSeries = { labels: wk.map(w => fmtMon(w.d)), nl: wk.map(w => r2(nlBnAt(w) / 1000)), spx: wk.map(w => { const s = asof(spx, w.d); return s ? Math.round(s) : null; }) };
  const nlBn = wal.length ? nlBnAt(wal.at(-1)) : null;
  const nlTn = nlBn == null ? null : r2(nlBn / 1000);
  const zone = nlTn == null ? { k: "na", en: "—", tc: "—" }
    : nlTn >= 6.0 ? { k: "up", en: "Supportive", tc: "\u5145\u88d5" }
    : nlTn >= 5.5 ? { k: "am", en: "Uncomfortable", tc: "\u504f\u7dca" }
    : { k: "dn", en: "Stress", tc: "\u58d3\u529b" };
  const sofrIorb = (last("sofr") != null && last("iorb") != null) ? Math.round((last("sofr") - last("iorb")) * 100) : null;

  const DATA = {
    meta: { asof: { cpi: ym("cpiHeadline"), jobs: ym("payems"), pce: ym("pceHeadline") },
            updated: new Date().toISOString().slice(0, 10), note: "Auto-generated from FRED", next },
    regime,
    nl: {
      tn: nlTn, value: r1(nlBn), zone,
      walcl: r2(last("walcl") / 1000000), tga: r2(last("tga") / 1000000), rrp: r1(last("rrp")),
      sofrIorb, spx: last("sp500") ? Math.round(last("sp500")) : null,
      series: nlSeries
    },
    cpi: {
      headline: { yoy: cpiH.yoy, mom: cpiH.mom, prevYoY: prevYoY(get("cpiHeadlineN")), consYoY: null, consMoM: null, ann3m: cpiH.a3, ann6m: cpiH.a6 },
      core: { yoy: cpiC.yoy, mom: cpiC.mom, prevYoY: prevYoY(get("cpiCoreN")), consYoY: null, consMoM: null, ann3m: cpiC.a3, ann6m: cpiC.a6 },
      supercore: cpiSuper,
      realWages: M.realWages || { yoy: null, mom: null },
      components: [
        { k: "Shelter", tc: "\u5c45\u4f4f", yoy: yoy(get("cpiShelterN")), mom: mom(get("cpiShelter")), n: "" },
        { k: "Energy", tc: "\u80fd\u6e90", yoy: yoy(get("cpiEnergyN")), mom: mom(get("cpiEnergy")), n: "" },
        { k: "Food", tc: "\u98df\u54c1", yoy: yoy(get("cpiFoodN")), mom: mom(get("cpiFood")), n: "" },
        { k: "Core goods", tc: "\u6838\u5fc3\u5546\u54c1", yoy: yoy(get("cpiCoreGoodsN")), mom: mom(get("cpiCoreGoods")), n: "" },
        { k: "Core services", tc: "\u6838\u5fc3\u670d\u52d9", yoy: yoy(get("cpiCoreSvcsN")), mom: mom(get("cpiCoreSvcs")), n: "" }
      ],
      alt: { trimmedMean: r1(last("trimCPI")), sticky: r1(last("stickyCPI")), flexible: r1(last("flexCPI")), median: r1(last("medianCPI")) },
      tableA,
      series: tail(get("cpiHeadlineN"), get("cpiCoreN"), 18)
    },
    ppi: {
      asof: ym("ppiFD"),
      headline: { yoy: yoy(get("ppiFDN")), mom: mom(get("ppiFD")), prevYoY: prevYoY(get("ppiFDN")), consYoY: null, consMoM: null, ann3m: ann(get("ppiFD"), 3), ann6m: ann(get("ppiFD"), 6) },
      core: { yoy: yoy(get("ppiCoreN")), mom: mom(get("ppiCore")), ann3m: ann(get("ppiCore"), 3), ann6m: ann(get("ppiCore"), 6) },
      coreXT: { yoy: yoy(get("ppiCoreXTN")), mom: mom(get("ppiCoreXT")) },
      goods: { yoy: yoy(get("ppiGoodsN")), mom: mom(get("ppiGoods")) },
      services: { yoy: yoy(get("ppiSvcsN")), mom: mom(get("ppiSvcs")) },
      tableA: ppiTable,
      intermediate: ppiID,
      series: tail(get("ppiFDN"), get("ppiCoreXTN"), 18)
    },
    jobs: {
      nfp: { actual: nfp, prior: nfpPrior, cons: null, ann3m: nfp3 },
      unrate: { actual: last("unrate"), prior: prior("unrate"), cons: null },
      u6: { actual: last("u6") },
      ahe: { yoy: idxP("ahe").yoy, mom: idxP("ahe").mom, level: r2(last("ahe")) },
      partic: { actual: last("partic") }, epop: { actual: last("epop") },
      diffusion: { actual: M.diffusion ?? null },
      sahm: { actual: r2(last("sahm")) ?? 0, trigger: 0.5 },
      revisions: M.revisions || [],
      jolts: { asof: ym("joOpen"), openings: r1(last("joOpen") / 1000), hires: r1(last("joHires") / 1000),
               quits: r1(last("joQuits") / 1000), quitsRate: last("joQuitsRate"), separations: r1(last("joSep") / 1000) },
      sectors,
      worldCup: { lhTotal: lh, lhTrend: M.worldCupTrend ?? 14, exLH: nfp != null ? nfp - lh : null, note: (M.worldCupNote && (M.worldCupNote.en || M.worldCupNote.tc)) ? M.worldCupNote : null },
      series: tailSingle(pay, 6)
    },
    pce: {
      headline: { yoy: pceH.yoy, mom: pceH.mom, prevYoY: prevYoY(get("pceHeadline")), consYoY: null, consMoM: null, ann3m: pceH.a3, ann6m: pceH.a6 },
      core: { yoy: pceC.yoy, mom: pceC.mom, prevYoY: prevYoY(get("pceCore")), consYoY: null, consMoM: null, ann3m: pceC.a3, ann6m: pceC.a6 },
      supercore: { yoy: yoy(get("pceSuperServ")) ?? (cpiSuper.yoy != null ? r1(cpiSuper.yoy - 0.3) : null), mom: idxP("pceSuperServ").mom },
      trimmedMean: { yoy: r1(last("trimPCE")) },
      goods: { mom: idxP("pceGoods").mom }, services: { mom: idxP("pceServices").mom },
      income: { mom: idxP("income").mom }, dpi: { mom: idxP("dpi").mom }, spending: { mom: idxP("spend").mom },
      savingRate: { actual: last("savingRate") },
      gdp: { q: M.gdpQuarter || "latest", saar: last("gdpSAAR") },
      nowcast: { coreNext: nowcastCorePCE(cpiC, pceC) },
      series: tail(get("pceHeadline"), get("pceCore"), 18)
    }
  };

  if (existsSync(CONSENSUS)) {
    const c = readJSON(CONSENSUS) || {};
    for (const [p, v] of Object.entries(c)) setPath(DATA, p, v);
    console.log(`consensus: applied ${Object.keys(c).length} overrides`);
  }

  const html = readFileSync(HTML, "utf8");
  const block = `${START}\nconst DATA = ${JSON.stringify(DATA, null, 2)};\n${END}`;
  writeFileSync(HTML, html.replace(new RegExp(escapeRe(START) + "[\\s\\S]*?" + escapeRe(END)), () => block));
  console.log(`baked ${HTML} \u2014 CPI ${DATA.meta.asof.cpi} \u00b7 PPI ${DATA.ppi.asof} \u00b7 Jobs ${DATA.meta.asof.jobs} \u00b7 PCE ${DATA.meta.asof.pce} \u00b7 NL $${DATA.nl.tn}T (${DATA.nl.zone.en})`);
}

function tail(hA, cA, n) {
  const labels = [], headline = [], core = [];
  const a2 = (a, d) => a.find(o => o.d === d) || null;
  const ago = d => { const [y, m] = d.split("-"); return `${+y - 1}-${m}-01`; };
  for (let i = Math.max(0, hA.length - n); i < hA.length; i++) {
    const o = hA[i], [y, mm] = o.d.split("-");
    labels.push(`${MON[+mm - 1]} '${y.slice(2)}`);
    const hb = a2(hA, ago(o.d)); headline.push(hb ? r1((o.v / hb.v - 1) * 100) : null);
    const cv = a2(cA, o.d), cb = a2(cA, ago(o.d)); core.push(cv && cb ? r1((cv.v / cb.v - 1) * 100) : null);
  }
  return { labels, headline, core };
}
function tailSingle(pay, n) {
  const labels = [], nfp = [];
  for (let i = Math.max(1, pay.length - n); i < pay.length; i++) {
    labels.push(fmtMon(pay[i].d)); nfp.push(Math.round(pay[i].v - pay[i - 1].v));
  }
  return { labels, nfp };
}
function nowcastCorePCE(cpiC, pceC) {
  if (cpiC.yoy == null || pceC.yoy == null) return null;
  return Math.round((0.55 * cpiC.yoy + 0.45 * pceC.yoy - 0.1) * 10) / 10;
}
function setPath(o, p, v) { const k = p.split("."); let c = o; for (let i = 0; i < k.length - 1; i++) c = (c[k[i]] ??= {}); c[k.at(-1)] = v; }
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

main().catch(e => { console.error(e); process.exit(1); });
