"use client";
import Link from "next/link";

export default function Home() {
  return (
    <div style={{ minHeight: "100vh", background: "#f0f4ff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🧾</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1565c0", margin: 0 }}>세무 자동 정리</h1>
        <p style={{ color: "#888", marginTop: 8, fontSize: 14 }}>보험설계사 세무 관리 도구</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 360 }}>
        <Link href="/tax" style={{ textDecoration: "none" }}>
          <div style={{
            background: "#1565c0", color: "#fff", borderRadius: 16, padding: "24px 28px",
            display: "flex", alignItems: "center", gap: 16, boxShadow: "0 4px 16px rgba(21,101,192,.3)"
          }}>
            <span style={{ fontSize: 36 }}>📊</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>세무 정리</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>통장·카드 내역 업로드 → 자동 분류 → 엑셀 내보내기</div>
            </div>
          </div>
        </Link>

        <Link href="/car" style={{ textDecoration: "none" }}>
          <div style={{
            background: "#2e7d32", color: "#fff", borderRadius: 16, padding: "24px 28px",
            display: "flex", alignItems: "center", gap: 16, boxShadow: "0 4px 16px rgba(46,125,50,.3)"
          }}>
            <span style={{ fontSize: 36 }}>🚗</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>차량 운행일지</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>GPS 기반 운행 기록 → 차량비 100% 공제</div>
            </div>
          </div>
        </Link>
      </div>

      <p style={{ marginTop: 32, fontSize: 12, color: "#aaa" }}>© 2025 개인 세무 관리 앱</p>
    </div>
  );
}
