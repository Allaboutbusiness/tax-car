"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", icon: "🏠", label: "홈" },
  { href: "/tax", icon: "📊", label: "세무정리" },
  { href: "/car", icon: "🚗", label: "차량일지" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <>
      {/* 하단 고정 탭바 높이만큼 여백 */}
      <div style={{ height: 64 }} />
      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0, height: 64,
        background: "#fff", borderTop: "1.5px solid #e0e7ff",
        display: "flex", zIndex: 100,
        boxShadow: "0 -2px 12px rgba(0,0,0,.08)",
      }}>
        {tabs.map(({ href, icon, label }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link key={href} href={href} style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", textDecoration: "none",
              color: active ? "#1565c0" : "#999",
              background: active ? "#f0f4ff" : "transparent",
              borderTop: active ? "3px solid #1565c0" : "3px solid transparent",
              transition: "all .15s",
              fontSize: 11, fontWeight: active ? 700 : 400, gap: 2,
            }}>
              <span style={{ fontSize: 22 }}>{icon}</span>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
