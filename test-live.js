// test-live.js — Smoke test: run MintGuard against real demo contracts and
// print the verdicts. All evidence is live (BSC public RPC + Sourcify v2).
// Usage: node test-live.js [contract] [expectedPrice] [xHandle]
// With no args it checks the three demo contracts.
const { verifyMint } = require("./lib/checks");
const { score } = require("./lib/verdict");

const DEMOS = [
  { contract: "0x6288DFe86f22B53eEB6886aE2D78941de7483743", label: "AGCC mint", expectedPrice: null, xHandle: null },
  { contract: "0x4EF929aF00cB93993c3D01834C4DA79200d31e32", label: "Pokechain", expectedPrice: "0", xHandle: "PokechainTrade" },
  { contract: "0xDAf554230466979b65c247E1A73F3e0C24595c6D", label: "MetaFishtank fish", expectedPrice: "0", xHandle: null },
  { contract: "0x0000000000000000000000000000000000000000", label: "zero address (should BLOCK: no code)", expectedPrice: null, xHandle: null },
];

async function main() {
  const list = process.argv[2]
    ? [{ contract: process.argv[2], label: "CLI", expectedPrice: process.argv[3] || null, xHandle: process.argv[4] || null }]
    : DEMOS;
  for (const d of list) {
    const t0 = Date.now();
    try {
      const r = await verifyMint({ contract: d.contract, expectedPrice: d.expectedPrice, xHandle: d.xHandle });
      const s = score(r.checks);
      console.log(`\n=== ${d.label} ${d.contract} ===`);
      console.log(`verdict: ${s.verdict}  score: ${s.score}/100  block: ${r.block}  took: ${Date.now() - t0}ms`);
      console.log(`reason: ${s.reason}`);
      for (const c of r.checks) {
        console.log(`  [${c.status.toUpperCase().padEnd(7)}] ${c.id}: ${c.detail}`);
      }
    } catch (e) {
      console.log(`\n=== ${d.label} ${d.contract} ===\nERROR: ${e.message}`);
    }
  }
}

main();
