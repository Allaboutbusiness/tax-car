"use client";
import Link from "next/link";
import BottomNav from "../components/BottomNav";

export default function Home() {
  return (
    <div style={{ minHeight: "100vh", background: "#f0f4ff" }}>
      <div style={{
        background: "linear-gradient(135deg, #1565c0 0%, #1976d2 100%)",
        color: "#fff", padding: "32px 24px 24px", textAlign: "center",
      }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>🧾</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>세무 자동 정리</h1>
        <p style={{ fontSize: 13, opacity: 0.8, marginTop: 6, margin: "6px 0 0" }}>
          김진기 CFO를 위한
        </p>
      </div>

      <div style={{ padding: "20px 16px", maxWidth: 480, margin: "0 auto" }}>
        <Link href="/tax" style={{ textDecoration: "none", display: "block", marginBottom: 14 }}>
          <div style={{
            background: "#fff", borderRadius: 16, padding: "20px 22px",
            display: "flex", alignItems: "center", gap: 16,
            boxShadow: "0 2px 12px rgba(21,101,192,.12)",
            borderLeft: "5px solid #1565c0",
          }}>
            <span style={{ fontSize: 38 }}>📊</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, color: "#1565c0" }}>세무 정리</div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 4, lineHeight: 1.5 }}>
                통장·카드 내역 → 자동 분류<br />
                홈택스 지급명세서 크로스체크 → 엑셀 내보내기
              </div>
            </div>
            <span style={{ marginLeft: "auto", fontSize: 20, color: "#c5cae9" }}>›</span>
          </div>
        </Link>

        <Link href="/car" style={{ textDecoration: "none", display: "block" }}>
          <div style={{
            background: "#fff", borderRadius: 16, padding: "20px 22px",
            display: "flex", alignItems: "center", gap: 16,
            boxShadow: "0 2px 12px rgba(46,125,50,.12)",
            borderLeft: "5px solid #2e7d32",
          }}>
            <span style={{ fontSize: 38 }}>🚗</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, color: "#2e7d32" }}>차량 운행일지</div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 4, lineHeight: 1.5 }}>
                GPS 기반 운행 기록<br />
                차량비 100% 공제 → 엑셀 자동 생성
              </div>
            </div>
            <span style={{ marginLeft: "auto", fontSize: 20, color: "#c5cae9" }}>›</span>
          </div>
        </Link>

        <div style={{ marginTop: 24, padding: "16px", background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,.07)" }}>
          <div style={{ fontSize: 12, color: "#888", lineHeight: 1.8 }}>
            💡 <strong>사용 순서</strong><br />
            ① 세무정리 → 파일 업로드 → 분류 검토<br />
            ② 홈택스 지급명세서 업로드 → 수입 크로스체크<br />
            ③ 차량운행일지 → 운행할 때마다 기록<br />
            ④ 내보내기 → 엑셀 다운로드
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
