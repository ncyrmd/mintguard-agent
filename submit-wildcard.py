#!/usr/bin/env python3
"""File the MintGuard Wildcard submission (Agent Games) as account #1.

Flow:
  1. Load submission-payload.json (title, projectUrl, endpoint, whatItDoes,
     additionalLinks, proofReference, message).
  2. PRE-CHECKS (refuse to file a dead submission):
     - projectUrl (the GitHub repo) must return HTTP 200 — the repo MUST be
       public (parent pushes it via browser first). If not 200, REFUSE.
     - endpoint (the live demo) must return HTTP 200 — if not, file WITHOUT
       the endpoint line (the form allows it blank) and say so.
  3. Sign in as account #1 (SIWE, via register.py helpers).
  4. POST the submitWildcardSubmission server action
     (Next-Action: 4027bd1d0298ed896c9e7fb0536e610c240fabab14) to
     /dashboard/submissions?category=wildcard with the same wire format the
     browser client uses (raw JSON array body, text/plain).
  5. Print the result and save it to wildcard-submission-result.json.

SECURITY: the wallet key is read inside this process only (via register.py),
never printed or logged. Only addresses/handles/URLs/statuses are reported.

Usage: python3 submit-wildcard.py [--dry-run]
  --dry-run: run the pre-checks + build the action body, but do NOT post it.
"""
import sys, json, argparse
sys.path.insert(0, "/home/hatch/workspace/agent-games")
import register as R
import requests

WORKDIR = "/home/hatch/workspace/agent-games/wildcard"
SUBMIT_ACTION_ID = "4027bd1d0298ed896c9e7fb0536e610c240fabab14"

def head_ok(url):
    try:
        r = requests.get(url, timeout=20, headers={"User-Agent": R.UA}, allow_redirects=True)
        return r.status_code, r.status_code == 200
    except Exception as e:
        return f"error: {e}", False

def build_statement(p, include_endpoint):
    parts = []
    if include_endpoint and p.get("endpoint"):
        parts.append(f"Endpoint: {p['endpoint']}")
    parts.append(f"What it does:\n{p['whatItDoes']}")
    links = p.get("additionalLinks") or []
    if links:
        parts.append("Additional links:\n" + "\n".join(links))
    if p.get("message"):
        parts.append(f"Message:\n{p['message']}")
    return "\n\n".join(parts)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    p = json.load(open(f"{WORKDIR}/submission-payload.json"))
    print("payload title:", p["title"])
    print("projectUrl:", p["projectUrl"])
    print("endpoint:", p.get("endpoint"))

    # Pre-check 1: repo must be public.
    st, ok = head_ok(p["projectUrl"])
    print(f"pre-check projectUrl -> {st} (live={ok})")
    if not ok:
        print("REFUSED: the GitHub repo is not public yet (parent must push it first).")
        return 1
    # Pre-check 2: endpoint (demo) should be live; if not, file without it.
    include_endpoint = True
    if p.get("endpoint"):
        st2, ok2 = head_ok(p["endpoint"])
        print(f"pre-check endpoint -> {st2} (live={ok2})")
        if not ok2:
            print("NOTE: endpoint is not live (GitHub Pages not enabled yet?) — filing WITHOUT the endpoint line.")
            include_endpoint = False

    statement = build_statement(p, include_endpoint)
    action_args = [{
        "title": p["title"],
        "projectUrl": p["projectUrl"],
        "proofReference": p.get("proofReference") or "",
        "statement": statement,
    }]
    print("\n--- action body (what will be posted) ---")
    print(json.dumps(action_args, indent=1)[:2000])
    if args.dry_run:
        print("\n--dry-run: not posting.")
        return 0

    # Sign in as account #1.
    wallets = R.load_wallets()
    w1 = wallets[0]
    print("\naccount #1:", w1["email"], w1["address"])
    s = requests.Session()
    s.headers.update({"User-Agent": R.UA})
    if not R.sign_in(s, w1, "7V7PW2RJ"):
        print("sign_in FAILED — cannot file.")
        return 1

    body = json.dumps(action_args)
    headers = {
        "Next-Action": SUBMIT_ACTION_ID,
        "Accept": "text/x-component",
        "Content-Type": "text/plain;charset=UTF-8",
    }
    r = R.req(s, "POST", f"{R.BASE}/dashboard/submissions?category=wildcard",
              data=body, headers=headers)
    print(f"\nsubmitWildcardSubmission -> HTTP {r.status_code} len={len(r.text)}")
    print("--- response (first 2000 chars) ---")
    print(r.text[:2000])
    result = {"status_code": r.status_code, "response": r.text[:4000],
              "projectUrl": p["projectUrl"], "endpoint_included": include_endpoint}
    json.dump(result, open(f"{WORKDIR}/wildcard-submission-result.json", "w"), indent=1)
    print("\nsaved wildcard-submission-result.json")
    return 0 if r.status_code == 200 else 1

if __name__ == "__main__":
    raise SystemExit(main())
