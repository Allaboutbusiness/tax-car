"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { loadRules, saveRules, addRule, applyRules, CATEGORIES } from "../../lib/rules";
import BottomNav from "../../components/BottomNav";

const DATA_KEY = (year) => `tax_data_${year}`;
const CONFIG_KEY = "tax_config";
const WITHHOLDING = 0.033;
const GA_NAMES = ["에즈금융서비스", "az금융서비스", "에즈금융", "az금융", "에즈9월", "에즈"];

function fmt(n) { return Number(n || 0).toLocaleString("ko-KR"); }
function loadConfig() { try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}"); } catch { return {}; } }
function saveConfig(cfg) { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }
function loadData(year) { try { return JSON.parse(localStorage.getItem(DATA_KEY(year)) || "[]"); } catch { return []; } }
function saveData(year, data) { localStorage.setItem(DATA_KEY(year), JSON.stringify(data)); }

// PC에서는 저장 위치 선택 다이얼로그, 그 외 브라우저 다운로드
async function saveFile(buffer, filename) {
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Excel 파일", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

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
    results.push({ id: `bank_${i}_${Date.now()}`, date: dateRaw, type: String(row[1] || "").trim(), memo: String(row[2] || "").trim(), out, in: inAmt, amount: out || inAmt, source: "bank" });
  }
  return results;
}

// source 파라미터로 FC카드("card")와 개인사업자카드("biz_card") 모두 처리
async function parseShinhanCard(file, source = "card") {
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
    results.push({ id: `${source}_${i}_${Date.now()}`, date: dateRaw, merchant, amount, out: amount, in: 0, source });
  }
  return results;
}

// 홈택스 전자세금계산서 엑셀 파싱 (발급한 것=sales, 발급받은 것=purchase)
async function parseTaxInvoice(file, direction) {
  const { read, utils } = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const results = [];

  // 헤더 행 탐색: '공급가액' 포함 행
  let hIdx = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    if (rows[i].some(c => String(c).includes("공급가액"))) { hIdx = i; break; }
  }
  if (hIdx < 0) return results;

  const headers = rows[hIdx].map(c => String(c).trim());
  const dateIdx = headers.findIndex(h => h.includes("작성") || h.includes("일자"));
  const supplyIdx = headers.findIndex(h => h.includes("공급가액"));
  const taxIdx = headers.findIndex(h => h === "세액" || h.includes("부가세"));
  // 매출=공급받는자상호, 매입=공급자상호
  const nameIdx = direction === "sales"
    ? headers.findIndex(h => h.includes("공급받는자") && (h.includes("상호") || h.includes("법인명")))
    : headers.findIndex(h => h.includes("공급자") && (h.includes("상호") || h.includes("법인명")) && !h.includes("받는"));

  for (let i = hIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const supply = parseInt(String(row[supplyIdx] || "0").replace(/,/g, "")) || 0;
    if (supply === 0) continue;
    const tax = taxIdx >= 0 ? parseInt(String(row[taxIdx] || "0").replace(/,/g, "")) || 0 : Math.round(supply * 0.1);
    const total = supply + tax;
    const date = dateIdx >= 0 ? String(row[dateIdx] || "").replace(/\./g, "-").slice(0, 10) : "";
    const name = nameIdx >= 0 ? String(row[nameIdx] || "").trim() : "";
    results.push({
      id: `invoice_${direction}_${i}_${Date.now()}`,
      date, merchant: name || (direction === "sales" ? "세금계산서(매출)" : "세금계산서(매입)"),
      amount: total, supply, tax,
      out: direction === "purchase" ? total : 0,
      in: direction === "sales" ? total : 0,
      source: direction === "sales" ? "invoice_sales" : "invoice_purchase",
      category: direction === "sales" ? "기타사업소득" : "미분류",
      type: direction === "sales" ? "income" : "expense",
      method: "rule",
    });
  }
  return results;
}

// 홈택스 현금영수증 사용내역 Excel 파싱
async function parseCashReceipt(file) {
  const { read, utils } = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const results = [];

  // 헤더 행 탐색: '거래일', '승인일', '가맹점', '상호' 등 포함 행
  let hIdx = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i].map(c => String(c).trim());
    if (row.some(c => c.includes("거래일") || c.includes("승인일") || c.includes("가맹점") || c.includes("상호명"))) {
      hIdx = i; break;
    }
  }
  if (hIdx < 0) return results;

  const headers = rows[hIdx].map(c => String(c).trim());
  const dateIdx = headers.findIndex(h => h.includes("거래일") || h.includes("승인일") || h.includes("일자"));
  const nameIdx = headers.findIndex(h => h.includes("가맹점") || h.includes("상호"));
  const supplyIdx = headers.findIndex(h => h.includes("공급가액"));
  const totalIdx = headers.findIndex(h => h.includes("합계") || (h.includes("금액") && !h.includes("공급") && !h.includes("부가") && !h.includes("세")));
  const typeIdx = headers.findIndex(h => h.includes("구분") || h.includes("사용구분"));

  for (let i = hIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const dateRaw = String(row[dateIdx >= 0 ? dateIdx : 0] || "").replace(/\./g, "-").slice(0, 10);
    if (!dateRaw || dateRaw.length < 10) continue;
    const name = nameIdx >= 0 ? String(row[nameIdx] || "").trim() : "현금영수증";
    if (!name) continue;
    const supplyAmt = supplyIdx >= 0 ? parseInt(String(row[supplyIdx] || "0").replace(/,/g, "")) || 0 : 0;
    const totalAmt = totalIdx >= 0 ? parseInt(String(row[totalIdx] || "0").replace(/,/g, "")) || 0 : 0;
    const amount = totalAmt || supplyAmt;
    if (amount <= 0) continue;
    // 구분 필드 확인 (소비자지출/사업자지출 → 매입)
    const typeStr = typeIdx >= 0 ? String(row[typeIdx] || "").trim() : "";
    const isIncome = typeStr.includes("수입") || typeStr.includes("판매");
    results.push({
      id: `cash_${i}_${Date.now()}`,
      date: dateRaw,
      merchant: name,
      amount,
      out: isIncome ? 0 : amount,
      in: isIncome ? amount : 0,
      source: "cash",
    });
  }
  return results;
}

async function categorizeWithAI(unmatched) {
  if (!unmatched.length) return [];
  try {
    const r = await fetch("/api/categorize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactions: unmatched }) });
    const { results } = await r.json();
    return results;
  } catch {
    return unmatched.map(tx => ({ id: tx.id, category: "미분류", type: "unclassified", method: "unclassified" }));
  }
}

async function exportExcel(txs, carRatio, year) {
  const { utils, write } = await import("xlsx");
  const wb = utils.book_new();
  const income = txs.filter(t => t.type === "income");
  const expenses = txs.filter(t => t.type === "expense");

  const salesRows = [["날짜", "거래처", "입금액(세후)", "총수입금액(세전)", "원천징수세액", "출처"]];
  let totalNet = 0;
  income.forEach(t => {
    const net = t.in || 0;
    const isInvoice = t.source === "invoice_sales";
    const gross = isInvoice ? net : Math.round(net / (1 - WITHHOLDING));
    totalNet += net;
    salesRows.push([t.date, t.merchant || t.memo || "", net, gross, isInvoice ? 0 : gross - net, t.source === "invoice_sales" ? "세금계산서" : "통장"]);
  });
  const totalGross = Math.round(totalNet / (1 - WITHHOLDING));
  salesRows.push(["합계", "", totalNet, totalGross, totalGross - totalNet, ""]);
  utils.book_append_sheet(wb, utils.aoa_to_sheet(salesRows), "매출장");

  const expRows = [["날짜", "거래처", "카테고리", "원금액", "업무비율", "인정금액", "출처"]];
  let totalApproved = 0;
  expenses.forEach(t => {
    const amt = t.amount || Math.max(t.out || 0, t.in || 0);
    const ratio = t.category === "차량유지비" ? carRatio : 100;
    const approved = Math.round(amt * ratio / 100);
    totalApproved += approved;
    const srcLabel = { card: "FC카드", biz_card: "사업자카드", bank: "통장", invoice_purchase: "세금계산서", cash: "현금영수증" }[t.source] || t.source;
    expRows.push([t.date, t.merchant || t.memo || "", t.category, amt, `${ratio}%`, approved, srcLabel]);
  });
  expRows.push(["합계", "", "", "", "", totalApproved, ""]);
  utils.book_append_sheet(wb, utils.aoa_to_sheet(expRows), "매입장(필요경비)");

  const monthlyIncome = {}, monthlyExp = {};
  for (let m = 1; m <= 12; m++) { monthlyIncome[m] = 0; monthlyExp[m] = 0; }
  income.forEach(t => { const m = parseInt(t.date?.slice(5, 7)); if (m) monthlyIncome[m] += t.in || 0; });
  expenses.forEach(t => {
    const m = parseInt(t.date?.slice(5, 7)); if (!m) return;
    const amt = t.amount || Math.max(t.out || 0, t.in || 0);
    monthlyExp[m] += Math.round(amt * (t.category === "차량유지비" ? carRatio : 100) / 100);
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

  const uncl = txs.filter(t => t.category === "미분류");
  utils.book_append_sheet(wb, utils.aoa_to_sheet([["날짜", "거래처/메모", "금액", "출처"], ...uncl.map(t => [t.date, t.merchant || t.memo || "", t.amount || Math.max(t.out || 0, t.in || 0), t.source])]), "미분류(검토필요)");

  const buf = write(wb, { type: "array", bookType: "xlsx" });
  await saveFile(buf, `세무정리_${year}.xlsx`);
}

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
    const amounts = row.map(c => parseInt(c.replace(/,/g, "")) || 0).filter(n => n > 10000);
    if (!amounts.length) continue;
    const gross = Math.max(...amounts);
    const tax = amounts.find(n => n !== gross && n < gross) || Math.round(gross * WITHHOLDING);
    results.push({ payer: name, gross, tax, net: gross - tax });
  }
  return results;
}

function crossCheck(hometaxItems, txs) {
  const incTxs = txs.filter(t => t.type === "income");
  const bankNetTotal = incTxs.reduce((s, t) => s + (t.in || 0), 0);
  const bankGrossTotal = Math.round(bankNetTotal / (1 - WITHHOLDING));
  const hometaxGrossTotal = hometaxItems.reduce((s, i) => s + i.gross, 0);
  const hometaxNetTotal = hometaxItems.reduce((s, i) => s + i.net, 0);

  const itemsWithMatch = hometaxItems.map(item => {
    const payerNorm = item.payer.replace(/\s/g, "").toLowerCase();
    const isGA = GA_NAMES.some(g => payerNorm.includes(g.replace(/\s/g, "").toLowerCase()));
    // 지급자명 앞 4글자로 통장 메모 검색
    const keyword = item.payer.replace(/[^\가-힣a-zA-Z0-9]/g, "").slice(0, 4).toLowerCase();
    const matchedTxs = incTxs.filter(t =>
      (t.memo || t.merchant || "").replace(/\s/g, "").toLowerCase().includes(keyword)
    );
    const matchedNet = matchedTxs.reduce((s, t) => s + (t.in || 0), 0);
    const matchedGross = matchedNet > 0 ? Math.round(matchedNet / (1 - WITHHOLDING)) : 0;
    const diff = matchedGross - item.gross;
    return { ...item, isGA, matched: matchedTxs.length > 0, matchedNet, matchedGross, diff, ok: Math.abs(diff) < 50000 };
  });

  const diff = bankGrossTotal - hometaxGrossTotal;
  const diffPct = hometaxGrossTotal > 0 ? Math.abs(diff / hometaxGrossTotal * 100).toFixed(1) : 0;
  return { bankNet: bankNetTotal, bankGross: bankGrossTotal, hometaxGross: hometaxGrossTotal, hometaxNet: hometaxNetTotal, diff, diffPct, ok: Math.abs(diff) < 50000, items: itemsWithMatch };
}

// ── 메인 컴포넌트 ────────────────────────────────────────
export default function TaxPage() {
  const thisYear = new Date().getFullYear().toString();
  const [year, setYear] = useState(thisYear);
  // 마운트 시 즉시 localStorage에서 로드 (탭 이동 후 돌아와도 데이터 유지)
  const [txs, setTxs] = useState(() => { try { return loadData(thisYear); } catch { return []; } });
  const [carRatio, setCarRatio] = useState(() => loadConfig().car_business_ratio || 80);
  const [filter, setFilter] = useState("all");
  const [colFilters, setColFilters] = useState({ date: [], source: [], category: [], method: [], type: [] });
  const [nameFilter, setNameFilter] = useState("");
  const [openFilter, setOpenFilter] = useState("");
  const [tab, setTab] = useState("upload");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const bankRef = useRef(); const cardRef = useRef(); const bizCardRef = useRef();
  const invoiceSalesRef = useRef(); const invoicePurchaseRef = useRef();
  const cashRef = useRef(); const bizCashRef = useRef();
  const hometaxRef = useRef(); const mergeRef = useRef();

  const [bankNames, setBankNames] = useState([]);
  const [cardNames, setCardNames] = useState([]);
  const [bizCardNames, setBizCardNames] = useState([]);
  const [invoiceSalesNames, setInvoiceSalesNames] = useState([]);
  const [invoicePurchaseNames, setInvoicePurchaseNames] = useState([]);
  const [cashNames, setCashNames] = useState([]);
  const [bizCashNames, setBizCashNames] = useState([]);
  const [hometaxNames, setHometaxNames] = useState([]);
  const [mergeFileNames, setMergeFileNames] = useState([]);
  const [mergeStatus, setMergeStatus] = useState("");
  const [mergeLoading, setMergeLoading] = useState(false);
  const [hometaxResult, setHometaxResult] = useState(null);
  const [hometaxLoading, setHometaxLoading] = useState(false);
  const [rules, setRulesState] = useState(() => { try { return loadRules(); } catch { return []; } });

  // 필터 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const close = () => setOpenFilter("");
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const loadTxs = useCallback((y) => {
    const data = loadData(y || year);
    setTxs(data);
    return data;
  }, [year]);

  const handleTab = (t) => {
    setTab(t);
    // 탭 이동 시 항상 localStorage에서 최신 데이터 로드
    const data = loadData(year);
    setTxs(data);
  };

  const toggleColFilter = (key, value) => {
    setColFilters(f => { const arr = f[key]; return { ...f, [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] }; });
  };
  const clearColFilter = (key) => setColFilters(f => ({ ...f, [key]: [] }));
  const hasAnyColFilter = Object.values(colFilters).some(v => v.length > 0) || nameFilter !== "";

  async function analyze() {
    const isExcel = (f) => /\.(xls|xlsx)$/i.test(f.name);
    const bankFiles = Array.from(bankRef.current?.files || []);
    const cardFiles = Array.from(cardRef.current?.files || []);
    const bizCardFiles = Array.from(bizCardRef.current?.files || []);
    const invoiceSalesFiles = Array.from(invoiceSalesRef.current?.files || []);
    const invoicePurchaseFiles = Array.from(invoicePurchaseRef.current?.files || []);
    const cashFiles = Array.from(cashRef.current?.files || []);
    const bizCashFiles = Array.from(bizCashRef.current?.files || []);
    const allFiles = [...bankFiles, ...cardFiles, ...bizCardFiles, ...invoiceSalesFiles, ...invoicePurchaseFiles, ...cashFiles, ...bizCashFiles];
    if (!allFiles.length) { setStatus("파일을 하나 이상 선택해주세요."); return; }

    saveConfig({ car_business_ratio: carRatio });
    setLoading(true); setProgress(10); setStatus("파일 파싱 중...");
    try {
      let newTxs = [], preCategorized = [];
      for (const f of bankFiles) if (isExcel(f)) newTxs.push(...(await parseKBBank(f)));
      for (const f of cardFiles) if (isExcel(f)) newTxs.push(...(await parseShinhanCard(f, "card")));
      for (const f of bizCardFiles) if (isExcel(f)) newTxs.push(...(await parseShinhanCard(f, "biz_card")));
      for (const f of invoiceSalesFiles) if (isExcel(f)) preCategorized.push(...(await parseTaxInvoice(f, "sales")));
      for (const f of invoicePurchaseFiles) if (isExcel(f)) preCategorized.push(...(await parseTaxInvoice(f, "purchase")));
      for (const f of cashFiles) if (isExcel(f)) newTxs.push(...(await parseCashReceipt(f)));
      for (const f of bizCashFiles) if (isExcel(f)) newTxs.push(...(await parseCashReceipt(f)));

      setProgress(40); setStatus(`${newTxs.length + preCategorized.length}건 파싱 완료. 규칙 적용 중...`);

      const currentRules = loadRules();
      const matched = [], unmatched = [];
      newTxs.forEach(tx => {
        const result = applyRules(tx, currentRules);
        if (result) matched.push({ ...tx, ...result });
        else unmatched.push(tx);
      });

      setProgress(60); setStatus(`규칙 ${matched.length}건. AI 분류 중 (${unmatched.length}건)...`);
      const aiResults = await categorizeWithAI(unmatched);
      const aiMap = Object.fromEntries(aiResults.map(r => [r.id, r]));
      const allCategorized = [
        ...matched,
        ...unmatched.map(tx => ({ ...tx, ...(aiMap[tx.id] || { category: "미분류", type: "unclassified", method: "unclassified" }) })),
        ...preCategorized,
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
    } finally { setLoading(false); }
  }

  async function analyzeHometax() {
    const files = Array.from(hometaxRef.current?.files || []);
    if (!files.length) return;
    setHometaxLoading(true);
    try {
      const items = [];
      for (const file of files) {
        if (/\.pdf$/i.test(file.name)) {
          // PDF → Anthropic API로 파싱
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch("/api/parse-pdf", { method: "POST", body: fd });
          const data = await res.json();
          if (data.error) throw new Error(`${file.name}: ${data.error}`);
          items.push({ payer: data.payer, gross: data.gross, tax: data.totalTax, net: data.net });
        } else {
          // Excel → 기존 파서
          const parsed = await parseHometax(file);
          items.push(...parsed);
        }
      }
      const current = loadData(year);
      setHometaxResult(crossCheck(items, current));
    } catch (e) { alert("파싱 오류: " + e.message); }
    finally { setHometaxLoading(false); }
  }

  async function mergeExcels() {
    const files = Array.from(mergeRef.current?.files || []);
    if (!files.length) { setMergeStatus("파일을 선택해주세요."); return; }
    setMergeLoading(true); setMergeStatus("파일 읽는 중...");
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
            const date = String(r[0] || "").trim(), name = String(r[1] || "").trim();
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
            const date = String(r[0] || "").trim(), name = String(r[1] || "").trim();
            const cat = String(r[2] || "").trim();
            const amt = parseInt(String(r[3] || "0").replace(/,/g, "")) || 0;
            const ratio = parseInt(String(r[4] || "100%")) || 100;
            const src = String(r[6] || "").trim();
            if (!date || !name || amt === 0) continue;
            allExpense.push({ date, name, cat, amt, ratio, src });
          }
        }
      }
      const iKeys = new Set();
      const dedupI = allIncome.filter(r => { const k = `${r.date}|${r.name}|${r.net}`; if (iKeys.has(k)) return false; iKeys.add(k); return true; });
      const eKeys = new Set();
      const dedupE = allExpense.filter(r => { const k = `${r.date}|${r.name}|${r.amt}`; if (eKeys.has(k)) return false; eKeys.add(k); return true; });

      const wb2 = utils.book_new();
      const sRows = [["날짜", "거래처", "입금액(세후)", "총수입금액(세전)", "원천징수세액"]];
      let tn = 0;
      [...dedupI].sort((a, b) => a.date.localeCompare(b.date)).forEach(r => { const g = Math.round(r.net / (1 - WITHHOLDING)); tn += r.net; sRows.push([r.date, r.name, r.net, g, g - r.net]); });
      const tg = Math.round(tn / (1 - WITHHOLDING)); sRows.push(["합계", "", tn, tg, tg - tn]);
      utils.book_append_sheet(wb2, utils.aoa_to_sheet(sRows), "매출장");

      const eRows = [["날짜", "거래처", "카테고리", "원금액", "업무비율", "인정금액", "출처"]];
      let ta = 0;
      [...dedupE].sort((a, b) => a.date.localeCompare(b.date)).forEach(r => { const ap = Math.round(r.amt * r.ratio / 100); ta += ap; eRows.push([r.date, r.name, r.cat, r.amt, `${r.ratio}%`, ap, r.src]); });
      eRows.push(["합계", "", "", "", "", ta, ""]);
      utils.book_append_sheet(wb2, utils.aoa_to_sheet(eRows), "매입장(필요경비)");

      const buf2 = write(wb2, { type: "array", bookType: "xlsx" });
      await saveFile(buf2, `세무정리_합치기_${year}.xlsx`);
      setMergeStatus(`✅ 완료! 매출 ${dedupI.length}건, 매입 ${dedupE.length}건`);
    } catch (e) { setMergeStatus("❌ 오류: " + e.message); }
    finally { setMergeLoading(false); }
  }

  async function saveUpdate(tx, newCat, keyword) {
    const typeMap = { "보험수수료 수입": "income", "기타사업소득": "income", "개인지출": "exclude" };
    const newType = typeMap[newCat] || "expense";
    const updated = txs.map(t => t.id === tx.id ? { ...t, category: newCat, type: newType, method: "manual" } : t);
    setTxs(updated); saveData(year, updated);
    if (keyword?.trim()) { const nr = addRule(rules, keyword.trim(), newCat, newType); setRulesState(nr); saveRules(nr); }
  }

  const METHOD_LABEL = { rule: "자동분류", ai: "AI판단", manual: "직접수정", unclassified: "미분류", ai_low: "미분류" };

  const filtered = txs.filter(t => {
    if (filter === "all") return true;
    if (filter === "unclassified") return t.category === "미분류";
    if (filter === "rule") return t.method === "rule";
    if (filter === "ai") return t.method === "ai" || t.method === "ai_low";
    if (filter === "manual") return t.method === "manual";
    return true;
  });

  const displayedTxs = filtered.filter(t => {
    const name = t.merchant || t.memo || "";
    const month = t.date?.slice(0, 7) || "";
    const srcLabel = (t.source === "card" || t.source === "biz_card") ? "카드" : (t.source === "invoice_sales" || t.source === "invoice_purchase") ? "세금계산서" : t.source === "cash" ? "현금영수증" : "통장";
    const typeLabel = t.type === "income" ? "매출" : t.type === "exclude" ? "제외" : "매입";
    const mLabel = METHOD_LABEL[t.method] || "미분류";
    if (colFilters.date.length > 0 && !colFilters.date.includes(month)) return false;
    if (nameFilter && !name.toLowerCase().includes(nameFilter.toLowerCase())) return false;
    if (colFilters.source.length > 0 && !colFilters.source.includes(srcLabel)) return false;
    if (colFilters.category.length > 0 && !colFilters.category.includes(t.category)) return false;
    if (colFilters.method.length > 0 && !colFilters.method.includes(mLabel)) return false;
    if (colFilters.type.length > 0 && !colFilters.type.includes(typeLabel)) return false;
    return true;
  });

  const uniqueMonths = [...new Set(txs.map(t => t.date?.slice(0, 7)).filter(Boolean))].sort();
  const uniqueCategories = [...new Set(txs.map(t => t.category).filter(Boolean))].sort();
  const entertainmentTotal = txs.filter(t => t.category === "접대비").reduce((s, t) => s + (t.amount || Math.max(t.out || 0, t.in || 0)), 0);
  const incomeTotal = txs.filter(t => t.type === "income").reduce((s, t) => s + (t.in || 0), 0);
  const expenseTotal = txs.filter(t => t.type === "expense").reduce((s, t) => {
    const amt = t.amount || Math.max(t.out || 0, t.in || 0);
    return s + Math.round(amt * (t.category === "차량유지비" ? carRatio : 100) / 100);
  }, 0);
  const grossIncome = Math.round(incomeTotal / (1 - WITHHOLDING));

  const ss = {
    wrap: { minHeight: "100vh", background: "#f0f4ff" },
    header: { background: "#1565c0", color: "#fff", padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 },
    back: { color: "#fff", textDecoration: "none", fontSize: 20, marginRight: 4 },
    tabs: { display: "flex", background: "#fff", borderBottom: "2px solid #e0e7ff", overflowX: "auto" },
    tab: (active) => ({ padding: "12px 16px", cursor: "pointer", fontSize: 13, fontWeight: active ? 700 : 400, color: active ? "#1565c0" : "#888", background: "none", border: "none", borderBottom: active ? "3px solid #1565c0" : "3px solid transparent", whiteSpace: "nowrap" }),
    panel: { padding: "16px", maxWidth: 1000, margin: "0 auto" },
    card: { background: "#fff", borderRadius: 12, padding: 18, marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,.07)" },
    btn: (bg, disabled) => ({ background: disabled ? "#aaa" : bg, color: "#fff", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: disabled ? "default" : "pointer" }),
    nextBtn: { background: "#1565c0", color: "#fff", border: "none", borderRadius: 10, padding: "14px 28px", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "block", margin: "16px auto 0", width: "100%" },
  };

  return (
    <div style={ss.wrap}>
      <div style={ss.header}>
        <a href="/" style={ss.back}>←</a>
        <span style={{ fontSize: 20 }}>📊</span>
        <strong style={{ fontSize: 16 }}>세무 정리</strong>
        <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <select value={year} onChange={e => { setYear(e.target.value); loadTxs(e.target.value); }}
            style={{ padding: "4px 8px", borderRadius: 6, border: "none", fontSize: 13 }}>
            {Array.from({ length: 57 }, (_, i) => 2020 + i).map(y => <option key={y} value={String(y)}>{y}년</option>)}
          </select>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,.7)", marginTop: 2 }}>{txs.length > 0 ? `${txs.length}건 저장됨` : "데이터 없음"}</span>
        </div>
      </div>

      <div style={ss.tabs}>
        {[["upload","① 업로드"],["review","② 분류검토"],["hometax","③ 홈택스검증"],["export","④ 내보내기"],["merge","⑤ 합치기"]].map(([t,l]) => (
          <button key={t} style={ss.tab(tab===t)} onClick={() => handleTab(t)}>{l}</button>
        ))}
      </div>

      {/* ① 업로드 */}
      {tab === "upload" && (
        <div style={ss.panel}>
          <div style={{ background: "#e3f2fd", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#1565c0", lineHeight: 1.8 }}>
            💡 <strong>{year}년 데이터 업로드</strong> — 분기별·월별로 나눠 올려도 자동 누적·중복 제거됩니다.<br />
            📎 각 슬롯에 <strong>여러 파일을 한 번에</strong> 선택할 수 있습니다 (Excel .xls/.xlsx, PDF 지원).
          </div>

          <div style={ss.card}>
            <h3 style={{ color: "#1565c0", marginBottom: 14, fontSize: 15 }}>📁 FC(프리랜서) 소득 파일</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <DropZone icon="🏦" label="국민은행 통장 XLS" names={bankNames} inputRef={bankRef} onChange={e => setBankNames(Array.from(e.target.files).map(f => f.name))} />
              <DropZone icon="💳" label="FC 신한카드 XLS" names={cardNames} inputRef={cardRef} onChange={e => setCardNames(Array.from(e.target.files).map(f => f.name))} />
            </div>
            <div style={{ marginTop: 12 }}>
              <DropZone icon="🧾" label="현금영수증 사용내역 (FC)" names={cashNames} inputRef={cashRef} onChange={e => setCashNames(Array.from(e.target.files).map(f => f.name))} color="#6a1b9a" note="홈택스→조회/발급→현금영수증→사용내역 Excel" />
            </div>
          </div>

          <div style={ss.card}>
            <h3 style={{ color: "#2e7d32", marginBottom: 14, fontSize: 15 }}>🏢 개인사업자 파일</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <DropZone icon="💳" label="사업자 전용카드 XLS" names={bizCardNames} inputRef={bizCardRef} onChange={e => setBizCardNames(Array.from(e.target.files).map(f => f.name))} color="#2e7d32" />
              <DropZone icon="📤" label="세금계산서(내가 발급)" names={invoiceSalesNames} inputRef={invoiceSalesRef} onChange={e => setInvoiceSalesNames(Array.from(e.target.files).map(f => f.name))} color="#2e7d32" note="홈택스→매출세금계산서 Excel" />
              <DropZone icon="📥" label="세금계산서(발급받은것)" names={invoicePurchaseNames} inputRef={invoicePurchaseRef} onChange={e => setInvoicePurchaseNames(Array.from(e.target.files).map(f => f.name))} color="#2e7d32" note="홈택스→매입세금계산서 Excel" />
            </div>
            <div style={{ marginTop: 12 }}>
              <DropZone icon="🧾" label="현금영수증 사용내역 (사업자)" names={bizCashNames} inputRef={bizCashRef} onChange={e => setBizCashNames(Array.from(e.target.files).map(f => f.name))} color="#6a1b9a" note="홈택스→조회/발급→현금영수증→사용내역 Excel" />
            </div>
          </div>

          <div style={ss.card}>
            <h3 style={{ color: "#1565c0", marginBottom: 10, fontSize: 15 }}>🚗 차량비 업무 비율</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input type="range" min={50} max={100} value={carRatio} onChange={e => setCarRatio(Number(e.target.value))} style={{ flex: 1 }} />
              <span style={{ fontSize: 22, fontWeight: 700, color: "#1565c0", minWidth: 50 }}>{carRatio}%</span>
            </div>
            <div style={{ fontSize: 12, color: "#e65100", background: "#fff3e0", padding: "8px 12px", borderRadius: 6, marginTop: 10 }}>
              ⚠ 차량운행일지 작성 시 100% 인정. 일지 없이 100% 적용 시 세무조사 위험 있음.
            </div>
          </div>

          <button style={{ ...ss.btn(loading ? "#aaa" : "#1565c0", loading), width: "100%" }} disabled={loading} onClick={analyze}>
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
            {[["all","전체"],["rule","🔵 자동분류"],["ai","🟡 AI판단"],["manual","🟣 직접수정"],["unclassified","🔴 미분류"]].map(([f,l]) => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "5px 12px", borderRadius: 16, border: "1.5px solid #c5cae9", fontSize: 12, fontWeight: 600,
                cursor: "pointer", background: filter === f ? "#1565c0" : "#fff", color: filter === f ? "#fff" : "#555",
              }}>{l}</button>
            ))}
            {hasAnyColFilter && (
              <button onClick={() => { setColFilters({ date: [], source: [], category: [], method: [], type: [] }); setNameFilter(""); }}
                style={{ padding: "5px 10px", borderRadius: 16, border: "1.5px solid #c62828", fontSize: 12, cursor: "pointer", background: "#ffebee", color: "#c62828" }}>
                ✕ 필터 초기화
              </button>
            )}
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>{displayedTxs.length}건</span>
          </div>

          <div style={{ ...ss.card, padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#1565c0" }}>
                  <th style={{ color: "#fff", padding: "9px 10px", textAlign: "left", whiteSpace: "nowrap", position: "relative" }}>
                    <ColFilterDropdown label="날짜" fKey="date" options={uniqueMonths} selected={colFilters.date}
                      onToggle={(v) => toggleColFilter("date", v)} onClear={() => clearColFilter("date")}
                      isOpen={openFilter === "date"} onOpen={(k) => setOpenFilter(openFilter === k ? "" : k)} />
                  </th>
                  <th style={{ color: "#fff", padding: "9px 10px", textAlign: "left", position: "relative" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span>거래처/메모</span>
                      <input value={nameFilter} onChange={e => setNameFilter(e.target.value)}
                        placeholder="검색" onClick={e => e.stopPropagation()}
                        style={{ padding: "2px 6px", borderRadius: 4, border: "none", fontSize: 11, width: 70, background: "rgba(255,255,255,.9)" }} />
                    </div>
                  </th>
                  <th style={{ color: "#fff", padding: "9px 10px", textAlign: "left", whiteSpace: "nowrap" }}>금액</th>
                  <th style={{ color: "#fff", padding: "9px 10px", textAlign: "left", position: "relative" }}>
                    <ColFilterDropdown label="출처" fKey="source" options={["카드", "통장", "세금계산서", "현금영수증"]} selected={colFilters.source}
                      onToggle={(v) => toggleColFilter("source", v)} onClear={() => clearColFilter("source")}
                      isOpen={openFilter === "source"} onOpen={(k) => setOpenFilter(openFilter === k ? "" : k)} />
                  </th>
                  <th style={{ color: "#fff", padding: "9px 10px", textAlign: "left", position: "relative" }}>
                    <ColFilterDropdown label="구분" fKey="type" options={["매출", "매입", "제외"]} selected={colFilters.type}
                      onToggle={(v) => toggleColFilter("type", v)} onClear={() => clearColFilter("type")}
                      isOpen={openFilter === "type"} onOpen={(k) => setOpenFilter(openFilter === k ? "" : k)} />
                  </th>
                  <th style={{ color: "#fff", padding: "9px 10px", textAlign: "left", position: "relative" }}>
                    <ColFilterDropdown label="카테고리" fKey="category" options={uniqueCategories} selected={colFilters.category}
                      onToggle={(v) => toggleColFilter("category", v)} onClear={() => clearColFilter("category")}
                      isOpen={openFilter === "category"} onOpen={(k) => setOpenFilter(openFilter === k ? "" : k)} />
                  </th>
                  <th style={{ color: "#fff", padding: "9px 10px", textAlign: "left", position: "relative" }}>
                    <ColFilterDropdown label="분류" fKey="method" options={["자동분류", "AI판단", "직접수정", "미분류"]} selected={colFilters.method}
                      onToggle={(v) => toggleColFilter("method", v)} onClear={() => clearColFilter("method")}
                      isOpen={openFilter === "method"} onOpen={(k) => setOpenFilter(openFilter === k ? "" : k)} />
                  </th>
                  <th style={{ color: "#fff", padding: "9px 10px", textAlign: "left", whiteSpace: "nowrap" }}>저장</th>
                </tr>
              </thead>
              <tbody>
                {displayedTxs.map((tx, i) => (
                  <TxRow key={tx.id || i} tx={tx} amt={tx.amount || Math.max(tx.out || 0, tx.in || 0)} name={tx.merchant || tx.memo || ""} isUncl={tx.category === "미분류"} onSave={saveUpdate} methodLabel={METHOD_LABEL} />
                ))}
                {displayedTxs.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: 32, color: "#aaa", fontSize: 13 }}>데이터가 없습니다. 업로드 탭에서 파일을 올려주세요.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <button style={ss.nextBtn} onClick={() => handleTab("hometax")}>
            저장 후 다음 → 홈택스 검증
          </button>
        </div>
      )}

      {/* ③ 홈택스 검증 */}
      {tab === "hometax" && (
        <div style={ss.panel}>
          <div style={{ background: "#fff3e0", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#e65100", lineHeight: 1.8 }}>
            💡 <strong>에즈금융서비스(AZ금융서비스)</strong> GA 수수료: 3.3% 원천징수 지급명세서<br />
            📌 프리랜서 수수료, 개인사업자 세금계산서 수입은 별도 확인하세요.
          </div>
          <div style={ss.card}>
            <h3 style={{ color: "#1565c0", marginBottom: 6, fontSize: 15 }}>🏛 홈택스 지급명세서 업로드</h3>
            <p style={{ fontSize: 13, color: "#666", marginBottom: 14, lineHeight: 1.6 }}>
              지급처별 <strong>PDF 지급명세서</strong>를 여러 개 한 번에 올리세요. (Excel도 가능)<br />
              홈택스 → 조회/발급 → 지급명세서 → 사업소득 지급명세서 → 인쇄/저장(PDF)
            </p>
            <DropZone icon="🏛" label="지급명세서 PDF 또는 Excel (복수 선택 가능)" names={hometaxNames} inputRef={hometaxRef}
              onChange={e => { setHometaxNames(Array.from(e.target.files).map(f => f.name)); setHometaxResult(null); }} />
            <button style={{ ...ss.btn(hometaxLoading ? "#aaa" : "#1565c0", hometaxLoading), marginTop: 12, width: "100%" }}
              disabled={hometaxLoading} onClick={analyzeHometax}>
              {hometaxLoading ? "⏳ 분석 중..." : "🔍 크로스체크 시작"}
            </button>
          </div>

          {hometaxResult && (
            <>
              <div style={{ ...ss.card, border: `2px solid ${hometaxResult.ok ? "#2e7d32" : "#e65100"}` }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: hometaxResult.ok ? "#2e7d32" : "#e65100", marginBottom: 12 }}>
                  {hometaxResult.ok ? "✅ 수입 일치 (5만원 이내 오차)" : "⚠ 수입 차이 발생"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
                  {[
                    ["통장 입금 합계(세후)", fmt(hometaxResult.bankNet) + "원"],
                    ["통장 역산 세전(÷0.967)", fmt(hometaxResult.bankGross) + "원"],
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
                    차이: <strong style={{ color: "#e65100" }}>{fmt(Math.abs(hometaxResult.diff))}원 ({hometaxResult.diffPct}%)</strong><br />
                    <span style={{ fontSize: 12, color: "#888" }}>{hometaxResult.diff > 0 ? "→ 통장에 홈택스보다 많은 수입. 신고 누락 확인 필요." : "→ 통장에 홈택스보다 적은 수입. 입금 누락 또는 다른 계좌 확인."}</span>
                  </div>
                )}
              </div>

              <div style={ss.card}>
                <h4 style={{ fontSize: 14, color: "#555", marginBottom: 10 }}>지급자별 매칭 결과</h4>
                {hometaxResult.items.map((item, i) => (
                  <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid #eee", fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: item.matched ? "#e8f5e9" : "#fff3e0", color: item.matched ? "#2e7d32" : "#e65100" }}>
                          {item.matched ? "✅ 통장 매칭" : "⚠ 통장 미확인"}
                        </span>
                        {item.isGA && <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: "#e3f2fd", color: "#1565c0" }}>GA</span>}
                        <strong>{item.payer}</strong>
                      </div>
                      <div style={{ textAlign: "right", color: "#555", fontSize: 12 }}>
                        홈택스 세전 {fmt(item.gross)}원<br />
                        <span style={{ color: "#888" }}>세후 {fmt(item.net)}원</span>
                      </div>
                    </div>
                    {item.matched && (
                      <div style={{ marginTop: 6, fontSize: 12, color: item.ok ? "#2e7d32" : "#e65100", paddingLeft: 4 }}>
                        통장 입금(세후) {fmt(item.matchedNet)}원 → 역산 세전 {fmt(item.matchedGross)}원
                        {item.ok ? " ✓ 일치" : ` ⚠ 차이 ${fmt(Math.abs(item.diff))}원`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <button style={ss.nextBtn} onClick={() => handleTab("export")}>
            저장 후 다음 → 내보내기
          </button>
        </div>
      )}

      {/* ④ 내보내기 */}
      {tab === "export" && (
        <div style={ss.panel}>
          <div style={{ background: "#e8f5e9", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#2e7d32", lineHeight: 1.7 }}>
            💻 <strong>PC Chrome/Edge</strong>에서 다운로드하면 저장 위치를 직접 선택할 수 있습니다.<br />
            📱 모바일에서는 기기 다운로드 폴더에 저장됩니다. <strong>PC에서 최종 저장을 권장합니다.</strong>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginBottom: 16 }}>
            {[["수입(세후)", fmt(incomeTotal)+"원", "#e3f2fd"], ["필요경비", fmt(expenseTotal)+"원", "#ffebee"], ["총수입(세전)", fmt(grossIncome)+"원", "#e8f5e9"], ["소득금액", fmt(grossIncome - expenseTotal)+"원", "#f3e5f5"]].map(([label, val, bg]) => (
              <div key={label} style={{ background: bg, borderRadius: 10, padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1565c0" }}>{val}</div>
                <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={ss.card}>
            {[["매출장", txs.filter(t => t.type === "income").length], ["매입장", txs.filter(t => t.type === "expense").length], ["제외(개인지출)", txs.filter(t => t.type === "exclude").length], ["미분류(검토필요)", txs.filter(t => t.category === "미분류").length]].map(([label, cnt]) => (
              <div key={label} style={{ padding: "6px 0", borderBottom: "1px solid #eee", fontSize: 13 }}>
                {label}: {cnt}건{label === "미분류(검토필요)" && cnt > 0 ? <span style={{ color: "#c62828" }}> ⚠ 분류검토 탭에서 수정하세요</span> : ""}
              </div>
            ))}
          </div>
          <button style={{ ...ss.btn("#2e7d32", false), width: "100%", padding: "14px" }} onClick={() => exportExcel(txs, carRatio, year)}>
            ⬇️ 엑셀 다운로드 ({year}년)
          </button>
        </div>
      )}

      {/* ⑤ 합치기 */}
      {tab === "merge" && (
        <div style={ss.panel}>
          <div style={{ background: "#e8f5e9", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#2e7d32", lineHeight: 1.7 }}>
            💡 분기별·월별로 만든 세무정리 엑셀 파일을 여러 개 선택하면 중복 없이 하나로 합칩니다.
          </div>
          <div style={ss.card}>
            <h3 style={{ color: "#2e7d32", marginBottom: 14, fontSize: 15 }}>📂 세무정리 엑셀 파일 선택 (여러 개 가능)</h3>
            <div onClick={() => mergeRef.current?.click()} style={{ border: "2px dashed #81c784", borderRadius: 10, padding: "28px", textAlign: "center", cursor: "pointer", background: "#f1f8e9" }}>
              <input ref={mergeRef} type="file" accept=".xlsx" multiple style={{ display: "none" }}
                onChange={e => { setMergeFileNames(Array.from(e.target.files || []).map(f => f.name)); setMergeStatus(""); }} />
              <div style={{ fontSize: 32 }}>📎</div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 8 }}>클릭하여 세무정리_2025.xlsx 등 파일 선택</div>
            </div>
            {mergeFileNames.length > 0 && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "#f5f5f5", borderRadius: 8 }}>
                {mergeFileNames.map((n, i) => <div key={i} style={{ fontSize: 12, color: "#333", padding: "2px 0" }}>📄 {n}</div>)}
              </div>
            )}
            <button style={{ ...ss.btn(mergeLoading ? "#aaa" : "#2e7d32", mergeLoading), marginTop: 14, width: "100%" }} disabled={mergeLoading} onClick={mergeExcels}>
              {mergeLoading ? "⏳ 합치는 중..." : "🔗 합쳐서 다운로드"}
            </button>
            {mergeStatus && <div style={{ marginTop: 10, fontSize: 13, color: mergeStatus.startsWith("✅") ? "#2e7d32" : "#c62828", fontWeight: 600 }}>{mergeStatus}</div>}
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}

// ── 컬럼 필터 드롭다운 ───────────────────────────────────
function ColFilterDropdown({ label, fKey, options, selected, onToggle, onClear, isOpen, onOpen }) {
  const isActive = selected.length > 0;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, position: "relative" }}>
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
      <button
        onClick={e => { e.stopPropagation(); onOpen(fKey); }}
        style={{ background: isActive ? "#fff" : "rgba(255,255,255,.25)", border: "none", borderRadius: 4, color: isActive ? "#1565c0" : "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: "1px 5px", lineHeight: 1.4 }}
      >
        {isActive ? `▾(${selected.length})` : "▾"}
      </button>
      {isOpen && (
        <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: "100%", left: 0, zIndex: 300, background: "#fff", border: "1.5px solid #c5cae9", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.15)", padding: "8px 10px", minWidth: 150, maxHeight: 220, overflowY: "auto", marginTop: 4 }}>
          {options.length === 0 && <div style={{ fontSize: 11, color: "#aaa" }}>데이터 없음</div>}
          {options.map(opt => (
            <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", cursor: "pointer", fontSize: 12, color: "#333", whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => onToggle(opt)} style={{ cursor: "pointer" }} />
              {opt}
            </label>
          ))}
          <div style={{ borderTop: "1px solid #eee", marginTop: 6, paddingTop: 6 }}>
            <button onClick={onClear} style={{ fontSize: 11, color: "#c62828", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>✕ 초기화</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 드롭존 ────────────────────────────────────────────────
function DropZone({ icon, label, names = [], inputRef, onChange, color = "#1565c0", note }) {
  const [over, setOver] = useState(false);
  function handleDrop(e) {
    e.preventDefault(); setOver(false);
    const files = e.dataTransfer.files;
    if (!files || !files.length) return;
    const dt = new DataTransfer();
    Array.from(files).forEach(f => dt.items.add(f));
    inputRef.current.files = dt.files;
    onChange({ target: { files: dt.files } });
  }
  const hasFiles = names.length > 0;
  const displayName = !hasFiles ? "파일 없음" : names.length === 1 ? names[0] : `${names.length}개 파일 선택됨`;
  return (
    <div onClick={() => inputRef.current?.click()} onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)} onDrop={handleDrop}
      style={{ border: `2px dashed ${over ? color : "#90caf9"}`, borderRadius: 10, padding: "16px", textAlign: "center", cursor: "pointer", background: over ? "#e3f2fd" : "#f5f9ff", transition: "all .15s" }}>
      <input ref={inputRef} type="file" accept=".xls,.xlsx,.pdf" multiple style={{ display: "none" }} onChange={onChange} />
      <div style={{ fontSize: 26 }}>{icon}</div>
      <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>{label}</div>
      {note && <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>{note}</div>}
      <div style={{ fontSize: 11, color: hasFiles ? color : "#aaa", fontWeight: 700, marginTop: 4 }}>{displayName}</div>
    </div>
  );
}

// ── 거래 행 ────────────────────────────────────────────────
function TxRow({ tx, amt, name, isUncl, onSave, methodLabel }) {
  const [cat, setCat] = useState(tx.category);
  const borderColor = { rule: "#1976d2", ai: "#e65100", manual: "#6a1b9a", unclassified: "#c62828", ai_low: "#c62828" }[tx.method] || "#ccc";
  const typeLabel = tx.type === "income" ? "매출(입금)" : tx.type === "exclude" ? "제외" : "매입(출금)";
  const typeBg = tx.type === "income" ? "#e8f5e9" : tx.type === "exclude" ? "#f5f5f5" : "#ffebee";
  const typeColor = tx.type === "income" ? "#2e7d32" : tx.type === "exclude" ? "#888" : "#c62828";
  const mLabel = methodLabel[tx.method] || "미분류";
  const mBg = { 자동분류: "#e3f2fd", AI판단: "#fff3e0", 직접수정: "#f3e5f5" }[mLabel] || "#ffebee";
  const mColor = { 자동분류: "#1565c0", AI판단: "#e65100", 직접수정: "#6a1b9a" }[mLabel] || "#c62828";
  const srcLabel = { card: "FC카드", biz_card: "사업자카드", bank: "통장", invoice_sales: "계산서(매)", invoice_purchase: "계산서(매)", cash: "현금영수증" }[tx.source] || tx.source;

  return (
    <tr style={{ background: isUncl ? "#fff8e1" : "transparent", borderLeft: `3px solid ${borderColor}` }}>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6", whiteSpace: "nowrap", fontSize: 12 }}>{tx.date}</td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6", maxWidth: 160 }} title={name}>{name.length > 18 ? name.slice(0, 18) + "…" : name}</td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6", textAlign: "right", whiteSpace: "nowrap" }}>{fmt(amt)}</td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6", fontSize: 11, whiteSpace: "nowrap" }}>{srcLabel}</td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6" }}>
        <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: typeBg, color: typeColor, whiteSpace: "nowrap" }}>{typeLabel}</span>
      </td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6" }}>
        <select value={cat} onChange={e => setCat(e.target.value)} style={{ padding: "3px 6px", border: "1px solid #c5cae9", borderRadius: 6, fontSize: 12 }}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6" }}>
        <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: mBg, color: mColor, whiteSpace: "nowrap" }}>{mLabel}</span>
      </td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6" }}>
        <button onClick={async () => {
          const kw = cat !== tx.category ? prompt(`"${cat}" 규칙 키워드? (취소=규칙저장안함)`, tx.merchant || tx.memo || "") : null;
          await onSave(tx, cat, kw);
        }} style={{ padding: "3px 8px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>저장</button>
      </td>
    </tr>
  );
}
