# MintGuard — a mint-safety verification agent for .ai Agent IDs

**zkVerify Agent Games — Wildcard track entry.**
Live demo (runs entirely in your browser): **https://ncyrmd.github.io/mintguard-agent/**
Node server (same logic, plus the X check that browsers cannot do): run `node server.js` — see below.

## The problem

Agent-ID mints (.ai Agent IDs on BSC) move fast and the checks that matter are
easy to skip: is the contract real, is the source verified, is the mint actually
open or paused, what is the *exact* mint price, is supply capped, is the owner
renounced — and is the project's X account even real, or was it recycled from
an older project? A wrong answer costs the mint fee, or worse, a wallet drained
by a contract that was never what the listing claimed.

## Who it helps

Anyone minting with a Binance Agentic Wallet / .ai Agent ID — the agent does in
~2 seconds the verification a human does by hand across BscScan, Sourcify, the
contract, and X, and it answers in one word: **GO / CAUTION / BLOCK**, with the
evidence for every check attached.

## What it does

Give it a mint project — a BSC contract address, an optional expected price in
BNB, and an optional X handle — and it runs 10+ live probes against public,
keyless sources (BSC public RPC, Sourcify v2, the project's X profile page)
and scores them into a verdict:

| Verdict | Meaning |
|---|---|
| **GO** (≥ 85/100) | All checks clear. May proceed. |
| **CAUTION** (55–84) | Proceed only after acknowledging the listed risks. |
| **BLOCK** (&lt; 55, or any hard block) | Do not mint. |

**Hard blocks** (verdict BLOCK no matter the score): no code at the address,
contract paused, listed price ≠ contract price, sale closed, mint gated, or
the linked X account does not exist / is suspended.

**The checks** (each returns `pass` / `warn` / `fail` / `unknown` + evidence):

1. `contract_exists` — `eth_getCode` is not `0x`.
2. `proxy` — EIP-1967 implementation slot; a proxy means the implementation (and its admin) is what actually runs the mint.
3. `source_verified` — Sourcify v2 match (`perfect`/`match` = pass, `partial` = warn, none = warn).
4. `owner` — `owner()` is the zero address (renounced) or a live owner (warn).
5. `paused` — `paused()` true = hard block.
6. `type` — NFT vs token, via `ownerOf(1)` / `tokenURI(1)`.
7. `supply_cap` — `maxSupply()` bounded, zero (uncapped), or absent.
8. `mint_price` — `mintPrice()` / `MINT_PRICE()` / `cost()` / `PRICE()`, rendered in BNB; compared against the expected price when given (mismatch = hard block).
9. `sale_state` — `saleIsActive()` / `publicSaleActive()`.
10. `mint_entry` — static `eth_call mint(1)` with 0 value: success means the entry is live; a payment-only revert means it exists and is reachable; a sale-gate revert means the mint is closed.
11. `royalty` — EIP-2981 `royaltyInfo(1, 1 BNB)`; above 10% is a warn.
12. `reveal` — `revealed()` / `isRevealed()`.
13. `identity` — `name()` / `symbol()`.
14. `x_recycle` — the project's X account: does not exist (HTTP 404 / "doesn't exist" = hard block), exists but history unverifiable (warn — **never claimed clean**), or unreachable (unknown).

**A check that cannot be performed is reported as `unknown`, never as clean.**
Every verdict pins the BSC block it was computed at, and every check carries
its evidence (the exact RPC call / URL), so anyone can re-run the probes at
that block and reproduce the verdict.

## Live demo results (real contracts, checked live)

| Contract | Verdict | Score | Why |
|---|---|---|---|
| AGCC mint `0x6288DFe…3743` | CAUTION | 75 | Source verified; no `maxSupply`/`mintPrice`/`saleIsActive` getters on this custom mint contract, so price and sale state are unknown. |
| Pokechain `0x4EF929a…e32` | **BLOCK** | 45 | X account `@PokechainTrade` returns HTTP 404 — the linked handle no longer exists (it was live on 9 Nov). Owner still live, source unverified. |
| MetaFishtank fish `0xDAf5542…c6D` | CAUTION | 55 | Source unverified; no price getter; royalty 10%. |
| Zero address `0x000…000` | **BLOCK** | — | No code at the address (hard block). |

These are live observations at the time of writing, not endorsements — re-run
the agent to get the current state.

## How it works

```
POST /verify  { contract, expectedPrice?, xHandle? }
  -> verifyMint()      lib/checks.js   (live probes, batched eth_call, Sourcify, X)
  -> score()           lib/verdict.js  (100-point rubric + hard blocks)
  -> { verdict, score, reason, block, checks[], meta, reproducibility }
```

- **Zero dependencies** (Node ≥ 18). All RPC is raw JSON-RPC over `fetch`;
  all ABI encoding/decoding is hand-rolled in `lib/rpc.js`.
- **Read-only.** The agent never signs, never spends, never touches a wallet.
  It only reads public chain state and public pages.
- **60-second cache** per (contract, price, handle) so repeat checks don't
  hammer public RPCs.
- The browser demo (`docs/index.html`) is the same logic ported to run
  client-side (BSC RPC and Sourcify both allow cross-origin reads). One
  difference: browsers cannot read X (X blocks cross-origin requests), so the
  X check reports `unknown` there — the Node server checks it directly.

## Run it

```bash
node server.js            # PORT env, default 8787
# GET  /            demo page
# GET  /health      { ok, block }
# POST /verify      { contract, expectedPrice?, xHandle? }
# GET  /verify?contract=0x...&expectedPrice=0&xHandle=...
```

```bash
node test-live.js          # smoke test against the demo contracts
./demo.sh [BASE_URL]       # curl examples against a running server
```

Deploy on Vercel (serverless, same code): `api/verify.js` + `api/index.js`
with `vercel.json` rewrites (`/verify` → `/api/verify`).

## Key decisions

- **Live evidence over claimed data.** The agent never trusts a listing's
  price, supply, or "verified" badge — it reads the contract and the
  verification service itself. A price mismatch is a hard block, because that
  is exactly how a bait mint works.
- **Unknown ≠ clean.** Every probe that fails reports `unknown` and costs
  points. This is the standing rule the agent was built around: an X account
  whose history cannot be verified is reported as *unverifiable*, never as clean.
- **No API keys.** BSC public RPC + Sourcify v2 + the public X page are all
  keyless, so the agent runs anywhere with no secrets to manage.
- **Reproducibility as verifiability.** zkVerify is optional for Wildcard,
  and this agent does not attach a ZK proof — instead, every verdict is
  reproducible from the pinned block and the evidence log in the response.
  The checkable claim is: "these probes, at this block, produce this verdict."
  A Groth16 proof of the decision circuit (like the Proof Gatekeeper track's)
  is a natural next step, not a claim made here.

## What it can and cannot do

- **Can:** verify any BSC mint contract's on-chain state, price, sale state,
  supply cap, ownership, and source verification; flag a dead X handle; give
  a reproducible GO/CAUTION/BLOCK verdict.
- **Cannot:** prove an X account was never rebranded (X does not expose name
  history publicly) — it reports that as unverifiable; read private
  allowlists or off-chain mint pages; judge art, team, or tokenomics; guarantee
  a mint is safe (a passing score is evidence, not a promise).
- **Scope:** BSC mainnet (chain 56) only. Other chains are out of scope.

## Submission (Agent Games — Wildcard)

- Agent link: this repo — https://github.com/ncyrmd/mintguard-agent
- Public endpoint: the live demo above (browser build) + the Node server
  (`POST /verify`). A hosted serverless deployment (Vercel) is the durable
  endpoint; see `api/` and `vercel.json`.
- Use case: mint-safety verification for .ai Agent-ID holders (see above).
- Build context: built from the real verification workflow used for Agent-ID
  mints (Enigma, AGCC, Pokechain, MetaFishtank, …) — the probes are the ones
  in the `bsc-contract-audit` rubric, reduced to the mint gate.

Reference only, not investment advice.
