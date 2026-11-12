// Serves RAD clan point standings at /api/points.
// The Google Sheet link lives ONLY in the Netlify environment variable POINTS_SHEET_CSV_URL
// (never in this repo or the page), and only RSN + lifetime points are returned to visitors.

function parseCSV(t: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const json = (body: unknown, status = 200, maxAge = 300) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": `public, max-age=${maxAge}` },
  });

export default async () => {
  const url = Netlify.env.get("POINTS_SHEET_CSV_URL");
  if (!url) return json({ error: "not_configured" }, 503, 60);
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return json({ error: "sheet_unavailable" }, 502, 60);
    const rows = parseCSV(await res.text());
    const hi = rows.findIndex(r => r.some(c => c.trim().toUpperCase() === "RSN"));
    if (hi < 0) return json({ error: "sheet_format" }, 502, 60);
    const head = rows[hi].map(c => c.trim().toLowerCase());
    const nameCol = head.indexOf("rsn");
    const ptsHead = head.findIndex(c => /points/.test(c));
    const ptsCol = ptsHead >= 0 ? ptsHead : nameCol + 1;
    const seen = new Set<string>();
    const riders = rows.slice(hi + 1)
      .map(r => ({ name: (r[nameCol] || "").trim(), pts: parseInt(String(r[ptsCol] || "").replace(/[^0-9-]/g, ""), 10) }))
      .filter(r => r.name && !Number.isNaN(r.pts) && !seen.has(r.name.toLowerCase()) && !!seen.add(r.name.toLowerCase()));
    return json({ updated: new Date().toISOString(), riders });
  } catch {
    return json({ error: "sheet_unavailable" }, 502, 60);
  }
};

export const config = { path: "/api/points" };
