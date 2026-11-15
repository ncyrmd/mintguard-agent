// lib/verdict.js — Score the checks into a GO / CAUTION / BLOCK verdict.
//
// Scoring mirrors the bsc-contract-audit rubric (adapted for a mint gate):
// start at 100, deduct for each warn/fail, and apply hard BLOCKs that override
// the score. Every deduction cites the check that caused it.
//
// Hard BLOCK (verdict BLOCK no matter the score):
//   - contract_exists = fail            (no code at the address)
//   - paused = fail                     (contract paused)
//   - mint_price = fail                 (listed price != contract price)
//   - sale_state = fail                 (sale closed)
//   - mint_entry = fail                 (mint gated: sale not active)
//   - x_recycle = fail                  (X account does not exist / suspended)
//
// Deductions (warn/unknown):
//   - source_verified warn   -20   (cannot read the mint code)
//   - source_verified unknown -10
//   - owner warn             -10   (live owner with privileged functions)
//   - proxy warn             -5    (upgradeable via proxy admin)
//   - supply_cap warn        -10   (uncapped supply)
//   - supply_cap unknown     -5
//   - mint_price warn        -10   (price cannot be confirmed)
//   - sale_state unknown     -5
//   - mint_entry unknown     -5
//   - royalty warn           -10   (royalty > 10%)
//   - reveal warn            -5    (art still hidden)
//   - x_recycle warn         -5    (X history unverifiable — NOT clean)
//   - x_recycle unknown      -5
//
// Verdict bands: >= 85 GO · 55–84 CAUTION · < 55 BLOCK.

const HARD_BLOCK_IDS = new Set([
  "contract_exists",
  "paused",
  "mint_price",
  "sale_state",
  "mint_entry",
  "x_recycle",
]);

const DEDUCTIONS = {
  source_verified: { warn: 20, unknown: 10 },
  owner: { warn: 10 },
  proxy: { warn: 5 },
  supply_cap: { warn: 10, unknown: 5 },
  mint_price: { warn: 10 },
  sale_state: { unknown: 5 },
  mint_entry: { unknown: 5 },
  royalty: { warn: 10 },
  reveal: { warn: 5 },
  x_recycle: { warn: 5, unknown: 5 },
};

function score(checks) {
  let s = 100;
  const reasons = [];
  let hardBlock = null;

  for (const c of checks) {
    if (c.status === "fail" && HARD_BLOCK_IDS.has(c.id)) {
      hardBlock = c;
    }
    const d = DEDUCTIONS[c.id];
    if (d && d[c.status]) {
      s -= d[c.status];
      reasons.push(`-${d[c.status]} ${c.id} (${c.status}): ${c.detail}`);
    }
  }
  s = Math.max(0, s);

  let verdict;
  let reason;
  if (hardBlock) {
    verdict = "BLOCK";
    reason = `Hard block: ${hardBlock.label} — ${hardBlock.detail}`;
  } else if (s >= 85) {
    verdict = "GO";
    reason = reasons.length ? `Score ${s}/100 with notes: ${reasons.join("; ")}` : `Score ${s}/100 — all checks clear.`;
  } else if (s >= 55) {
    verdict = "CAUTION";
    reason = `Score ${s}/100 — proceed only after acknowledging: ${reasons.join("; ")}`;
  } else {
    verdict = "BLOCK";
    reason = `Score ${s}/100 — too many unresolved risks: ${reasons.join("; ")}`;
  }

  return { score: s, verdict, reason, deductions: reasons, hardBlock: hardBlock ? hardBlock.id : null };
}

module.exports = { score };
