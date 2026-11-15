// lib/rpc.js — Minimal BSC (chain 56) JSON-RPC client.
// Zero dependencies, uses global fetch. Tries public endpoints in order.
// All calls are read-only (eth_call / eth_getCode / eth_blockNumber / eth_getBalance).
// No API key is needed for any of these.

const RPC_URLS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-rpc.publicnode.com",
  "https://1rpc.io/bnb",
  "https://bsc-dataseed1.defibit.io",
];

const TIMEOUT_MS = 10000;

function isAddr(a) {
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
}

async function post(url, payload, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// One JSON-RPC call, trying each public endpoint until one answers.
// Returns the `result` field. Throws the last error if all endpoints fail.
async function rpc(method, params = []) {
  let lastErr = null;
  for (const url of RPC_URLS) {
    try {
      const body = await post(url, { jsonrpc: "2.0", id: 1, method, params });
      if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
      return body.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`all BSC RPCs failed for ${method}: ${lastErr ? lastErr.message : "?"}`);
}

// Batch several eth_call payloads in a single JSON-RPC batch request.
// Returns an array aligned with `calls`: [{ ok, result } | { ok:false, error }].
// A reverted eth_call returns ok:false with the revert data (if any) — the caller
// decides what a revert means (e.g. "function does not exist" vs "sale not active").
async function rpcBatch(calls) {
  // calls: [{ to, data, value? }] — all against the same block tag.
  const blockTag = calls._blockTag || "latest";
  const payload = calls.map((c, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: "eth_call",
    params: [{ to: c.to, data: c.data, value: c.value || "0x0" }, blockTag],
  }));
  let lastErr = null;
  for (const url of RPC_URLS) {
    try {
      const body = await post(url, payload);
      const arr = Array.isArray(body) ? body : [body];
      return arr.map((r) => {
        if (r.error) return { ok: false, error: r.error.message || "", data: r.error.data || null, code: r.error.code };
        return { ok: true, result: r.result };
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`all BSC RPCs failed for batch eth_call: ${lastErr ? lastErr.message : "?"}`);
}

async function getBlockNumber() {
  const hex = await rpc("eth_blockNumber", []);
  return parseInt(hex, 16);
}

async function getCode(address, blockTag = "latest") {
  return await rpc("eth_getCode", [address, blockTag]);
}

async function getBalance(address, blockTag = "latest") {
  const hex = await rpc("eth_getBalance", [address, blockTag]);
  return BigInt(hex);
}

// --- ABI helpers (hand-rolled, no ethers dependency) ---

// 32-byte big-endian encoding of a uint256 (number, bigint, or hex string).
function encUint256(v) {
  const b = BigInt(v);
  return b.toString(16).padStart(64, "0");
}

// 32-byte encoding of an address (12 zero bytes + 20 address bytes).
function encAddress(a) {
  return "000000000000000000000000" + a.toLowerCase().replace(/^0x/, "");
}

// 32-byte encoding of a bytes4 value, left-aligned.
function encBytes4(hex4) {
  return hex4.replace(/^0x/, "").padEnd(64, "0");
}

function decUint256(hex) {
  if (!hex || hex === "0x") return null;
  try { return BigInt(hex); } catch { return null; }
}

function decAddress(hex) {
  if (!hex || hex === "0x" || hex.length < 42) return null;
  return "0x" + hex.slice(-40);
}

function decBool(hex) {
  if (!hex || hex === "0x") return null;
  return BigInt(hex) !== 0n;
}

// Decode an ABI-encoded string return (offset 0x20, length, utf8 bytes).
function decString(hex) {
  if (!hex || hex === "0x" || hex.length < 130) return null;
  try {
    const body = hex.slice(2);
    const len = parseInt(body.slice(64, 128), 16);
    const data = body.slice(128, 128 + len * 2);
    return Buffer.from(data, "hex").toString("utf8");
  } catch { return null; }
}

// Decode an Error(string) revert reason from eth_call error data.
// Returns the reason string, or null if the data is not an Error(string).
function decRevertReason(data) {
  if (!data || typeof data !== "string") return null;
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  // Error(string) selector = 0x08c379a0
  if (!hex.startsWith("08c379a0")) return null;
  try {
    const body = hex.slice(8);
    const len = parseInt(body.slice(64, 128), 16);
    const str = body.slice(128, 128 + len * 2);
    return Buffer.from(str, "hex").toString("utf8");
  } catch { return null; }
}

// EIP-1967 implementation slot.
const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

module.exports = {
  RPC_URLS,
  isAddr,
  rpc,
  rpcBatch,
  getBlockNumber,
  getCode,
  getBalance,
  encUint256,
  encAddress,
  encBytes4,
  decUint256,
  decAddress,
  decBool,
  decString,
  decRevertReason,
  EIP1967_IMPL_SLOT,
};
