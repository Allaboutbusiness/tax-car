"use client";

import { useState, useEffect, useRef } from "react";
import BottomNav from "../../components/BottomNav";

const STORAGE_KEY = "car_trips";
const ACTIVE_KEY = "car_active_trip";

function pad(n) {
  return String(n).padStart(2, "0");
}

function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function dateKey(ts) {
  return ts ? ts.slice(0, 10) : "";
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

async function getAddress(lat, lon) {
  try {
    const r = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`);
    const data = await r.json();
    return data.address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
}

function getGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("GPS를 지원하지 않는 브라우저입니다."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(new Error("위치 권한을 허용해주세요: " + err.message)),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

export default function CarLog() {
  const [activeTrip, setActiveTrip] = useState(null);
  const [todayTrips, setTodayTrips] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [allTrips, setAllTrips] = useState([]);
  const timerRef = useRef(null);

  useEffect(() => {
    loadState();
    return () => clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (activeTrip) {
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        const diff = Math.floor((Date.now() - new Date(activeTrip.started_at).getTime()) / 1000);
        setElapsed(diff);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => clearInterval(timerRef.current);
  }, [activeTrip]);

  function loadState() {
    try {
      const active = localStorage.getItem(ACTIVE_KEY);
      if (active) setActiveTrip(JSON.parse(active));

      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      setAllTrips(all);
      setTodayTrips(all.filter(t => dateKey(t.started_at) === todayKey()));
    } catch {}
  }

  async function handleStart() {
    if (activeTrip) {
      setStatus("이미 운행 중입니다. 먼저 운행을 종료해주세요.");
      return;
    }
    setLoading(true);
    setStatus("GPS 위치 확인 중...");
    try {
      const { lat, lon } = await getGPS();
      setStatus("주소 변환 중...");
      const address = await getAddress(lat, lon);
      const ts = nowStr();
      const trip = { started_at: ts, start_address: address, start_lat: lat, start_lon: lon };
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(trip));
      setActiveTrip(trip);
      setStatus("운행이 시작되었습니다.");
    } catch (e) {
      setStatus("❌ " + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEnd() {
    if (!activeTrip) {
      setStatus("운행 시작을 먼저 눌러주세요.");
      return;
    }
    if (!purpose.trim()) {
      setStatus("업무 목적을 입력해주세요.");
      return;
    }
    setLoading(true);
    setStatus("GPS 위치 확인 중...");
    try {
      const { lat, lon } = await getGPS();
      setStatus("주소 변환 중...");
      const address = await getAddress(lat, lon);
      const ts = nowStr();
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      const newTrip = {
        ...activeTrip,
        ended_at: ts,
        end_address: address,
        end_lat: lat,
        end_lon: lon,
        purpose: purpose.trim(),
        note: note.trim(),
      };
      all.push(newTrip);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      localStorage.removeItem(ACTIVE_KEY);
      setAllTrips(all);
      setTodayTrips(all.filter(t => dateKey(t.started_at) === todayKey()));
      setActiveTrip(null);
      setPurpose("");
      setNote("");
      setStatus("✅ 운행이 저장되었습니다.");
    } catch (e) {
      setStatus("❌ " + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function exportExcel() {
    const { utils, write } = await import("xlsx");
    const ws_data = [
      ["No", "날짜", "출발시각", "출발지", "도착시각", "도착지", "업무목적", "비고"],
      ...allTrips.map((t, i) => [
        i + 1,
        dateKey(t.started_at),
        t.started_at?.slice(11, 19) || "",
        t.start_address || "",
        t.ended_at?.slice(11, 19) || "",
        t.end_address || "",
        t.purpose || "",
        t.note || "",
      ]),
    ];
    const wb = utils.book_new();
    const ws = utils.aoa_to_sheet(ws_data);
    ws["!cols"] = [6,12,10,28,10,28,20,15].map(w => ({ wch: w }));
    utils.book_append_sheet(wb, ws, "차량운행일지");
    const buf = write(wb, { type: "array", bookType: "xlsx" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date();
    a.download = `${String(today.getFullYear()).slice(2)}${pad(today.getMonth()+1)}${pad(today.getDate())}_CAR.xlsx`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }

  const elapsedStr = elapsed > 0
    ? `${Math.floor(elapsed/3600)}:${pad(Math.floor((elapsed%3600)/60))}:${pad(elapsed%60)}`
    : "0:00:00";

  const ss = {
    page: { minHeight: "100vh", background: "#f0f4ff", paddingBottom: 32 },
    header: { background: "#1565c0", color: "#fff", padding: "16px 20px", textAlign: "center" },
    h1: { fontSize: 18, fontWeight: 700, margin: 0 },
    sub: { fontSize: 12, opacity: 0.8, marginTop: 4 },
    content: { maxWidth: 480, margin: "0 auto", padding: "16px 16px 0" },
    card: { background: "#fff", borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: "0 2px 8px rgba(0,0,0,.08)" },
    activeCard: { background: "#e8f5e9", border: "2px solid #2e7d32", borderRadius: 14, padding: 20, marginBottom: 16 },
    timer: { fontSize: 36, fontWeight: 700, color: "#2e7d32", textAlign: "center", letterSpacing: 2, margin: "8px 0" },
    btn: (bg, disabled) => ({
      width: "100%", padding: "16px", borderRadius: 12, border: "none", fontSize: 17, fontWeight: 700,
      color: "#fff", background: disabled ? "#aaa" : bg, cursor: disabled ? "default" : "pointer",
      marginBottom: 10, transition: "opacity .2s",
    }),
    input: { width: "100%", padding: "11px 12px", borderRadius: 8, border: "1.5px solid #c5cae9", fontSize: 15, marginBottom: 10, boxSizing: "border-box" },
    label: { fontSize: 13, color: "#555", marginBottom: 4, display: "block" },
    status: { fontSize: 13, color: "#1565c0", textAlign: "center", minHeight: 20, margin: "4px 0" },
    tripRow: { borderBottom: "1px solid #eee", paddingBottom: 10, marginBottom: 10, fontSize: 13 },
    badge: { display: "inline-block", padding: "2px 8px", background: "#e3f2fd", color: "#1565c0", borderRadius: 10, fontSize: 11, fontWeight: 700, marginRight: 6 },
    histBtn: { background: "none", border: "1.5px solid #c5cae9", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer", color: "#555" },
    exportBtn: { background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  };

  return (
    <div style={ss.page}>
      <div style={ss.header}>
        <h1 style={ss.h1}>🚗 차량운행일지</h1>
        <div style={ss.sub}>업무용 차량 운행 기록 | 세금 공제용</div>
      </div>

      <div style={ss.content}>
        {/* 운행 중 카드 */}
        {activeTrip ? (
          <div style={ss.activeCard}>
            <div style={{ fontSize: 13, color: "#2e7d32", fontWeight: 700, marginBottom: 4 }}>🟢 운행 중</div>
            <div style={ss.timer}>{elapsedStr}</div>
            <div style={{ fontSize: 13, color: "#555", marginBottom: 12 }}>
              <strong>출발:</strong> {activeTrip.started_at}<br />
              <strong>출발지:</strong> {activeTrip.start_address}
            </div>
            <label style={ss.label}>업무 목적 <span style={{ color: "#c62828" }}>*</span></label>
            <input
              style={ss.input}
              placeholder="예: 고객 미팅, 보험 상담, GA 방문"
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
            />
            <label style={ss.label}>비고 (선택)</label>
            <input
              style={ss.input}
              placeholder="특이사항 입력"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
            <button style={ss.btn("#c62828", loading)} onClick={handleEnd} disabled={loading}>
              {loading ? "⏳ 처리 중..." : "🏁 운행 종료 및 저장"}
            </button>
          </div>
        ) : (
          <div style={ss.card}>
            <div style={{ fontSize: 14, color: "#555", marginBottom: 14, lineHeight: 1.6 }}>
              운행 시작 버튼을 누르면 현재 위치가 자동으로 기록됩니다.<br />
              <span style={{ fontSize: 12, color: "#888" }}>※ 위치 권한을 허용해주세요</span>
            </div>
            <button style={ss.btn("#1565c0", loading)} onClick={handleStart} disabled={loading}>
              {loading ? "⏳ GPS 확인 중..." : "🚦 운행 시작"}
            </button>
          </div>
        )}

        <div style={ss.status}>{status}</div>

        {/* 오늘 운행 기록 */}
        <div style={ss.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong style={{ fontSize: 15, color: "#1565c0" }}>오늘 운행 기록</strong>
            <span style={{ fontSize: 12, color: "#888" }}>{todayTrips.length}건</span>
          </div>
          {todayTrips.length === 0 ? (
            <div style={{ fontSize: 13, color: "#aaa", textAlign: "center", padding: "16px 0" }}>오늘 운행 기록이 없습니다.</div>
          ) : (
            todayTrips.map((t, i) => (
              <div key={i} style={ss.tripRow}>
                <span style={ss.badge}>#{i + 1}</span>
                <strong style={{ fontSize: 12 }}>{t.purpose}</strong>
                <div style={{ color: "#777", marginTop: 4, lineHeight: 1.5 }}>
                  🕐 {t.started_at?.slice(11, 16)} → {t.ended_at?.slice(11, 16) || "운행중"}<br />
                  📍 {t.start_address} → {t.end_address || "-"}
                  {t.note ? <><br />📝 {t.note}</> : null}
                </div>
              </div>
            ))
          )}
        </div>

        {/* 하단 버튼 */}
        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
          <button style={ss.histBtn} onClick={() => setShowHistory(v => !v)}>
            {showHistory ? "▲ 기록 숨기기" : `📋 전체 기록 (${allTrips.length}건)`}
          </button>
          <button style={ss.exportBtn} onClick={exportExcel}>
            ⬇️ 엑셀 다운로드
          </button>
        </div>

        {/* 전체 기록 */}
        {showHistory && (
          <div style={{ ...ss.card, marginTop: 16 }}>
            <strong style={{ fontSize: 15, color: "#1565c0" }}>전체 운행 기록</strong>
            <div style={{ marginTop: 12 }}>
              {allTrips.length === 0 ? (
                <div style={{ fontSize: 13, color: "#aaa", textAlign: "center", padding: 16 }}>기록이 없습니다.</div>
              ) : (
                [...allTrips].reverse().map((t, i) => (
                  <div key={i} style={{ ...ss.tripRow, background: i % 2 === 0 ? "#fafafa" : "#fff", borderRadius: 6, padding: "8px 10px" }}>
                    <div style={{ fontSize: 12, color: "#888" }}>{dateKey(t.started_at)}</div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{t.purpose}</div>
                    <div style={{ fontSize: 12, color: "#777", marginTop: 2 }}>
                      {t.started_at?.slice(11, 16)} → {t.ended_at?.slice(11, 16) || "?"}
                      {t.start_address?.slice(0, 15)} → {t.end_address?.slice(0, 15) || "-"}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
