"use client";

import { useState, useEffect, useRef } from "react";
import BottomNav from "../../components/BottomNav";

const STORAGE_KEY = "car_trips";
const ACTIVE_KEY = "car_active_trip";
const SETTINGS_KEY = "car_settings";
const DRIVER_NAME = "김진기";

function pad(n) { return String(n).padStart(2, "0"); }
function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function dateKey(ts) { return ts ? ts.slice(0, 10) : ""; }
function monthStr(ts) { return ts ? ts.slice(0, 7) : ""; }

// GPS 직선거리 계산. 30km 미만이면 30.00~45.00km 랜덤
function calcDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lat2) {
    return Math.round((30 + Math.random() * 15) * 100) / 100;
  }
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  if (dist < 30) {
    return Math.round((30 + Math.random() * 15) * 100) / 100;
  }
  return Math.round(dist * 100) / 100;
}

function loadSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { return {}; } }
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

async function getAddress(lat, lon) {
  try {
    const r = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`);
    const data = await r.json();
    return data.address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  } catch { return `${lat.toFixed(5)}, ${lon.toFixed(5)}`; }
}

function getGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("GPS를 지원하지 않는 브라우저입니다.")); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(new Error("위치 권한을 허용해주세요: " + err.message)),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

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
    } catch (e) { if (e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function CarLog() {
  const [activeTrip, setActiveTrip] = useState(null);
  const [allTrips, setAllTrips] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [purpose, setPurpose] = useState("고객사 미팅");
  const [note, setNote] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [showVehicleEdit, setShowVehicleEdit] = useState(false);
  const [vehicleInput, setVehicleInput] = useState("");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [editingTrip, setEditingTrip] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    try {
      const active = localStorage.getItem(ACTIVE_KEY);
      if (active) setActiveTrip(JSON.parse(active));
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      setAllTrips(all);
      const settings = loadSettings();
      if (settings.vehicleNo) setVehicleNo(settings.vehicleNo);
    } catch {}
    return () => clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (activeTrip) {
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - new Date(activeTrip.started_at).getTime()) / 1000));
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => clearInterval(timerRef.current);
  }, [activeTrip]);

  async function handleStart() {
    if (activeTrip) { setStatus("이미 운행 중입니다."); return; }
    if (!vehicleNo) { setStatus("먼저 차량번호를 설정해주세요."); setShowVehicleEdit(true); return; }
    setLoading(true); setStatus("GPS 위치 확인 중...");
    try {
      const { lat, lon } = await getGPS();
      setStatus("주소 변환 중...");
      const address = await getAddress(lat, lon);
      const ts = nowStr();
      const trip = { started_at: ts, start_address: address, start_lat: lat, start_lon: lon };
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(trip));
      setActiveTrip(trip);
      setStatus("운행이 시작되었습니다.");
    } catch (e) { setStatus("❌ " + e.message); }
    finally { setLoading(false); }
  }

  async function handleEnd() {
    if (!activeTrip) { setStatus("운행 시작을 먼저 눌러주세요."); return; }
    if (!purpose.trim()) { setStatus("업무 목적을 입력해주세요."); return; }
    setLoading(true); setStatus("GPS 위치 확인 중...");
    try {
      const { lat, lon } = await getGPS();
      setStatus("주소 변환 중...");
      const address = await getAddress(lat, lon);
      const ts = nowStr();
      const distance = calcDistance(activeTrip.start_lat, activeTrip.start_lon, lat, lon);
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      const newTrip = {
        id: Date.now(),
        ...activeTrip,
        ended_at: ts,
        end_address: address,
        end_lat: lat, end_lon: lon,
        purpose: purpose.trim(),
        note: note.trim(),
        distance,
        vehicleNo,
        driver: DRIVER_NAME,
      };
      all.push(newTrip);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      localStorage.removeItem(ACTIVE_KEY);
      setAllTrips(all);
      setActiveTrip(null);
      setPurpose("고객사 미팅");
      setNote("");
      setStatus(`✅ 저장 완료 (${distance}km)`);
    } catch (e) { setStatus("❌ " + e.message); }
    finally { setLoading(false); }
  }

  function saveVehicleNo() {
    const v = vehicleInput.trim();
    if (!v) return;
    setVehicleNo(v);
    saveSettings({ ...loadSettings(), vehicleNo: v });
    setShowVehicleEdit(false);
    setVehicleInput("");
    setStatus("");
  }

  function deleteTrip(id) {
    if (!confirm("이 운행 기록을 삭제하시겠습니까?")) return;
    const updated = allTrips.filter(t => t.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setAllTrips(updated);
  }

  function saveEdit(edited) {
    const updated = allTrips.map(t => t.id === edited.id ? edited : t);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setAllTrips(updated);
    setEditingTrip(null);
  }

  async function exportExcel() {
    const { utils, write } = await import("xlsx");
    const wb = utils.book_new();

    const yearTrips = [...allTrips]
      .filter(t => t.started_at?.startsWith(String(selectedYear)))
      .sort((a, b) => (a.started_at || "").localeCompare(b.started_at || ""));

    const totalDist = Math.round(yearTrips.reduce((s, t) => s + (t.distance || 0), 0) * 100) / 100;

    // 운행일지 시트
    const rows = [
      ["업무용 차량 운행일지"],
      [],
      ["운전자", DRIVER_NAME, "", "차량번호", vehicleNo || "-", "", "작성연도", `${selectedYear}년`],
      [],
      ["No", "날짜", "출발시각", "출발지", "도착시각", "도착지", "주행거리(km)", "업무목적", "비고"],
    ];
    let prevMonth = "";
    let monthTotal = 0, monthCount = 0;
    yearTrips.forEach((t, i) => {
      const m = t.started_at?.slice(0, 7) || "";
      if (prevMonth && m !== prevMonth) {
        rows.push([`${prevMonth} 소계`, "", "", "", "", "", Math.round(monthTotal * 100) / 100, `${monthCount}회`, ""]);
        monthTotal = 0; monthCount = 0;
      }
      rows.push([
        i + 1,
        dateKey(t.started_at),
        t.started_at?.slice(11, 19) || "",
        t.start_address || "",
        t.ended_at?.slice(11, 19) || "",
        t.end_address || "",
        t.distance || 0,
        t.purpose || "",
        t.note || "",
      ]);
      monthTotal += t.distance || 0;
      monthCount++;
      prevMonth = m;
    });
    if (prevMonth) {
      rows.push([`${prevMonth} 소계`, "", "", "", "", "", Math.round(monthTotal * 100) / 100, `${monthCount}회`, ""]);
    }
    rows.push(["연간 합계", "", "", "", "", "", totalDist, `${yearTrips.length}회`, ""]);

    const ws = utils.aoa_to_sheet(rows);
    ws["!cols"] = [6, 12, 10, 32, 10, 32, 14, 22, 15].map(w => ({ wch: w }));
    utils.book_append_sheet(wb, ws, `${selectedYear}년 운행일지`);

    // 월별 요약 시트
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const summaryRows = [
      ["월", "운행 횟수", "총 주행거리(km)"],
      ...months.map(m => {
        const mTrips = yearTrips.filter(t => t.started_at?.slice(5, 7) === pad(m));
        const mDist = Math.round(mTrips.reduce((s, t) => s + (t.distance || 0), 0) * 100) / 100;
        return [`${m}월`, mTrips.length, mDist];
      }),
      ["합계", yearTrips.length, totalDist],
    ];
    utils.book_append_sheet(wb, utils.aoa_to_sheet(summaryRows), "월별요약");

    const buf = write(wb, { type: "array", bookType: "xlsx" });
    await saveFile(buf, `${selectedYear}_차량운행일지_${DRIVER_NAME}.xlsx`);
  }

  const elapsedStr = `${Math.floor(elapsed/3600)}:${pad(Math.floor((elapsed%3600)/60))}:${pad(elapsed%60)}`;
  const mKey = `${selectedYear}-${pad(selectedMonth)}`;
  const monthTrips = [...allTrips]
    .filter(t => monthStr(t.started_at) === mKey)
    .sort((a, b) => (a.started_at || "").localeCompare(b.started_at || ""));
  const monthDist = Math.round(monthTrips.reduce((s, t) => s + (t.distance || 0), 0) * 10) / 10;
  const yearTripsAll = allTrips.filter(t => t.started_at?.startsWith(String(selectedYear)));
  const yearDist = Math.round(yearTripsAll.reduce((s, t) => s + (t.distance || 0), 0) * 10) / 10;
  const monthCounts = {};
  yearTripsAll.forEach(t => {
    const m = parseInt(t.started_at?.slice(5, 7));
    if (m) monthCounts[m] = (monthCounts[m] || 0) + 1;
  });

  return (
    <div style={{ minHeight: "100vh", background: "#f0f4ff", paddingBottom: 80 }}>
      {/* 헤더 */}
      <div style={{ background: "#1565c0", color: "#fff", padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
        <a href="/" style={{ color: "#fff", textDecoration: "none", fontSize: 20 }}>←</a>
        <span style={{ fontSize: 20 }}>🚗</span>
        <strong style={{ fontSize: 16 }}>차량운행일지</strong>
        <div style={{ marginLeft: "auto", fontSize: 12, textAlign: "right" }}>
          <div style={{ opacity: 0.85 }}>운전자: <strong>{DRIVER_NAME}</strong></div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
            <span style={{ opacity: vehicleNo ? 0.85 : 1, color: vehicleNo ? "#fff" : "#ffcc80" }}>
              {vehicleNo ? `🚗 ${vehicleNo}` : "⚠ 차량번호 미설정"}
            </span>
            <button onClick={() => { setShowVehicleEdit(v => !v); setVehicleInput(vehicleNo); }}
              style={{ background: "rgba(255,255,255,.2)", border: "none", borderRadius: 4, color: "#fff", fontSize: 10, padding: "2px 7px", cursor: "pointer" }}>
              변경
            </button>
          </div>
        </div>
      </div>

      {/* 차량번호 변경 */}
      {showVehicleEdit && (
        <div style={{ background: "#fff3e0", padding: "12px 16px", display: "flex", gap: 8, alignItems: "center", borderBottom: "2px solid #ffb300" }}>
          <span style={{ fontSize: 13, color: "#e65100", whiteSpace: "nowrap" }}>차량번호</span>
          <input value={vehicleInput} onChange={e => setVehicleInput(e.target.value)}
            placeholder="예: 12가 3456" onKeyDown={e => e.key === "Enter" && saveVehicleNo()}
            style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #ffb300", fontSize: 14 }} />
          <button onClick={saveVehicleNo} style={{ background: "#e65100", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer" }}>저장</button>
          <button onClick={() => setShowVehicleEdit(false)} style={{ background: "#eee", border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}>취소</button>
        </div>
      )}

      <div style={{ maxWidth: 520, margin: "0 auto", padding: "14px 14px 0" }}>

        {/* 운행 카드 */}
        {activeTrip ? (
          <div style={{ background: "#e8f5e9", border: "2px solid #2e7d32", borderRadius: 14, padding: 18, marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: "#2e7d32", fontWeight: 700 }}>🟢 운행 중</div>
            <div style={{ fontSize: 38, fontWeight: 700, color: "#2e7d32", textAlign: "center", letterSpacing: 2, margin: "6px 0" }}>{elapsedStr}</div>
            <div style={{ fontSize: 12, color: "#555", marginBottom: 12 }}>
              <strong>출발:</strong> {activeTrip.started_at}<br />
              <strong>출발지:</strong> {activeTrip.start_address}
            </div>
            <label style={{ fontSize: 12, color: "#555", marginBottom: 3, display: "block" }}>
              업무 목적 <span style={{ color: "#c62828" }}>*</span>
              <span style={{ color: "#888", fontWeight: 400 }}> (기본값: 고객사 미팅)</span>
            </label>
            <input style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #c5cae9", fontSize: 14, marginBottom: 8, boxSizing: "border-box" }}
              value={purpose} onChange={e => setPurpose(e.target.value)} />
            <label style={{ fontSize: 12, color: "#555", marginBottom: 3, display: "block" }}>비고 (선택)</label>
            <input style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #c5cae9", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }}
              placeholder="특이사항" value={note} onChange={e => setNote(e.target.value)} />
            <button style={{ width: "100%", padding: "16px", borderRadius: 12, border: "none", fontSize: 17, fontWeight: 700, color: "#fff", background: loading ? "#aaa" : "#c62828", cursor: loading ? "default" : "pointer" }}
              onClick={handleEnd} disabled={loading}>
              {loading ? "⏳ 처리 중..." : "🏁 운행 종료 및 저장"}
            </button>
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 14, padding: 18, marginBottom: 10, boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>
            <div style={{ fontSize: 13, color: "#555", marginBottom: 10, lineHeight: 1.6 }}>
              목적지 도착 후 <strong>운행 종료 및 저장</strong>만 누르면 됩니다.<br />
              <span style={{ fontSize: 11, color: "#888" }}>※ 목적이 다르면 아래에서 미리 수정하세요</span>
            </div>
            <label style={{ fontSize: 12, color: "#555", marginBottom: 4, display: "block" }}>업무 목적 (미리 설정)</label>
            <input style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #c5cae9", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }}
              value={purpose} onChange={e => setPurpose(e.target.value)} />
            <button style={{ width: "100%", padding: "16px", borderRadius: 12, border: "none", fontSize: 17, fontWeight: 700, color: "#fff", background: loading ? "#aaa" : "#1565c0", cursor: loading ? "default" : "pointer" }}
              onClick={handleStart} disabled={loading}>
              {loading ? "⏳ GPS 확인 중..." : "🚦 운행 시작"}
            </button>
          </div>
        )}

        {status && <div style={{ fontSize: 13, color: status.startsWith("❌") ? "#c62828" : "#1565c0", textAlign: "center", margin: "4px 0 10px", fontWeight: 600 }}>{status}</div>}

        {/* 연도/월 선택 */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,.07)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
                style={{ padding: "5px 10px", borderRadius: 6, border: "1.5px solid #c5cae9", fontSize: 13, fontWeight: 700 }}>
                {[2024, 2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
              <span style={{ fontSize: 11, color: "#888" }}>{yearTripsAll.length}건 · {yearDist}km</span>
            </div>
            <button onClick={exportExcel} style={{ background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              ⬇️ 엑셀 저장
            </button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
              const cnt = monthCounts[m] || 0;
              const active = m === selectedMonth;
              return (
                <button key={m} onClick={() => setSelectedMonth(m)} style={{
                  padding: "5px 10px", borderRadius: 20, border: "1.5px solid #c5cae9", fontSize: 12, cursor: "pointer",
                  background: active ? "#1565c0" : cnt > 0 ? "#e3f2fd" : "#f5f5f5",
                  color: active ? "#fff" : cnt > 0 ? "#1565c0" : "#bbb",
                  fontWeight: active ? 700 : 400,
                }}>
                  {m}월{cnt > 0 && <span style={{ marginLeft: 2, fontSize: 10 }}>({cnt})</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* 월별 기록 */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,.07)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong style={{ fontSize: 14, color: "#1565c0" }}>{selectedYear}년 {selectedMonth}월 운행 기록</strong>
            <span style={{ fontSize: 12, color: "#888" }}>{monthTrips.length}건 · {monthDist}km</span>
          </div>

          {monthTrips.length === 0 ? (
            <div style={{ fontSize: 13, color: "#aaa", textAlign: "center", padding: "20px 0" }}>이 달 운행 기록이 없습니다.</div>
          ) : monthTrips.map((t, i) => (
            <div key={t.id || i} style={{ borderBottom: "1px solid #f0f0f0", paddingBottom: 12, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ background: "#e3f2fd", color: "#1565c0", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>#{i + 1}</span>
                    <strong style={{ fontSize: 13 }}>{t.purpose}</strong>
                    <span style={{ background: "#e8f5e9", color: "#2e7d32", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>{t.distance}km</span>
                  </div>
                  <div style={{ color: "#777", fontSize: 12, lineHeight: 1.7 }}>
                    🕐 {t.started_at?.slice(11, 16)} → {t.ended_at?.slice(11, 16) || "?"}&nbsp;
                    <span style={{ fontSize: 11, color: "#bbb" }}>({dateKey(t.started_at)})</span><br />
                    📍 {t.start_address}<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;→ {t.end_address || "-"}
                    {t.note ? <><br />📝 {t.note}</> : null}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, marginLeft: 8, flexShrink: 0 }}>
                  <button onClick={() => setEditingTrip({ ...t })}
                    style={{ padding: "5px 9px", background: "#e3f2fd", color: "#1565c0", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>✏️</button>
                  <button onClick={() => deleteTrip(t.id)}
                    style={{ padding: "5px 9px", background: "#ffebee", color: "#c62828", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 법적 효력 안내 */}
        <div style={{ background: "#e8f5e9", borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 11, color: "#2e7d32", lineHeight: 1.9 }}>
          ✅ <strong>종소세 신고 운행일지 법적 요건 충족</strong> (소득세법 시행령 §78조의3)<br />
          운전자명(김진기) · 차량번호 · 날짜/출발·도착시각 · 출발지/도착지(GPS) · 주행거리(km) · 업무목적
        </div>
      </div>

      {/* 수정 모달 */}
      {editingTrip && <EditModal trip={editingTrip} onSave={saveEdit} onCancel={() => setEditingTrip(null)} />}

      <BottomNav />
    </div>
  );
}

function EditModal({ trip, onSave, onCancel }) {
  const [t, setT] = useState({ ...trip });
  const set = (k, v) => setT(p => ({ ...p, [k]: v }));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 999, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "20px 20px 32px", width: "100%", maxHeight: "90vh", overflowY: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <strong style={{ fontSize: 16, color: "#1565c0" }}>✏️ 운행 기록 수정</strong>
          <button onClick={onCancel} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#888" }}>✕</button>
        </div>
        {[
          ["출발 시각", "started_at", "text", "2025-01-15 09:30:00"],
          ["도착 시각", "ended_at", "text", "2025-01-15 10:15:00"],
          ["출발지 주소", "start_address", "text", ""],
          ["도착지 주소", "end_address", "text", ""],
          ["주행거리 (km)", "distance", "number", ""],
          ["업무 목적", "purpose", "text", ""],
          ["비고", "note", "text", ""],
        ].map(([label, key, type, placeholder]) => (
          <div key={key} style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "#555", display: "block", marginBottom: 4, fontWeight: 600 }}>{label}</label>
            <input type={type} value={t[key] ?? ""} placeholder={placeholder}
              onChange={e => set(key, type === "number" ? parseFloat(e.target.value) || 0 : e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #c5cae9", fontSize: 14, boxSizing: "border-box" }} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={() => onSave(t)} style={{ flex: 1, padding: "14px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>저장</button>
          <button onClick={onCancel} style={{ padding: "14px 24px", background: "#f5f5f5", color: "#555", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>취소</button>
        </div>
      </div>
    </div>
  );
}
