export const metadata = {
  title: "차량운행일지",
  description: "보험설계사 차량운행기록부",
  manifest: "/manifest.json",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1565c0",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="차량운행일지" />
      </head>
      <body style={{ margin: 0, padding: 0, background: "#f0f4ff", fontFamily: "-apple-system, 'Malgun Gothic', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
