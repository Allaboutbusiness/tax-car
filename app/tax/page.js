"use client";

import { useState, useRef, useCallback } from "react";
import { loadRules, saveRules, addRule, applyRules, CATEGORIES } from "../../lib/rules";
import BottomNav from "../../components/BottomNav";

const DATA_KEY = (year) => `tax_data_${year}`;
const CONFIG_KEY = "tax_config";
const WITHHOLDING = 0.033;

function fmt(n) { return Number(n || 0).toLocaleString("ko-KR"); }

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}"); } catch { return {}; }
}
function saveConfig(cfg) { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }
function loadData(year) {
  try { return JSON.parse(localStorage.getItem(DATA_KEY(year)) || "[]"); } catch { return []; }
}
function saveData(year, data) { localStorage.setItem(DATA_KEY(year), JSON.stringify(data)); }

// XLS 파싱 (xlsx 라이브러리 사용)
async function parseKBBank(file) {
  const { read, utils } = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = utils.sheet_to_json(ws, { header: 1, raw: false });
  const results = [];
  for (let i = 5; i < rows.length - 1; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    const dateRaw = String(row[0]).replace(/\./g, "-").slice(0, 10);
    const out = parseInt(String(row[4] || "0").replace(/,/g, "")) || 0;
    const inAmt = parseInt(String(row[5] || "0").replace(/,/g, "")) || 0;
    if (out === 0 && inAmt === 0) continue;
    results.push({
      id: `bank_${i}_${Date.now()}`,
      date: dateRaw,
      type: String(row[1] || "").trim(),
      memo: String(row[2] || "").trim(),
      out, in: inAmt,
      amount: out || inAmt,
      source: "bank",
    });
  }
  return results;
}

async function parseShinhanCard(file) {
  const { read, utils } = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = utils.sheet_to_json(ws, { header: 1, raw: false });
  const results = [];
  for (let i = 5; i < rows.length - 2; i++) {
    const row = rows[i];
    const dateRaw = String(row[0] || "").replace(/\./g, "-").slice(0, 10);
    if (!dateRaw || dateRaw.length < 10) continue;
    const merchant = String(row[5] || "").trim();
    if (!merchant) continue;
    const amount = parseInt(String(row[6] || "0").replace(/,/g, "")) || 0;
    if (amount <= 0) continue;
    if (String(row).includes("취소")) continue;
    results.push({
      id: `card_${i}_${Date.now()}`,
      date: dateRaw,
      merchant,
      amount,
      out: amount, in: 0,
      source: "card",
    });
  }
  return results;
}

async function categorizeWithAI(unmatched) {
  if (!unmatched.length) return [];
  try {
    const r = await fetch("/api/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: unmatched }),
    });
    const { results } = await r.json();
    return results;
  } catch {
    return unmatched.map(tx => ({ id: tx.id, category: "미분류", type: "unclassified", method: "unclassified" }));
  }
}

async function exportExcel(txs, carRatio, year) {
  const { utils, write } = await import("xlsx");
  const wb = utils.book_new();

  // Sheet 1: 매출장
  const income = txs.filter(t => t.type === "income");
  const salesRows = [["날짜", "거래처", "입금액(세후)", "총수입금액(세전)", "원천징수세액"]];
  let totalNet = 0;
  income.forEach(t => {
    const net = t.in || 0;
    const gross = Math.round(net / (1 - WITHHOLDING));
    totalNet += net;
    salesRows.push([t.date, t.memo || t.merchant || "", net, gross, gross - net]);
  });
  const totalGross = Math.round(totalNet / (1 - WITHHOLDING));
  salesRows.push(["합계", "", totalNet, totalGross, totalGross - totalNet]);
  utils.book_append_sheet(wb, utils.aoa_to_sheet(salesRows), "매출장");

  // Sheet 2: 매입장
  const expenses = txs.filter(t => t.type === "expense");
  const expRows = [["날짜", "거래처", "카테고리", "원금액", "업무비율", "인정금액", "출처"]];
  let totalApproved = 0;
  expenses.forEach(t => {
    const amt = t.amount || Math.max(t.out || 0, t.in || 0);
    const ratio = t.category === "차량유지비" ? carRatio : 100;
    const approved = Math.round(amt * ratio / 100);
    totalApproved += approved;
    expRows.push([t.date, t.merchant || t.memo || "", t.category, amt, `${ratio}%`, approved, t.source === "card" ? "카드" : "통장"]);
  });
  expRows.push(["합계", "", "", "", "", totalApproved, ""]);
  utils.book_append_sheet(wb, utils.aoa_to_sheet(expRows), "매입장(필요경비)");

  // Sheet 3: 월별요약
  const monthlyIncome = {}, monthlyExp = {};
  for (let m = 1; m <= 12; m++) { monthlyIncome[m] = 0; monthlyExp[m] = 0; }
  income.forEach(t => { const m = parseInt(t.date?.slice(5, 7)); if (m) monthlyIncome[m] += t.in || 0; });
  expenses.forEach(t => {
    const m = parseInt(t.date?.slice(5, 7));
    if (!m) return;
    const amt = t.amount || Math.max(t.out || 0, t.in || 0);
    const ratio = t.category === "차량유지비" ? carRatio : 100;
    monthlyExp[m] += Math.round(amt * ratio / 100);
  });
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const summaryRows = [
    ["구분", ...months.map(m => `${m}월`), "연간합계"],
    ["수입(세후)", ...months.map(m => monthlyIncome[m]), months.reduce((s, m) => s + monthlyIncome[m], 0)],
    ["필요경비", ...months.map(m => monthlyExp[m]), months.reduce((s, m) => s + monthlyExp[m], 0)],
    ["소득금액", ...months.map(m => Math.round(monthlyIncome[m] / (1 - WITHHOLDING)) - monthlyExp[m]),
      Math.round(totalNet / (1 - WITHHOLDING)) - totalApproved],
  ];
  utils.book_append_sheet(wb, utils.aoa_to_sheet(summaryRows), "월별요약");

  // Sheet 4: 미분류
  const uncl = txs.filter(t => t.category === "미분류");
  const unclRows = [["날짜", "거래처/메모", "금액", "출처"], ...uncl.map(t => [t.date, t.merchant || t.memo || "", t.amount || Math.max(t.out || 0, t.in || 0), t.source === "card" ? "카드" : "통장"])];
  utils.book_append_sheet(wb, utils.aoa_to_sheet(unclRows), "미분류(검토필요)");

  const buf = write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `세무정리_${year}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 홈택스 지급명세서 파싱 ──────────────────────────────
async function parseHometax(file) {
  const { read, utils } = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map(c => String(c || "").trim());
    const nums = row.filter(c => /^[\d,]+$/.test(c.replace(/,/g, "")) && c.length > 3);
    if (nums.length < 2) continue;
    const name = row.find(c => c.length > 1 && !/^[\d,.\-]+$/.test(c) && c !== "");
    if (!name) continue;
    const amounts = row
      .map(c => parseInt(c.replace(/,/g, "")) || 0)
      .filter(n => n > 10000);
    if (!amounts.length) continue;
    const gross = Math.max(...amounts);
    const tax = amounts.find(n => n !== gross && n < gross) || Math.round(gross * WITHHOLDING);
    const net = gross - tax;
    results.push({ payer: name, gross, tax, net });
  }
  return results;
}

// ── 크로스체크 로직 ──────────────────────────────────────
function crossCheck(hometaxItems, txs) {
  const bankIncomeTotal = txs
    .filter(t => t.type === "income")
    .reduce((s, t) => s + (t.in || 0), 0);
  const hometaxGrossTotal = hometaxItems.reduce((s, i) => s + i.gross, 0);
  const hometaxNetTotal = hometaxItems.reduce((s, i) => s + i.net, 0);
  const bankGrossCalc = Math.round(bankIncomeTotal / (1 - WITHHOLDING));
  const diff = bankGrossCalc - hometaxGrossTotal;
  const diffPct = hometaxGrossTotal > 0
    ? Math.abs(diff / hometaxGrossTotal * 100).toFixed(1)
    : 0;
  return {
    bankNet: bankIncomeTotal,
    bankGross: bankGrossCalc,
    hometaxGross: hometaxGrossTotal,
    hometaxNet: hometaxNetTotal,
    diff,
    diffPct,
    ok: Math.abs(diff) < 10000,
    items: hometaxItems,
  };
}

// ── 컴포넌트 ────────────────────────────────────────────
export default function TaxPage() {
  const thisYear = new Date().getFullYear().toString();
  const [year, setYear] = useState(thisYear);
  const [txs, setTxs] = useState([]);
  const [carRatio, setCarRatio] = useState(() => loadConfig().car_business_ratio || 80);
  const [filter, setFilter] = useState("all");
  const [colFilters, setColFilters] = useState({ date: "", name: "", source: "", category: "", method: "", type: "" });
  const [showColFilter, setShowColFilter] = useState(false);
  const [tab, setTab] = useState("upload");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const bankRef = useRef();
  const cardRef = useRef();
  const [bankName, setBankName] = useState("");
  const [cardName, setCardName] = useState("");
  const [rules, setRulesState] = useState(() => { try { return loadRules(); } catch { return []; } });
  const hometaxRef = useRef();
  const [hometaxName, setHometaxName] = useState("");
  const [hometaxResult, setHometaxResult] = useState(null);
  const [hometaxLoading, setHometaxLoading] = useState(false);
  const mergeRef = useRef();
  const [mergeFileNames, setMergeFileNames] = useState([]);
  const [mergeStatus, setMergeStatus] = useState("");
  const [mergeLoading, setMergeLoading] = useState(false);

  const loadTxs = useCallback((y) => {
    const data = loadData(y || year);
    setTxs(data);
    return data;
  }, [year]);

  const handleTab = (t) => {
    setTab(t);
    if (t === "review" || t === "export" || t === "hometax") loadTxs(year);
  };

  async function analyzeHometax() {
    const file = hometaxRef.current?.files[0];
    if (!file) { return; }
    setHometaxLoading(true);
    try {
      const items = await parseHometax(file);
      const current = loadData(year);
      setHometaxResult(crossCheck(items, current));
    } catch (e) {
      alert("파싱 오류: " + e.message);
    } finally {
      setHometaxLoading(false);
    }
  }

  async function mergeExcels() {
    const files = Array.from(mergeRef.current?.files || []);
    if (!files.length) { setMergeStatus("파일을 선택해주세요."); return; }
    setMergeLoading(true);
    setMergeStatus("파일 읽는 중...");
    try {
      const { read, utils, write } = await import("xlsx");
      let allIncome = [], allExpense = [];

      for (const file of files) {
        const buf = await file.arrayBuffer();
        const wb = read(buf, { type: "array" });

        const salesSheet = wb.Sheets["매출장"];
        if (salesSheet) {
          const rows = utils.sheet_to_json(salesSheet, { header: 1, raw: false, defval: "" });
          for (let i = 1; i < rows.length - 1; i++) {
            const r = rows[i];
            const date = String(r[0] || "").trim();
            const name = String(r[1] || "").trim();
            const net = parseInt(String(r[2] || "0").replace(/,/g, "")) || 0;
            if (!date || !name || net === 0) continue;
            allIncome.push({ date, name, net });
          }
        }

        const expSheet = wb.Sheets["매입장(필요경비)"];
        if (expSheet) {
          const rows = utils.sheet_to_json(expSheet, { header: 1, raw: false, defval: "" });
          for (let i = 1; i < rows.length - 1; i++) {
            const r = rows[i];
            const date = String(r[0] || "").trim();
            const name = String(r[1] || "").trim();
            const cat = String(r[2] || "").trim();
            const amt = parseInt(String(r[3] || "0").replace(/,/g, "")) || 0;
            const ratioStr = String(r[4] || "100%");
            const ratio = parseInt(ratioStr) || 100;
            const src = String(r[6] || "").trim();
            if (!date || !name || amt === 0) continue;
            allExpense.push({ date, name, cat, amt, ratio, src });
          }
        }
      }

      // 중복 제거
      const incomeKeys = new Set();
      const dedupedIncome = allIncome.filter(r => {
        const k = `${r.date}|${r.name}|${r.net}`;
        if (incomeKeys.has(k)) return false;
        incomeKeys.add(k); return true;
      });
      const expKeys = new Set();
      const dedupedExp = allExpense.filter(r => {
        const k = `${r.date}|${r.name}|${r.amt}`;
        if (expKeys.has(k)) return false;
        expKeys.add(k); return true;
      });

      // 엑셀 생성
      const wb2 = utils.book_new();

      const salesRows = [["날짜", "거래처", "입금액(세후)", "총수입금액(세전)", "원천징수세액"]];
      let totalNet = 0;
      [...dedupedIncome].sort((a, b) => a.date.localeCompare(b.date)).forEach(r => {
        const gross = Math.round(r.net / (1 - WITHHOLDING));
        totalNet += r.net;
        salesRows.push([r.date, r.name, r.net, gross, gross - r.net]);
      });
      const totalGross = Math.round(totalNet / (1 - WITHHOLDING));
      salesRows.push(["합계", "", totalNet, totalGross, totalGross - totalNet]);
      utils.book_append_sheet(wb2, utils.aoa_to_sheet(salesRows), "매출장");

      const expRows = [["날짜", "거래처", "카테고리", "원금액", "업무비율", "인정금액", "출처"]];
      let totalApproved = 0;
      [...dedupedExp].sort((a, b) => a.date.localeCompare(b.date)).forEach(r => {
        const approved = Math.round(r.amt * r.ratio / 100);
        totalApproved += approved;
        expRows.push([r.date, r.name, r.cat, r.amt, `${r.ratio}%`, approved, r.src]);
      });
      expRows.push(["합계", "", "", "", "", totalApproved, ""]);
      utils.book_append_sheet(wb2, utils.aoa_to_sheet(expRows), "매입장(필요경비)");

      const buf2 = write(wb2, { type: "array", bookType: "xlsx" });
      const blob = new Blob([buf2], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.download = `세무정리_합치기_${year}.xlsx`;
      a.href = url; a.click();
      URL.revokeObjectURL(url);
      setMergeStatus(`✅ 완료! 매출 ${dedupedIncome.length}건, 매입 ${dedupedExp.length}건 합쳐서 다운로드`);
    } catch (e) {
      setMergeStatus("❌ 오류: " + e.message);
    } finally {
      setMergeLoading(false);
    }
  }

  async function analyze() {
    const bankFile = bankRef.current?.files[0];
    const cardFile = cardRef.current?.files[0];
    if (!bankFile && !cardFile) { setStatus("파일을 선택해주세요."); return; }

    saveConfig({ car_business_ratio: carRatio });
    setLoading(true);
    setProgress(10);
    setStatus("파일 파싱 중...");

    try {
      let newTxs = [];
      if (bankFile) {
        const parsed = await parseKBBank(bankFile);
        newTxs.push(...parsed);
      }
      if (cardFile) {
        const parsed = await parseShinhanCard(cardFile);
        newTxs.push(...parsed);
      }
      setProgress(40);
      setStatus(`${newTxs.length}건 파싱 완료. 규칙 적용 중...`);

      const currentRules = loadRules();
      const matched = [], unmatched = [];
      newTxs.forEach(tx => {
        const result = applyRules(tx, currentRules);
        if (result) matched.push({ ...tx, ...result });
        else unmatched.push(tx);
      });

      setProgress(60);
      setStatus(`규칙 ${matched.length}건 완료. AI 분류 중 (${unmatched.length}건)...`);

      const aiResults = await categorizeWithAI(unmatched);
      const aiMap = Object.fromEntries(aiResults.map(r => [r.id, r]));
      const allCategorized = [
        ...matched,
        ...unmatched.map(tx => ({ ...tx, ...(aiMap[tx.id] || { category: "미분류", type: "unclassified", method: "unclassified" }) })),
      ];

      const existing = loadData(year);
      const existingKeys = new Set(existing.map(t => `${t.date}|${t.memo || t.merchant}|${t.amount || t.in || t.out}`));
      const deduped = allCategorized.filter(t => !existingKeys.has(`${t.date}|${t.memo || t.merchant}|${t.amount || t.in || t.out}`));
      const merged = [...existing, ...deduped].sort((a, b) => a.date.localeCompare(b.date));

      saveData(year, merged);
      setTxs(merged);
      setProgress(100);
      setStatus(`✅ 완료! 전체 ${merged.length}건 (신규 ${deduped.length}건)`);
      setTab("review");
    } catch (e) {
      setStatus("❌ 오류: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveUpdate(tx, newCat, keyword) {
    const typeMap = { "보험수수료 수입": "income", "기타사업소득": "income", "개인지출": "exclude" };
    const newType = typeMap[newCat] || "expense";
    const updated = txs.map(t => t.id === tx.id ? { ...t, category: newCat, type: newType, method: "manual" } : t);
    setTxs(updated);
    saveData(year, updated);
    if (keyword?.trim()) {
      const newRules = addRule(rules, keyword.trim(), newCat, newType);
      setRulesState(newRules);
      saveRules(newRules);
    }
  }

  const filtered = txs.filter(t => {
    if (filter === "all") return true;
    if (filter === "unclassified") return t.category === "미분류";
    return t.method === filter;
  });

  const displayedTxs = filtered.filter(t => {
    const name = t.merchant || t.memo || "";
    if (colFilters.date && !t.date?.startsWith(colFilters.date)) return false;
    if (colFilters.name && !name.toLowerCase().includes(colFilters.name.toLowerCase())) return false;
    if (colFilters.source) {
      const srcLabel = t.source === "card" ? "카드" : "통장";
      if (srcLabel !== colFilters.source) return false;
    }
    if (colFilters.category && t.category !== colFilters.category) return false;
    if (colFilters.method && t.method !== colFilters.method) return false;
    if (colFilters.type) {
      const typeLabel = t.type === "income" ? "매출" : t.type === "exclude" ? "제외" : "매입";
      if (typeLabel !== colFilters.type) return false;
    }
    return true;
  });

  const entertainmentTotal = txs.filter(t => t.category === "접대비").reduce((s, t) => s + (t.amount || Math.max(t.out || 0, t.in || 0)), 0);
  const incomeTotal = txs.filter(t => t.type === "income").reduce((s, t) => s + (t.in || 0), 0);
  const expenseTotal = txs.filter(t => t.type === "expense").reduce((s, t) => {
    const amt = t.amount || Math.max(t.out || 0, t.in || 0);
    return s + Math.round(amt * (t.category === "차량유지비" ? carRatio : 100) / 100);
  }, 0);
  const grossIncome = Math.round(incomeTotal / (1 - WITHHOLDING));

  // 컬럼 필터용 유니크 값
  const uniqueMonths = [...new Set(txs.map(t => t.date?.slice(0, 7)).filter(Boolean))].sort();
  const uniqueCategories = [...new Set(txs.map(t => t.category).filter(Boolean))].sort();

  const hasColFilter = Object.values(colFilters).some(v => v !== "");

  const ss = {
    wrap: { minHeight: "100vh", background: "#f0f4ff" },
    header: { background: "#1565c0", color: "#fff", padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 },
    back: { color: "#fff", textDecoration: "none", fontSize: 20, marginRight: 4 },
    tabs: { display: "flex", background: "#fff", borderBottom: "2px solid #e0e7ff", overflowX: "auto" },
    tab: (active) => ({ padding: "12px 18px", cursor: "pointer", fontSize: 14, fontWeight: active ? 700 : 400, color: active ? "#1565c0" : "#888", borderBottom: active ? "3px solid #1565c0" : "3px solid transparent", whiteSpace: "nowrap", background: "none", border: "none", borderBottom: active ? "3px solid #1565c0" : "3px solid transparent" }),
    panel: { padding: "16px", maxWidth: 900, margin: "0 auto" },
    card: { background: "#fff", borderRadius: 12, padding: 18, marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,.07)" },
    btn: (bg) => ({ background: bg, color: "#fff", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }),
    input: { padding: "8px 12px", border: "1.5px solid #c5cae9", borderRadius: 8, fontSize: 14, width: "100%", boxSizing: "border-box" },
    filterInput: { padding: "4px 6px", border: "1.5px solid #90caf9", borderRadius: 6, fontSize: 11, width: "100%", boxSizing: "border-box", background: "#f0f8ff" },
  };

  return (
    <div style={ss.wrap}>
      <div style={ss.header}>
        <a href="/" style={ss.back}>←</a>
        <span style={{ fontSize: 20 }}>📊</span>
        <strong style={{ fontSize: 16 }}>세무 정리</strong>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <select value={year} onChange={e => { setYear(e.target.value); loadTxs(e.target.value); }}
              style={{ padding: "4px 8px", borderRadius: 6, border: "none", fontSize: 13 }}>
              {Array.from({ length: 57 }, (_, i) => 2020 + i).map(y => <option key={y} value={String(y)}>{y}년</option>)}
            </select>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>
              {txs.length > 0 ? `${txs.length}건 저장됨` : "데이터 없음"}
            </span>
          </div>
        </div>
      </div>

      <div style={ss.tabs}>
        {[["upload","① 업로드"],["review","② 분류검토"],["export","③ 내보내기"],["hometax","④ 홈택스검증"],["merge","⑤ 합치기"]].map(([t,l]) => (
          <button key={t} style={ss.tab(tab===t)} onClick={() => handleTab(t)}>{l}</button>
        ))}
      </div>

      {/* ① 업로드 */}
      {tab === "upload" && (
        <div style={ss.panel}>
          <div style={{ background: "#e3f2fd", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#1565c0", lineHeight: 1.7 }}>
            💡 <strong>{year}년 데이터 업로드</strong> — 업로드한 파일은 <strong>{year}년 데이터</strong>로 누적 저장됩니다.<br />
            분기별·월별로 나눠서 올려도 자동으로 합쳐집니다. 중복은 자동 제거됩니다.
          </div>
          <div style={ss.card}>
            <h3 style={{ color: "#1565c0", marginBottom: 14, fontSize: 15 }}>📁 파일 업로드</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <DropZone icon="🏦" label="국민은행 XLS" name={bankName} inputRef={bankRef}
                onChange={e => setBankName(e.target.files[0]?.name || "")} />
              <DropZone icon="💳" label="신한카드 XLS" name={cardName} inputRef={cardRef}
                onChange={e => setCardName(e.target.files[0]?.name || "")} />
            </div>
          </div>

          <div style={ss.card}>
            <h3 style={{ color: "#1565c0", marginBottom: 10, fontSize: 15 }}>🚗 차량비 업무 비율</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input type="range" min={50} max={100} value={carRatio}
                onChange={e => setCarRatio(Number(e.target.value))} style={{ flex: 1 }} />
              <span style={{ fontSize: 22, fontWeight: 700, color: "#1565c0", minWidth: 50 }}>{carRatio}%</span>
            </div>
            <div style={{ fontSize: 12, color: "#e65100", background: "#fff3e0", padding: "8px 12px", borderRadius: 6, marginTop: 10 }}>
              ⚠ 100% 적용은 세무조사 위험이 있습니다. 차량운행일지 작성 시 100%까지 인정받을 수 있습니다.
            </div>
          </div>

          <button style={ss.btn(loading ? "#aaa" : "#1565c0")} disabled={loading} onClick={analyze}>
            {loading ? "⏳ 분석 중..." : "📊 분석 시작"}
          </button>
          {status && (
            <div style={{ marginTop: 12 }}>
              <div style={{ height: 6, background: "#e0e7ff", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progress}%`, background: "#1565c0", transition: "width .4s", borderRadius: 4 }} />
              </div>
              <div style={{ fontSize: 12, color: "#555", marginTop: 6 }}>{status}</div>
            </div>
          )}
        </div>
      )}

      {/* ② 분류검토 */}
      {tab === "review" && (
        <div style={ss.panel}>
          {entertainmentTotal > 0 && (
            <div style={{ background: entertainmentTotal > 12000000 ? "#ffebee" : "#fff3e0", border: `1.5px solid ${entertainmentTotal > 12000000 ? "#c62828" : "#ffb300"}`, borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
              접대비 누계: <strong>{fmt(entertainmentTotal)}원</strong> / 한도 12,000,000원
              {entertainmentTotal > 12000000 && <span style={{ color: "#c62828", fontWeight: 700 }}> ⚠ 한도 초과!</span>}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
            {[["all","전체"],["rule","✅ 규칙"],["ai","🤖 AI"],["manual","✏️ 수동"],["unclassified","❓ 미분류"]].map(([f,l]) => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "5px 12px", borderRadius: 16, border: "1.5px solid #c5cae9", fontSize: 12, fontWeight: 600,
                cursor: "pointer", background: filter === f ? "#1565c0" : "#fff", color: filter === f ? "#fff" : "#555",
              }}>{l}</button>
            ))}
            <button onClick={() => { setShowColFilter(v => !v); if (showColFilter) setColFilters({ date: "", name: "", source: "", category: "", method: "", type: "" }); }}
              style={{ padding: "5px 12px", borderRadius: 16, border: `1.5px solid ${hasColFilter ? "#1565c0" : "#c5cae9"}`, fontSize: 12, fontWeight: 600, cursor: "pointer", background: hasColFilter ? "#e3f2fd" : "#fff", color: hasColFilter ? "#1565c0" : "#555", marginLeft: 4 }}>
              🔽 컬럼필터{hasColFilter ? " ●" : ""}
            </button>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#888", alignSelf: "center" }}>{displayedTxs.length}건</span>
          </div>

          <div style={{ ...ss.card, padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#1565c0" }}>
                  {["날짜","거래처/메모","금액","출처","구분","카테고리","분류","저장"].map(h => (
                    <th key={h} style={{ color: "#fff", padding: "9px 10px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
                {showColFilter && (
                  <tr style={{ background: "#e8f0fe" }}>
                    <td style={{ padding: "4px 6px" }}>
                      <select value={colFilters.date} onChange={e => setColFilters(f => ({ ...f, date: e.target.value }))}
                        style={ss.filterInput}>
                        <option value="">전체</option>
                        {uniqueMonths.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input placeholder="검색" value={colFilters.name}
                        onChange={e => setColFilters(f => ({ ...f, name: e.target.value }))}
                        style={ss.filterInput} />
                    </td>
                    <td style={{ padding: "4px 6px" }} />
                    <td style={{ padding: "4px 6px" }}>
                      <select value={colFilters.source} onChange={e => setColFilters(f => ({ ...f, source: e.target.value }))}
                        style={ss.filterInput}>
                        <option value="">전체</option>
                        <option value="카드">카드</option>
                        <option value="통장">통장</option>
                      </select>
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <select value={colFilters.type} onChange={e => setColFilters(f => ({ ...f, type: e.target.value }))}
                        style={ss.filterInput}>
                        <option value="">전체</option>
                        <option value="매출">매출</option>
                        <option value="매입">매입</option>
                        <option value="제외">제외</option>
                      </select>
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <select value={colFilters.category} onChange={e => setColFilters(f => ({ ...f, category: e.target.value }))}
                        style={ss.filterInput}>
                        <option value="">전체</option>
                        {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <select value={colFilters.method} onChange={e => setColFilters(f => ({ ...f, method: e.target.value }))}
                        style={ss.filterInput}>
                        <option value="">전체</option>
                        <option value="rule">규칙</option>
                        <option value="ai">AI</option>
                        <option value="manual">수동</option>
                        <option value="unclassified">미분류</option>
                      </select>
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <button onClick={() => setColFilters({ date: "", name: "", source: "", category: "", method: "", type: "" })}
                        style={{ padding: "3px 6px", fontSize: 10, background: "#c62828", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                        초기화
                      </button>
                    </td>
                  </tr>
                )}
              </thead>
              <tbody>
                {displayedTxs.map((tx, i) => {
                  const amt = tx.amount || Math.max(tx.out || 0, tx.in || 0);
                  const name = tx.merchant || tx.memo || "";
                  const isUncl = tx.category === "미분류";
                  return (
                    <TxRow key={tx.id || i} tx={tx} amt={amt} name={name} isUncl={isUncl} onSave={saveUpdate} />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ③ 내보내기 */}
      {tab === "export" && (
        <div style={ss.panel}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginBottom: 16 }}>
            {[
              ["수입(세후)", fmt(incomeTotal)+"원", "#e3f2fd"],
              ["필요경비", fmt(expenseTotal)+"원", "#ffebee"],
              ["총수입(세전)", fmt(grossIncome)+"원", "#e8f5e9"],
              ["소득금액", fmt(grossIncome - expenseTotal)+"원", "#f3e5f5"],
            ].map(([label, val, bg]) => (
              <div key={label} style={{ background: bg, borderRadius: 10, padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1565c0" }}>{val}</div>
                <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>

          <div style={ss.card}>
            <div style={{ fontSize: 13, color: "#555" }}>
              {[["매출장", txs.filter(t => t.type === "income").length],
                ["매입장", txs.filter(t => t.type === "expense").length],
                ["미분류", txs.filter(t => t.category === "미분류").length]].map(([label, cnt]) => (
                <div key={label} style={{ padding: "6px 0", borderBottom: "1px solid #eee" }}>
                  {label}: {cnt}건{label === "미분류" && cnt > 0 ? <span style={{ color: "#c62828" }}> ⚠ 검토 필요</span> : ""}
                </div>
              ))}
            </div>
          </div>

          <button style={ss.btn("#2e7d32")} onClick={() => exportExcel(txs, carRatio, year)}>
            ⬇️ 엑셀 다운로드 ({year}년)
          </button>
        </div>
      )}

      {/* ④ 홈택스 검증 */}
      {tab === "hometax" && (
        <div style={ss.panel}>
          <div style={ss.card}>
            <h3 style={{ color: "#1565c0", marginBottom: 6, fontSize: 15 }}>🏛 홈택스 지급명세서 업로드</h3>
            <p style={{ fontSize: 13, color: "#666", marginBottom: 14, lineHeight: 1.6 }}>
              홈택스 → 조회/발급 → 지급명세서 → 근로·사업 등 소득 지급명세서<br />
              <strong>사업소득 지급명세서</strong>를 Excel로 다운로드 후 업로드하세요.
            </p>
            <DropZone icon="🏛" label="홈택스 지급명세서 Excel" name={hometaxName} inputRef={hometaxRef}
              onChange={e => { setHometaxName(e.target.files[0]?.name || ""); setHometaxResult(null); }} />
            <button style={{ ...ss.btn(hometaxLoading ? "#aaa" : "#1565c0"), marginTop: 12, width: "100%" }}
              disabled={hometaxLoading} onClick={analyzeHometax}>
              {hometaxLoading ? "⏳ 분석 중..." : "🔍 크로스체크 시작"}
            </button>
          </div>

          {hometaxResult && (
            <>
              <div style={{ ...ss.card, border: `2px solid ${hometaxResult.ok ? "#2e7d32" : "#e65100"}` }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: hometaxResult.ok ? "#2e7d32" : "#e65100", marginBottom: 12 }}>
                  {hometaxResult.ok ? "✅ 수입 일치" : "⚠ 수입 차이 발생"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
                  {[
                    ["통장 입금 합계(세후)", fmt(hometaxResult.bankNet) + "원"],
                    ["통장 역산 세전 금액", fmt(hometaxResult.bankGross) + "원"],
                    ["홈택스 신고 세전 합계", fmt(hometaxResult.hometaxGross) + "원"],
                    ["홈택스 차인지급액(세후)", fmt(hometaxResult.hometaxNet) + "원"],
                  ].map(([label, val]) => (
                    <div key={label} style={{ background: "#f5f7ff", borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ color: "#888", fontSize: 11 }}>{label}</div>
                      <div style={{ fontWeight: 700, color: "#1565c0", marginTop: 2 }}>{val}</div>
                    </div>
                  ))}
                </div>
                {!hometaxResult.ok && (
                  <div style={{ marginTop: 12, padding: "10px 12px", background: "#fff3e0", borderRadius: 8, fontSize: 13 }}>
                    차이: <strong style={{ color: "#e65100" }}>{fmt(Math.abs(hometaxResult.diff))}원 ({hometaxResult.diffPct}%)</strong>
                    <br /><span style={{ fontSize: 12, color: "#888" }}>
                      {hometaxResult.diff > 0 ? "→ 통장에 홈택스보다 많은 수입이 있습니다. 신고 누락 확인 필요." : "→ 통장에 홈택스보다 적은 수입이 있습니다. 입금 누락 확인 필요."}
                    </span>
                  </div>
                )}
              </div>

              <div style={ss.card}>
                <h4 style={{ fontSize: 14, color: "#555", marginBottom: 10 }}>지급자별 내역</h4>
                {hometaxResult.items.map((item, i) => {
                  const matched = txs.some(t =>
                    t.type === "income" && (t.memo || "").toLowerCase().includes(item.payer.slice(0, 3).toLowerCase())
                  );
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #eee", fontSize: 13, alignItems: "center" }}>
                      <div>
                        <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: matched ? "#e8f5e9" : "#fff3e0", color: matched ? "#2e7d32" : "#e65100", marginRight: 8 }}>
                          {matched ? "✅ 매칭" : "⚠ 미확인"}
                        </span>
                        {item.payer}
                      </div>
                      <div style={{ textAlign: "right", color: "#555" }}>
                        세전 {fmt(item.gross)}원<br />
                        <span style={{ fontSize: 11, color: "#888" }}>세후 {fmt(item.net)}원</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ⑤ 합치기 */}
      {tab === "merge" && (
        <div style={ss.panel}>
          <div style={{ background: "#e8f5e9", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#2e7d32", lineHeight: 1.7 }}>
            💡 <strong>엑셀 합치기</strong> — 분기별·월별로 만든 세무정리 엑셀 파일들을 선택하면<br />
            중복 없이 하나의 파일로 합쳐서 다운로드합니다.
          </div>
          <div style={ss.card}>
            <h3 style={{ color: "#2e7d32", marginBottom: 14, fontSize: 15 }}>📂 엑셀 파일 선택 (여러 개 가능)</h3>
            <div
              onClick={() => mergeRef.current?.click()}
              style={{ border: "2px dashed #81c784", borderRadius: 10, padding: "28px", textAlign: "center", cursor: "pointer", background: "#f1f8e9" }}
            >
              <input ref={mergeRef} type="file" accept=".xlsx" multiple style={{ display: "none" }}
                onChange={e => {
                  const names = Array.from(e.target.files || []).map(f => f.name);
                  setMergeFileNames(names);
                  setMergeStatus("");
                }} />
              <div style={{ fontSize: 32 }}>📎</div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 8 }}>클릭하여 세무정리 엑셀 파일 선택</div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>세무정리_2025.xlsx, 세무정리_2025_Q2.xlsx 등</div>
            </div>

            {mergeFileNames.length > 0 && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "#f5f5f5", borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: "#555", fontWeight: 700, marginBottom: 6 }}>선택된 파일 ({mergeFileNames.length}개)</div>
                {mergeFileNames.map((n, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#333", padding: "2px 0" }}>📄 {n}</div>
                ))}
              </div>
            )}

            <button
              style={{ ...ss.btn(mergeLoading ? "#aaa" : "#2e7d32"), marginTop: 14, width: "100%" }}
              disabled={mergeLoading}
              onClick={mergeExcels}
            >
              {mergeLoading ? "⏳ 합치는 중..." : "🔗 합쳐서 다운로드"}
            </button>

            {mergeStatus && (
              <div style={{ marginTop: 10, fontSize: 13, color: mergeStatus.startsWith("✅") ? "#2e7d32" : "#c62828", fontWeight: 600 }}>
                {mergeStatus}
              </div>
            )}
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}

function DropZone({ icon, label, name, inputRef, onChange }) {
  const [over, setOver] = useState(false);

  function handleDrop(e) {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    inputRef.current.files = dt.files;
    onChange({ target: { files: dt.files } });
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${over ? "#1565c0" : "#90caf9"}`,
        borderRadius: 10, padding: "20px", textAlign: "center", cursor: "pointer",
        background: over ? "#e3f2fd" : "#f5f9ff", transition: "all .15s",
      }}
    >
      <input ref={inputRef} type="file" accept=".xls,.xlsx" style={{ display: "none" }} onChange={onChange} />
      <div style={{ fontSize: 28 }}>{icon}</div>
      <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>{label}</div>
      <div style={{ fontSize: 12, color: "#1565c0", fontWeight: 700, marginTop: 4 }}>{name || "파일 없음"}</div>
    </div>
  );
}

function TxRow({ tx, amt, name, isUncl, onSave }) {
  const [cat, setCat] = useState(tx.category);
  const rowBg = isUncl ? "#fff8e1" : "transparent";
  const borderColor = { rule: "#2e7d32", ai: "#e65100", manual: "#6a1b9a", unclassified: "#c62828", ai_low: "#c62828" }[tx.method] || "#ccc";

  const typeLabel = tx.type === "income" ? "매출(입금)" : tx.type === "exclude" ? "제외" : "매입(출금)";
  const typeBg = tx.type === "income" ? "#e8f5e9" : tx.type === "exclude" ? "#f5f5f5" : "#ffebee";
  const typeColor = tx.type === "income" ? "#2e7d32" : tx.type === "exclude" ? "#888" : "#c62828";

  return (
    <tr style={{ background: rowBg, borderLeft: `3px solid ${borderColor}` }}>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6", whiteSpace: "nowrap" }}>{tx.date}</td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6", maxWidth: 180 }} title={name}>{name.length > 20 ? name.slice(0, 20) + "…" : name}</td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6", textAlign: "right", whiteSpace: "nowrap" }}>{fmt(amt)}</td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6" }}>{tx.source === "card" ? "카드" : "통장"}</td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6" }}>
        <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: typeBg, color: typeColor, whiteSpace: "nowrap" }}>
          {typeLabel}
        </span>
      </td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6" }}>
        <select value={cat} onChange={e => setCat(e.target.value)}
          style={{ padding: "3px 6px", border: "1px solid #c5cae9", borderRadius: 6, fontSize: 12 }}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6" }}>
        <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700,
          background: { rule: "#e8f5e9", ai: "#fff3e0", manual: "#f3e5f5" }[tx.method] || "#ffebee",
          color: { rule: "#2e7d32", ai: "#e65100", manual: "#6a1b9a" }[tx.method] || "#c62828" }}>
          {{ rule: "규칙", ai: "AI", manual: "수동", ai_low: "AI저신뢰", unclassified: "미분류" }[tx.method] || "미분류"}
        </span>
      </td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6" }}>
        <button onClick={async () => {
          const kw = cat !== tx.category ? prompt(`"${cat}"을 규칙으로 저장할 키워드? (취소 = 규칙 저장 안 함)`, tx.merchant || tx.memo || "") : null;
          await onSave(tx, cat, kw);
        }} style={{ padding: "3px 8px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
          저장
        </button>
      </td>
    </tr>
  );
}
