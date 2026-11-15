// server.js — MintGuard: a mint-safety verification agent for .ai Agent IDs.
//
// The agent takes a mint project (BSC contract address + optional expected price
// and X handle) and autonomously gathers live evidence from public sources
// (BSC public RPC, Sourcify v2, the project's X profile page), then returns a
// GO / CAUTION / BLOCK verdict with a score and per-check evidence.
//
//   GET  /                  — this demo page
//   GET  /health            — { ok, time, block }
//   POST /verify            — { contract, expectedPrice?, xHandle? } -> verdict JSON
//   GET  /verify?contract=0x...&expectedPrice=0&xHandle=foo -> same (convenience)
//
// Zero dependencies (Node >= 18). Run:  node server.js  (PORT env, default 8787)
// All evidence reads are public and keyless. A check that cannot be performed
// is reported as `unknown`, never as clean.

const http = require("http");
const { isAddr } = require("./lib/rpc");
const { verifyMint } = require("./lib/checks");
const { score } = require("./lib/verdict");

const PORT = parseInt(process.env.PORT || "8787", 10);
const AGENT = "MintGuard";
const VERSION = "1.0.0";

// Demo contracts: real past .ai Agent-ID mint projects (public on-chain facts,
// listed only as inputs the agent can check live — not endorsements).
const DEMO_CONTRACTS = [
  { label: "AGCC mint (agcc.fun)", contract: "0x6288DFe86f22B53eEB6886aE2D78941de7483743" },
  { label: "Pokechain (pokechain.trade)", contract: "0x4EF929aF00cB93993c3D01834C4DA79200d31e32" },
  { label: "MetaFishtank fish (metafishtank.com)", contract: "0xDAf554230466979b65c247E1A73F3e0C24595c6D" },
];

// 60-second in-memory cache so repeat checks don't hammer public RPCs.
const cache = new Map();
function cacheKey(body) {
  return JSON.stringify([body.contract.toLowerCase(), body.expectedPrice || "", body.xHandle || ""]);
}

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => { buf += c; if (buf.length > 65536) req.destroy(); });
    req.on("end", () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

async function handleVerify(input) {
  const contract = String(input.contract || "").trim();
  const expectedPrice = input.expectedPrice !== undefined && input.expectedPrice !== null && input.expectedPrice !== ""
    ? String(input.expectedPrice).trim() : null;
  const xHandle = input.xHandle ? String(input.xHandle).trim() : null;

  if (!isAddr(contract)) {
    return { status: 400, body: { error: "contract must be a 0x + 40-hex BSC address", received: contract } };
  }
  if (expectedPrice !== null && !/^\d+(\.\d+)?$/.test(expectedPrice)) {
    return { status: 400, body: { error: "expectedPrice must be a decimal BNB amount, e.g. \"0\" or \"0.003\"", received: expectedPrice } };
  }
  if (xHandle !== null && !/^@?[A-Za-z0-9_]{1,15}$/.test(xHandle)) {
    return { status: 400, body: { error: "xHandle must be a valid X handle (1-15 chars, letters/digits/_), e.g. \"PokechainTrade\"", received: xHandle } };
  }

  const key = cacheKey({ contract, expectedPrice, xHandle });
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60000) {
    return { status: 200, body: { ...hit.body, cached: true } };
  }

  const started = Date.now();
  const result = await verifyMint({ contract, expectedPrice, xHandle });
  const s = score(result.checks);
  const body = {
    agent: AGENT,
    version: VERSION,
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
  };
  cache.set(key, { at: Date.now(), body });
  return { status: 200, body };
}

const DEMO_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MintGuard — mint-safety verification agent for .ai Agent IDs</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.5}input,button{font-size:1em;padding:.5em}input{width:100%;box-sizing:border-box;margin:.25em 0}pre{background:#111;color:#eee;padding:1em;overflow:auto;border-radius:8px}.go{color:#0a7d2c}.caution{color:#9a6a00}.block{color:#b00020}</style>
</head><body>
<h1>MintGuard</h1>
<p>A mint-safety verification agent for <b>.ai Agent IDs</b> on BSC. Give it a mint contract and it checks, live: is the contract real and source-verified, is the mint open or paused, what is the exact mint price, is supply capped, is the owner renounced — and whether the project's X account exists and its history can be verified. It answers <b>GO / CAUTION / BLOCK</b> with evidence for every check.</p>
<h2>Try it</h2>
<form id="f">
<label>BSC contract address<br><input name="contract" value="0x6288DFe86f22B53eEB6886aE2D78941de7483743" required></label><br>
<label>Expected price in BNB (optional — mismatch = BLOCK)<br><input name="expectedPrice" placeholder="0 for a free mint"></label><br>
<label>Project X handle (optional, without @)<br><input name="xHandle" placeholder="e.g. PokechainTrade"></label><br>
<button type="submit">Verify mint</button>
</form>
<p>Demo contracts: ${DEMO_CONTRACTS.map((d) => `<a href="#" data-c="${d.contract}">${d.label}</a>`).join(" · ")}</p>
<div id="out"></div>
<script>
const f=document.getElementById('f'), out=document.getElementById('out');
document.querySelectorAll('[data-c]').forEach(a=>a.onclick=e=>{e.preventDefault();f.contract.value=a.dataset.c;});
f.onsubmit=async e=>{e.preventDefault();out.innerHTML='<p>Checking live on-chain…</p>';
const body={contract:f.contract.value}; if(f.expectedPrice.value)body.expectedPrice=f.expectedPrice.value; if(f.xHandle.value)body.xHandle=f.xHandle.value;
const r=await fetch('/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const j=await r.json();
const cls=j.verdict==='GO'?'go':j.verdict==='CAUTION'?'caution':'block';
out.innerHTML='<h2 class="'+cls+'">Verdict: '+j.verdict+' — '+j.score+'/100</h2><p>'+(j.reason||'')+'</p><pre>'+JSON.stringify(j,null,2)+'</pre>';};
</script>
<h2>API</h2>
<pre>POST /verify
{ "contract": "0x...", "expectedPrice": "0", "xHandle": "PokechainTrade" }

GET /verify?contract=0x...&amp;expectedPrice=0&amp;xHandle=PokechainTrade
GET /health</pre>
<p>Built for the zkVerify Agent Games — Wildcard track. Read-only: it never signs, never spends, never touches a wallet. Evidence is reproducible from the pinned block in every response.</p>
</body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const started = Date.now();
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(DEMO_HTML);
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      let block = null;
      try { block = await require("./lib/rpc").getBlockNumber(); } catch { /* rpc down */ }
      sendJson(res, 200, { ok: true, agent: AGENT, version: VERSION, time: new Date().toISOString(), block });
      return;
    }
    if (url.pathname === "/verify") {
      let input;
      if (req.method === "POST") {
        input = await readBody(req);
      } else if (req.method === "GET") {
        input = {
          contract: url.searchParams.get("contract"),
          expectedPrice: url.searchParams.get("expectedPrice"),
          xHandle: url.searchParams.get("xHandle"),
        };
      } else {
        sendJson(res, 405, { error: "method not allowed" });
        return;
      }
      const out = await handleVerify(input);
      sendJson(res, out.status, out.body);
      console.log(`[${new Date().toISOString()}] ${req.method} /verify ${input.contract || "?"} -> ${out.body.verdict || out.body.error} (${Date.now() - started}ms)`);
      return;
    }
    sendJson(res, 404, { error: "not found", routes: ["GET /", "GET /health", "POST /verify", "GET /verify?contract=0x..."] });
  } catch (e) {
    console.error(`[${new Date().toISOString()}] error ${req.method} ${url.pathname}:`, e.message);
    sendJson(res, 500, { error: "internal error", detail: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`${AGENT} v${VERSION} listening on http://localhost:${PORT}`);
  console.log(`POST /verify { contract, expectedPrice?, xHandle? }  |  GET /health  |  GET /`);
});
