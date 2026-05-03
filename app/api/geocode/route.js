export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  if (!lat || !lon) {
    return Response.json({ address: null });
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ko`,
      { headers: { "User-Agent": "tax-car-log/1.0 (personal-tax-app)" }, next: { revalidate: 0 } }
    );
    const data = await res.json();
    const parts = data.address || {};
    const simplified = [
      parts.city || parts.county,
      parts.suburb || parts.quarter,
      parts.road,
      parts.house_number,
    ].filter(Boolean).join(" ");
    return Response.json({ address: simplified || data.display_name || `${lat}, ${lon}` });
  } catch {
    return Response.json({ address: `${parseFloat(lat).toFixed(5)}, ${parseFloat(lon).toFixed(5)}` });
  }
}
