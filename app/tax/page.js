"use client";

import { useState, useRef, useCallback } from "react";
import { loadRules, saveRules, addRule, applyRules, CATEGORIES } from "../../lib/rules";

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

// ── 컴포넌트 ────────────────────────────────────────────
export default function TaxPage() {
  const thisYear = new Date().getFullYear().toString();
  const [year, setYear] = useState(thisYear);
  const [txs, setTxs] = useState([]);
  const [carRatio, setCarRatio] = useState(() => loadConfig().car_business_ratio || 80);
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState("upload");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const bankRef = useRef();
  const cardRef = useRef();
  const [bankName, setBankName] = useState("");
  const [cardName, setCardName] = useState("");
  const [rules, setRulesState] = useState(() => { try { return loadRules(); } catch { return []; } });

  const loadTxs = useCallback((y) => {
    const data = loadData(y || year);
    setTxs(data);
    return data;
  }, [year]);

  const handleTab = (t) => {
    setTab(t);
    if (t === "review" || t === "export") loadTxs(year);
  };

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

      // 기존 데이터와 병합 (중복 제거)
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
    tab: (active) => ({ padding: "12px 18px", cursor: "pointer", fontSize: 14, fontWeight: active ? 700 : 400, color: active ? "#1565c0" : "#888", borderBottom: active ? "3px solid #1565c0" : "3px solid transparent", whiteSpace: "nowrap", background: "none", border: "none", borderBottom: active ? "3px solid #1565c0" : "3px solid transparent" }),
    panel: { padding: "16px", maxWidth: 900, margin: "0 auto" },
    card: { background: "#fff", borderRadius: 12, padding: 18, marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,.07)" },
    btn: (bg) => ({ background: bg, color: "#fff", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }),
    input: { padding: "8px 12px", border: "1.5px solid #c5cae9", borderRadius: 8, fontSize: 14, width: "100%", boxSizing: "border-box" },
    dropZone: { border: "2px dashed #90caf9", borderRadius: 10, padding: "20px", textAlign: "center", cursor: "pointer", background: "#f5f9ff" },
  };

  return (
    <div style={ss.wrap}>
      <div style={ss.header}>
        <a href="/" style={ss.back}>←</a>
        <span style={{ fontSize: 20 }}>📊</span>
        <strong style={{ fontSize: 16 }}>세무 정리</strong>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <select value={year} onChange={e => { setYear(e.target.value); loadTxs(e.target.value); }}
            style={{ padding: "4px 8px", borderRadius: 6, border: "none", fontSize: 13 }}>
            {["2025", "2026", "2024"].map(y => <option key={y} value={y}>{y}년</option>)}
          </select>
        </div>
      </div>

      <div style={ss.tabs}>
        {[["upload","① 업로드"],["review","② 분류검토"],["export","③ 내보내기"]].map(([t,l]) => (
          <button key={t} style={ss.tab(tab===t)} onClick={() => handleTab(t)}>{l}</button>
        ))}
      </div>

      {/* ① 업로드 */}
      {tab === "upload" && (
        <div style={ss.panel}>
          <div style={ss.card}>
            <h3 style={{ color: "#1565c0", marginBottom: 14, fontSize: 15 }}>📁 파일 업로드</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div style={ss.dropZone} onClick={() => bankRef.current?.click()}>
                <input ref={bankRef} type="file" accept=".xls,.xlsx" style={{ display: "none" }}
                  onChange={e => setBankName(e.target.files[0]?.name || "")} />
                <div style={{ fontSize: 28 }}>🏦</div>
                <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>국민은행 XLS</div>
                <div style={{ fontSize: 12, color: "#1565c0", fontWeight: 700, marginTop: 4 }}>{bankName || "파일 없음"}</div>
              </div>
              <div style={ss.dropZone} onClick={() => cardRef.current?.click()}>
                <input ref={cardRef} type="file" accept=".xls,.xlsx" style={{ display: "none" }}
                  onChange={e => setCardName(e.target.files[0]?.name || "")} />
                <div style={{ fontSize: 28 }}>💳</div>
                <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>신한카드 XLS</div>
                <div style={{ fontSize: 12, color: "#1565c0", fontWeight: 700, marginTop: 4 }}>{cardName || "파일 없음"}</div>
              </div>
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

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {[["all","전체"],["rule","✅ 규칙"],["ai","🤖 AI"],["manual","✏️ 수동"],["unclassified","❓ 미분류"]].map(([f,l]) => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "5px 12px", borderRadius: 16, border: "1.5px solid #c5cae9", fontSize: 12, fontWeight: 600,
                cursor: "pointer", background: filter === f ? "#1565c0" : "#fff", color: filter === f ? "#fff" : "#555",
              }}>{l}</button>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#888", alignSelf: "center" }}>{filtered.length}건</span>
          </div>

          <div style={{ ...ss.card, padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#1565c0" }}>
                  {["날짜","거래처/메모","금액","출처","카테고리","분류","저장"].map(h => (
                    <th key={h} style={{ color: "#fff", padding: "9px 10px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx, i) => {
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
    </div>
  );
}

function TxRow({ tx, amt, name, isUncl, onSave }) {
  const [cat, setCat] = useState(tx.category);
  const rowBg = isUncl ? "#fff8e1" : "transparent";
  const borderColor = { rule: "#2e7d32", ai: "#e65100", manual: "#6a1b9a", unclassified: "#c62828", ai_low: "#c62828" }[tx.method] || "#ccc";

  return (
    <tr style={{ background: rowBg, borderLeft: `3px solid ${borderColor}` }}>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6", whiteSpace: "nowrap" }}>{tx.date}</td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6", maxWidth: 180 }} title={name}>{name.length > 20 ? name.slice(0, 20) + "…" : name}</td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6", textAlign: "right", whiteSpace: "nowrap" }}>{fmt(amt)}</td>
      <td style={{ padding: "6px 10px", borderBottom: "1px solid #e8eaf6" }}>{tx.source === "card" ? "카드" : "통장"}</td>
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
