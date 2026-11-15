// api/verify.js — Vercel serverless wrapper around the same verify logic
// used by server.js. Kept thin on purpose: all evidence gathering lives in lib/.
const { isAddr } = require("../lib/rpc");
const { verifyMint } = require("../lib/checks");
const { score } = require("../lib/verdict");

module.exports = async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  const input = req.method === "POST" ? (req.body || {}) : (req.query || {});
  const contract = String(input.contract || "").trim();
  const expectedPrice = input.expectedPrice !== undefined && input.expectedPrice !== null && input.expectedPrice !== ""
    ? String(input.expectedPrice).trim() : null;
  const xHandle = input.xHandle ? String(input.xHandle).trim() : null;

  if (!isAddr(contract)) {
    return res.status(400).json({ error: "contract must be a 0x + 40-hex BSC address", received: contract });
  }
  if (expectedPrice !== null && !/^\d+(\.\d+)?$/.test(expectedPrice)) {
    return res.status(400).json({ error: "expectedPrice must be a decimal BNB amount", received: expectedPrice });
  }
  if (xHandle !== null && !/^@?[A-Za-z0-9_]{1,15}$/.test(xHandle)) {
    return res.status(400).json({ error: "xHandle must be a valid X handle", received: xHandle });
  }

  const started = Date.now();
  try {
    const result = await verifyMint({ contract, expectedPrice, xHandle });
    const s = score(result.checks);
    return res.status(200).json({
      agent: "MintGuard",
      version: "1.0.0",
      verdict: s.verdict,
      score: s.score,
      reason: s.reason,
      contract: result.contract,
      chain: "BSC (56)",
      block: result.block,
      checkedAt: new Date().toISOString(),
      tookMs: Date.now() - started,
      checks: result.checks,
      meta: result.meta,
      reproducibility:
        "Re-run these exact probes at the pinned block above to reproduce this verdict. " +
        "Evidence URLs/commands are in each check's `evidence` field. A check that could " +
        "not be performed is reported as `unknown`, never as clean.",
    });
  } catch (e) {
    return res.status(500).json({ error: "internal error", detail: e.message });
  }
};
