// SONDA TEMPORARIA
module.exports = function handler(_req, res) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, probe: "cjs", node: process.version }));
};
