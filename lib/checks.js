// lib/checks.js — The evidence probes MintGuard runs for one mint project.
//
// Every check is a LIVE read against public, keyless sources (BSC public RPC,
// Sourcify v2, the project's X profile page). Nothing is hardcoded, nothing is
// invented: a check that cannot be performed is reported as `unknown`, never as
// clean. Each check returns { id, label, status, detail, evidence } where
// status is one of: pass | warn | fail | unknown.
//
// Input: { contract, expectedPrice (BNB as string, optional), xHandle (optional) }
// Output: { contract, chainId: 56, block, checks: [...], meta: {...} }

const rpc = require("./rpc");

// Function selectors (keccak256(signature)[0:4]) — from the bsc-contract-audit skill.
const SEL = {
  owner: "8da5cb5b",
  paused: "5c975abb",
  totalSupply: "18160ddd",
  maxSupply: "d5abeb01",
  totalMinted: "a2309ff8",
  mintPrice: "6817c76c",
  MINT_PRICE: "c002d23d",
  cost: "13faede6",
  PRICE: "8d859f3e",
  ownerOf: "6352211e",
  tokenURI: "c87b56dd",
  royaltyInfo: "2a55205a",
  saleIsActive: "eb8d2444",
  publicSaleActive: "bc8893b4",
  baseURI: "6c0360eb",
  name: "06fdde03",
  symbol: "95d89b41",
  revealed: "51830227",
  isRevealed: "54214f69",
  mint1: "a0712d68", // mint(uint256)
};

const ZERO = "0x0000000000000000000000000000000000000000";
const ONE_ETHER_WEI = 10n ** 18n;

// Sourcify v2 — free, no key. https://sourcify.dev/server/v2/contract/{chainId}/{address}
async function checkSourceVerified(addressLc) {
  const url = `https://sourcify.dev/server/v2/contract/56/${addressLc}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (res.status === 404) {
      return { id: "source_verified", label: "Source verified (Sourcify)", status: "warn",
        detail: "Contract source is NOT verified on Sourcify — the code behind the mint cannot be read.",
        evidence: `${url} -> HTTP 404` };
    }
    if (!res.ok) {
      return { id: "source_verified", label: "Source verified (Sourcify)", status: "unknown",
        detail: `Sourcify lookup failed (HTTP ${res.status}); verification status could not be established.`,
        evidence: `${url} -> HTTP ${res.status}` };
    }
    const j = await res.json();
    const creation = j.creationMatch || null;
    const runtime = j.runtimeMatch || null;
    // Sourcify v2 match values seen live: "perfect", "match", "partial", null.
    // "match" is a verified match (the v2 API's term for an exact match).
    const best = runtime === "perfect" || creation === "perfect" ? "perfect"
      : runtime === "match" || creation === "match" ? "match"
      : runtime === "partial" || creation === "partial" ? "partial" : null;
    if (best === "perfect" || best === "match") {
      return { id: "source_verified", label: "Source verified (Sourcify)", status: "pass",
        detail: `Source verified (creation: ${creation}, runtime: ${runtime}) — the mint code can be read and re-checked.`,
        evidence: `${url} -> creationMatch=${creation} runtimeMatch=${runtime}` };
    }
    if (best === "partial") {
      return { id: "source_verified", label: "Source verified (Sourcify)", status: "warn",
        detail: `Source is only a partial match (creation: ${creation}, runtime: ${runtime}) — metadata differs, so constants in the code may not match the deployed bytecode.`,
        evidence: `${url} -> creationMatch=${creation} runtimeMatch=${runtime}` };
    }
    return { id: "source_verified", label: "Source verified (Sourcify)", status: "warn",
      detail: "Sourcify answered but reported no match — the source cannot be confirmed.",
      evidence: `${url} -> creationMatch=${creation} runtimeMatch=${runtime}` };
  } catch (e) {
    return { id: "source_verified", label: "Source verified (Sourcify)", status: "unknown",
      detail: `Sourcify lookup errored (${e.message}); verification status could not be established.`,
      evidence: `${url} -> error: ${e.message}` };
  } finally {
    clearTimeout(t);
  }
}

// X profile check — best effort, honest about what it cannot prove.
// - "This account doesn't exist" in the page  -> account_not_found (fail)
// - page loads and looks like a profile        -> exists, history unverifiable (warn)
// - fetch blocked / error                      -> unverifiable (unknown)
// We never claim an account is "clean" from this check alone.
async function checkX(handle) {
  const clean = String(handle).replace(/^@/, "").trim();
  if (!clean || !/^[A-Za-z0-9_]{1,15}$/.test(clean)) {
    return { id: "x_recycle", label: "X account recycle check", status: "unknown",
      detail: `Handle "${handle}" is not a valid X handle format; no check was possible.`,
      evidence: `handle=${handle}` };
  }
  const url = `https://x.com/${clean}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    const text = await res.text();
    const lower = text.toLowerCase();
    // Primary signal: HTTP 404 means X itself says the account is gone.
    if (res.status === 404) {
      return { id: "x_recycle", label: "X account recycle check", status: "fail",
        detail: `X account @${clean} does not exist (X returns HTTP 404) — the project links to a dead, renamed, or never-created handle.`,
        evidence: `${url} -> HTTP 404` };
    }
    if (lower.includes("this account doesn") || lower.includes("account doesn’t exist") || lower.includes("doesn't exist")) {
      return { id: "x_recycle", label: "X account recycle check", status: "fail",
        detail: `X account @${clean} does not exist — the project links to a dead or never-created handle.`,
        evidence: `${url} -> HTTP ${res.status}, page says the account does not exist` };
    }
    if (lower.includes("suspended") && lower.includes("account suspended")) {
      return { id: "x_recycle", label: "X account recycle check", status: "fail",
        detail: `X account @${clean} is suspended.`,
        evidence: `${url} -> page says the account is suspended` };
    }
    // A profile page loads. X does not expose account age / name history on the
    // public page, so a rebrand/recycle verdict cannot be proven from here.
    return { id: "x_recycle", label: "X account recycle check", status: "warn",
      detail: `X account @${clean} exists, but its history (previous names, rebrands, old projects) could not be verified from the public page — treat as UNVERIFIED, not clean.`,
      evidence: `${url} -> HTTP ${res.status}, profile page loads` };
  } catch (e) {
    return { id: "x_recycle", label: "X account recycle check", status: "unknown",
      detail: `X profile for @${clean} could not be fetched (${e.message}) — history is UNVERIFIED, not clean.`,
      evidence: `${url} -> fetch error: ${e.message}` };
  } finally {
    clearTimeout(t);
  }
}

// Run all on-chain probes in one batch against a pinned block.
async function runOnChain(address, block) {
  const blockTag = "0x" + block.toString(16);
  const noArg = (sel) => ({ to: address, data: "0x" + sel });
  const calls = [
    { key: "owner", ...noArg(SEL.owner) },
    { key: "paused", ...noArg(SEL.paused) },
    { key: "totalSupply", ...noArg(SEL.totalSupply) },
    { key: "maxSupply", ...noArg(SEL.maxSupply) },
    { key: "totalMinted", ...noArg(SEL.totalMinted) },
    { key: "mintPrice", ...noArg(SEL.mintPrice) },
    { key: "MINT_PRICE", ...noArg(SEL.MINT_PRICE) },
    { key: "cost", ...noArg(SEL.cost) },
    { key: "PRICE", ...noArg(SEL.PRICE) },
    { key: "saleIsActive", ...noArg(SEL.saleIsActive) },
    { key: "publicSaleActive", ...noArg(SEL.publicSaleActive) },
    { key: "name", ...noArg(SEL.name) },
    { key: "symbol", ...noArg(SEL.symbol) },
    { key: "revealed", ...noArg(SEL.revealed) },
    { key: "isRevealed", ...noArg(SEL.isRevealed) },
    { key: "baseURI", ...noArg(SEL.baseURI) },
    { key: "ownerOf1", to: address, data: "0x" + SEL.ownerOf + rpc.encUint256(1) },
    { key: "tokenURI1", to: address, data: "0x" + SEL.tokenURI + rpc.encUint256(1) },
    { key: "royaltyInfo", to: address, data: "0x" + SEL.royaltyInfo + rpc.encUint256(1) + rpc.encUint256(ONE_ETHER_WEI) },
    // Mint-entry probe: static call mint(1) with 0 value. A payment revert proves the
    // entry exists; a "sale not active" revert proves the gate; a selector-miss
    // revert (or empty return) means no public mint(uint256) entry.
    { key: "mintEntry", to: address, data: "0x" + SEL.mint1 + rpc.encUint256(1), value: "0x0" },
  ];
  calls._blockTag = blockTag;
  const results = await rpc.rpcBatch(calls);
  const out = {};
  calls.forEach((c, i) => { out[c.key] = results[i]; });
  return out;
}

function weiToBnb(wei) {
  // Render a wei BigInt as a BNB decimal string (up to 6 decimals, trimmed).
  const whole = wei / ONE_ETHER_WEI;
  const frac = wei % ONE_ETHER_WEI;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

// Main entry: run every probe for one mint project and return the checks.
async function verifyMint({ contract, expectedPrice, xHandle }) {
  const address = contract;
  const addressLc = address.toLowerCase();
  const block = await rpc.getBlockNumber();
  const checks = [];
  const meta = { block, chainId: 56, rpcBlock: block };

  // 1. Contract exists at all.
  let code;
  try {
    code = await rpc.getCode(address, "0x" + block.toString(16));
  } catch (e) {
    code = null;
    checks.push({ id: "contract_exists", label: "Contract exists on BSC", status: "unknown",
      detail: `eth_getCode failed (${e.message}); existence could not be established.`,
      evidence: `eth_getCode(${address}) @ block ${block} -> error` });
  }
  if (code !== null) {
    if (code === "0x" || code === "0x0") {
      checks.push({ id: "contract_exists", label: "Contract exists on BSC", status: "fail",
        detail: "No code at this address — it is an EOA or an undeployed address, not a mint contract.",
        evidence: `eth_getCode(${address}) @ block ${block} -> 0x` });
      return { contract: address, chainId: 56, block, checks, meta };
    }
    checks.push({ id: "contract_exists", label: "Contract exists on BSC", status: "pass",
      detail: `Contract code present (${code.length / 2 - 1} bytes) at block ${block}.`,
      evidence: `eth_getCode(${address}) @ block ${block} -> ${(code.length / 2 - 1).toLocaleString()} bytes` });
  }

  // 2. Proxy resolution (EIP-1967 implementation slot).
  let impl = null;
  try {
    const slot = await rpc.rpc("eth_getStorageAt", [address, rpc.EIP1967_IMPL_SLOT, "0x" + block.toString(16)]);
    if (slot && slot !== "0x" + "0".repeat(64)) {
      impl = "0x" + slot.slice(-40);
      if (impl.toLowerCase() !== addressLc) {
        checks.push({ id: "proxy", label: "Proxy / implementation", status: "warn",
          detail: `This is a proxy pointing at implementation ${impl}. The implementation is what actually runs the mint — audit it, and note the proxy admin can swap it.`,
          evidence: `eth_getStorageAt(EIP1967 slot) @ block ${block} -> ${impl}` });
      }
    }
  } catch (e) {
    checks.push({ id: "proxy", label: "Proxy / implementation", status: "unknown",
      detail: `Proxy slot read failed (${e.message}); proxy status unknown.`,
      evidence: `eth_getStorageAt(EIP1967 slot) -> error` });
  }
  meta.implementation = impl;

  // 3. Source verification (Sourcify) + 4. on-chain reads (batched).
  const [srcCheck, onchain] = await Promise.all([
    checkSourceVerified(addressLc),
    runOnChain(address, block).catch((e) => ({ __error: e.message })),
  ]);
  checks.push(srcCheck);
  if (onchain.__error) {
    checks.push({ id: "onchain_reads", label: "On-chain reads", status: "unknown",
      detail: `Batched eth_call reads failed (${onchain.__error}); on-chain state could not be established.`,
      evidence: `eth_call batch @ block ${block} -> error` });
    return { contract: address, chainId: 56, block, checks, meta };
  }

  // Owner.
  const o = onchain.owner;
  if (o.ok) {
    const owner = rpc.decAddress(o.result);
    if (owner === ZERO) {
      checks.push({ id: "owner", label: "Ownership renounced", status: "pass",
        detail: "owner() returns the zero address — every onlyOwner function is inert.",
        evidence: `owner() @ block ${block} -> 0x0000…0000` });
    } else if (owner) {
      checks.push({ id: "owner", label: "Ownership renounced", status: "warn",
        detail: `owner() is live at ${owner} — an owner can still call privileged functions (pause, withdraw, change sale state) unless the source proves otherwise.`,
        evidence: `owner() @ block ${block} -> ${owner}` });
    } else {
      checks.push({ id: "owner", label: "Ownership renounced", status: "unknown",
        detail: "owner() returned data that could not be decoded.",
        evidence: `owner() @ block ${block} -> ${String(o.result).slice(0, 66)}` });
    }
  } else {
    checks.push({ id: "owner", label: "Ownership renounced", status: "unknown",
      detail: "owner() does not exist or reverted — ownership state cannot be established from this call.",
      evidence: `owner() @ block ${block} -> reverted` });
  }

  // Paused.
  const p = onchain.paused;
  if (p.ok) {
    const paused = rpc.decBool(p.result);
    if (paused === true) {
      checks.push({ id: "paused", label: "Mint paused?", status: "fail",
        detail: "paused() is true — the contract is paused and the mint cannot proceed.",
        evidence: `paused() @ block ${block} -> true` });
    } else if (paused === false) {
      checks.push({ id: "paused", label: "Mint paused?", status: "pass",
        detail: "paused() is false — the contract is not paused.",
        evidence: `paused() @ block ${block} -> false` });
    } else {
      checks.push({ id: "paused", label: "Mint paused?", status: "unknown",
        detail: "paused() returned undecodable data.",
        evidence: `paused() @ block ${block} -> ${String(p.result).slice(0, 66)}` });
    }
  } else {
    checks.push({ id: "paused", label: "Mint paused?", status: "unknown",
      detail: "No paused() function — pause state cannot be established from this call.",
      evidence: `paused() @ block ${block} -> reverted / absent` });
  }

  // Classification: NFT vs token (ownerOf(1) / tokenURI(1)).
  const isNft = (onchain.ownerOf1 && onchain.ownerOf1.ok) || (onchain.tokenURI1 && onchain.tokenURI1.ok);
  const ts = onchain.totalSupply.ok ? rpc.decUint256(onchain.totalSupply.result) : null;
  const ms = onchain.maxSupply.ok ? rpc.decUint256(onchain.maxSupply.result) : null;
  const tm = onchain.totalMinted.ok ? rpc.decUint256(onchain.totalMinted.result) : null;
  const minted = tm !== null ? tm : ts;
  checks.push({ id: "type", label: "Asset type", status: "pass",
    detail: isNft
      ? `Behaves as an NFT collection (ownerOf(1)/tokenURI(1) answered). Minted so far: ${minted !== null ? minted.toString() : "unknown"}${ms !== null && ms !== 0n ? ` / maxSupply ${ms.toString()}` : " / maxSupply uncapped or absent"}.`
      : `Does not answer ownerOf(1)/tokenURI(1) — likely a token or a custom mint contract, not a standard NFT collection. totalSupply: ${ts !== null ? ts.toString() : "unknown"}.`,
    evidence: `ownerOf(1) ${onchain.ownerOf1.ok ? "ok" : "revert"}; tokenURI(1) ${onchain.tokenURI1.ok ? "ok" : "revert"}; totalSupply=${ts !== null ? ts.toString() : "?"} maxSupply=${ms !== null ? ms.toString() : "?"}` });

  // Supply cap.
  if (ms !== null && ms === 0n) {
    checks.push({ id: "supply_cap", label: "Supply capped", status: "warn",
      detail: "maxSupply() is 0 — supply is uncapped (or the function is a stub). The team can mint without a bound.",
      evidence: `maxSupply() @ block ${block} -> 0` });
  } else if (ms !== null && ms > 0n) {
    checks.push({ id: "supply_cap", label: "Supply capped", status: "pass",
      detail: `maxSupply() is ${ms.toString()} — supply is bounded.${minted !== null ? ` Minted: ${minted.toString()} (${((minted * 10000n) / ms).toString().slice(0, 4) / 100}% of cap).` : ""}`,
      evidence: `maxSupply() @ block ${block} -> ${ms.toString()}` });
  } else {
    checks.push({ id: "supply_cap", label: "Supply capped", status: "unknown",
      detail: "maxSupply() does not exist or reverted — no supply bound could be established.",
      evidence: `maxSupply() @ block ${block} -> reverted / absent` });
  }

  // Mint price — try the common getters in order.
  const priceFns = [["mintPrice", onchain.mintPrice], ["MINT_PRICE", onchain.MINT_PRICE], ["cost", onchain.cost], ["PRICE", onchain.PRICE]];
  let priceWei = null;
  let priceFn = null;
  for (const [name, r] of priceFns) {
    if (r && r.ok) {
      const v = rpc.decUint256(r.result);
      if (v !== null) { priceWei = v; priceFn = name; break; }
    }
  }
  if (priceWei !== null) {
    const bnb = weiToBnb(priceWei);
    const free = priceWei === 0n;
    let status = "pass";
    let detail = `${priceFn}() is ${priceWei.toString()} wei = ${bnb} BNB (${free ? "FREE mint, gas only" : "paid mint"}).`;
    if (expectedPrice !== undefined && expectedPrice !== null && expectedPrice !== "") {
      const exp = BigInt(Math.round(parseFloat(expectedPrice) * 1e18));
      if (exp !== priceWei) {
        status = "fail";
        detail += ` MISMATCH: the listed/expected price was ${expectedPrice} BNB but the contract charges ${bnb} BNB — do not mint at the listed price.`;
      } else {
        detail += ` Matches the expected price of ${expectedPrice} BNB.`;
      }
    }
    checks.push({ id: "mint_price", label: "Mint price", status,
      detail, evidence: `${priceFn}() @ block ${block} -> ${priceWei.toString()} wei` });
    meta.priceWei = priceWei.toString();
    meta.priceBnb = bnb;
    meta.priceFn = priceFn;
  } else {
    checks.push({ id: "mint_price", label: "Mint price", status: "warn",
      detail: "No mintPrice()/MINT_PRICE()/cost()/PRICE() getter answered — the mint price cannot be confirmed from the contract. Free vs paid is unknown.",
      evidence: `mintPrice/MINT_PRICE/cost/PRICE @ block ${block} -> all reverted / absent` });
  }

  // Sale state.
  const sale = onchain.saleIsActive.ok ? rpc.decBool(onchain.saleIsActive.result)
    : onchain.publicSaleActive.ok ? rpc.decBool(onchain.publicSaleActive.result) : null;
  const saleFn = onchain.saleIsActive.ok ? "saleIsActive" : onchain.publicSaleActive.ok ? "publicSaleActive" : null;
  if (sale === true) {
    checks.push({ id: "sale_state", label: "Sale open?", status: "pass",
      detail: `${saleFn}() is true — the public sale is open.`,
      evidence: `${saleFn}() @ block ${block} -> true` });
  } else if (sale === false) {
    checks.push({ id: "sale_state", label: "Sale open?", status: "fail",
      detail: `${saleFn}() is false — the sale is closed / not active. The mint cannot be entered right now.`,
      evidence: `${saleFn}() @ block ${block} -> false` });
  } else {
    checks.push({ id: "sale_state", label: "Sale open?", status: "unknown",
      detail: "No saleIsActive()/publicSaleActive() function — sale state cannot be established from the contract.",
      evidence: `saleIsActive/publicSaleActive @ block ${block} -> reverted / absent` });
  }

  // Mint-entry probe (static call mint(1), value 0).
  const me = onchain.mintEntry;
  if (me.ok) {
    checks.push({ id: "mint_entry", label: "Mint entry reachable", status: "pass",
      detail: "A static call to mint(1) with 0 value SUCCEEDED — the mint entry is live and reachable (a free, open mint would execute here).",
      evidence: `eth_call mint(1) value=0 @ block ${block} -> success` });
  } else {
    const reason = rpc.decRevertReason(me.data);
    const msg = (me.error || "") + (reason ? ` (${reason})` : "");
    if (/not active|not started|not open|sale.*closed|paused/i.test(msg)) {
      checks.push({ id: "mint_entry", label: "Mint entry reachable", status: "fail",
        detail: `mint(1) reverts with a sale-gate reason: "${reason || me.error}" — the mint is not open.`,
        evidence: `eth_call mint(1) value=0 @ block ${block} -> revert: ${reason || me.error}` });
    } else if (/insufficient|payment|price|value|fund|allowance|balance/i.test(msg)) {
      checks.push({ id: "mint_entry", label: "Mint entry reachable", status: "pass",
        detail: `mint(1) reverts only on payment ("${reason || me.error}") — the entry exists and is reachable; a real mint would need the mint fee attached.`,
        evidence: `eth_call mint(1) value=0 @ block ${block} -> revert: ${reason || me.error}` });
    } else if (/revert/i.test(msg) && !reason) {
      checks.push({ id: "mint_entry", label: "Mint entry reachable", status: "unknown",
        detail: `mint(1) reverted without a readable reason (${me.error || "unknown"}) — the entry may exist but is gated, or may not exist.`,
        evidence: `eth_call mint(1) value=0 @ block ${block} -> revert, no reason decoded` });
    } else {
      checks.push({ id: "mint_entry", label: "Mint entry reachable", status: "unknown",
        detail: `mint(1) call failed (${me.error || "unknown error"}) — mint entry state could not be established.`,
        evidence: `eth_call mint(1) value=0 @ block ${block} -> ${me.error || "error"}` });
    }
  }

  // Royalty (EIP-2981) — only meaningful if the call answers.
  const ri = onchain.royaltyInfo;
  if (ri.ok) {
    try {
      const body = ri.result.slice(2);
      const amount = BigInt("0x" + body.slice(64, 128));
      const pct = Number((amount * 10000n) / ONE_ETHER_WEI) / 100;
      if (pct > 10) {
        checks.push({ id: "royalty", label: "Resale royalty (EIP-2981)", status: "warn",
          detail: `royaltyInfo(1, 1 BNB) is ${pct}% — above 10%, which eats resale margin.`,
          evidence: `royaltyInfo(1, 1e18) @ block ${block} -> ${amount.toString()} wei (${pct}%)` });
      } else {
        checks.push({ id: "royalty", label: "Resale royalty (EIP-2981)", status: "pass",
          detail: `royaltyInfo(1, 1 BNB) is ${pct}% — resale royalty is within the normal range.`,
          evidence: `royaltyInfo(1, 1e18) @ block ${block} -> ${amount.toString()} wei (${pct}%)` });
      }
    } catch {
      checks.push({ id: "royalty", label: "Resale royalty (EIP-2981)", status: "unknown",
        detail: "royaltyInfo() answered but the return could not be decoded.",
        evidence: `royaltyInfo(1, 1e18) @ block ${block} -> ${String(ri.result).slice(0, 66)}` });
    }
  }
  // (If royaltyInfo reverts, the collection simply has no EIP-2981 royalty — not a finding.)

  // Reveal state (informational).
  const rev = onchain.revealed.ok ? rpc.decBool(onchain.revealed.result)
    : onchain.isRevealed.ok ? rpc.decBool(onchain.isRevealed.result) : null;
  if (rev !== null) {
    checks.push({ id: "reveal", label: "Art revealed?", status: rev ? "pass" : "warn",
      detail: rev ? "revealed() is true — the art/metadata is revealed." : "revealed() is false — art is still hidden; unrevealed with no deadline is a risk.",
      evidence: `revealed()/isRevealed() @ block ${block} -> ${rev}` });
  }

  // Name / symbol (informational, proves the contract answers as a collection).
  const name = onchain.name.ok ? rpc.decString(onchain.name.result) : null;
  const symbol = onchain.symbol.ok ? rpc.decString(onchain.symbol.result) : null;
  if (name || symbol) {
    meta.name = name;
    meta.symbol = symbol;
    checks.push({ id: "identity", label: "Collection identity", status: "pass",
      detail: `name() = "${name || "?"}" · symbol() = "${symbol || "?"}" — the contract identifies itself as a collection.`,
      evidence: `name() -> "${name || ""}" ; symbol() -> "${symbol || ""}"` });
  }

  // X recycle check (only when a handle is supplied).
  if (xHandle) {
    checks.push(await checkX(xHandle));
  }

  return { contract: address, chainId: 56, block, checks, meta };
}

module.exports = { verifyMint, weiToBnb };
