// api/index.js — Vercel serverless info endpoint (serves the demo page).
const fs = require("fs");
const path = require("path");

module.exports = (req, res) => {
  res.setHeader("content-type", "application/json");
  res.status(200).json({
    agent: "MintGuard",
    version: "1.0.0",
    description: "Mint-safety verification agent for .ai Agent IDs on BSC (zkVerify Agent Games, Wildcard track)",
    routes: {
      verify: "POST /verify { contract, expectedPrice?, xHandle? }",
      verify_get: "GET /verify?contract=0x...&expectedPrice=0&xHandle=...",
      health: "GET /health",
    },
    demo_contracts: [
      { label: "AGCC mint (agcc.fun)", contract: "0x6288DFe86f22B53eEB6886aE2D78941de7483743" },
      { label: "Pokechain (pokechain.trade)", contract: "0x4EF929aF00cB93993c3D01834C4DA79200d31e32" },
      { label: "MetaFishtank fish (metafishtank.com)", contract: "0xDAf554230466979b65c247E1A73F3e0C24595c6D" },
    ],
    note: "Read-only: never signs, never spends, never touches a wallet. Evidence is reproducible from the pinned block in every response.",
  });
};
