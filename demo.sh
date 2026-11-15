#!/bin/bash
# demo.sh — Live demo of MintGuard against its public endpoint.
# Usage: ./demo.sh [BASE_URL]   (default http://localhost:8787)
BASE="${1:-http://localhost:8787}"

echo "== health =="
curl -s "$BASE/health"; echo

echo
echo "== verify AGCC mint (real past .ai Agent-ID project) =="
curl -s -X POST "$BASE/verify" -H 'content-type: application/json' \
  -d '{"contract":"0x6288DFe86f22B53eEB6886aE2D78941de7483743"}' | head -c 1200; echo

echo
echo "== verify Pokechain, expected free mint, with X handle =="
curl -s -X POST "$BASE/verify" -H 'content-type: application/json' \
  -d '{"contract":"0x4EF929aF00cB93993c3D01834C4DA79200d31e32","expectedPrice":"0","xHandle":"PokechainTrade"}' | head -c 1200; echo

echo
echo "== verify zero address (must BLOCK: no code) =="
curl -s -X POST "$BASE/verify" -H 'content-type: application/json' \
  -d '{"contract":"0x0000000000000000000000000000000000000000"}' | head -c 600; echo

echo
echo "== GET form of verify =="
curl -s "$BASE/verify?contract=0xDAf554230466979b65c247E1A73F3e0C24595c6D&expectedPrice=0" | head -c 600; echo
