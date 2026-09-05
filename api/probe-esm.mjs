// SONDA TEMPORARIA
export default function handler(_req, res) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, probe: "esm-mjs", node: process.version }));
}
