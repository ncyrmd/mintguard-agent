# Filing the Wildcard submission (for the parent / woony)

The submission is filed as account #1 (handle `nickyixg7vy75j`) on
https://agentgames.zkverify.io/dashboard/submissions?category=wildcard
via the `submitWildcardSubmission` server action. Two things must be true
first:

## 1. Push the repo (browser)

Create a new PUBLIC GitHub repo `ncyrmd/mintguard-agent` and upload all files
in this directory (including `docs/index.html`, `.gitignore`, `LICENSE`,
`README.md`). The submission's `projectUrl` is
https://github.com/ncyrmd/mintguard-agent — the form requires it to be a
public HTTPS URL, and `submit-wildcard.py` refuses to file while it 404s.

## 2. Enable the live demo (browser, repo Settings → Pages)

GitHub Pages → Source: "Deploy from a branch", Branch: `main`, Folder: `/docs`.
That publishes the demo at https://ncyrmd.github.io/mintguard-agent/ — this is
the submission's `endpoint` (the agent running client-side in the browser).
`submit-wildcard.py` checks it is live (HTTP 200); if it is not up yet, it
files WITHOUT the endpoint line and says so.

## 3. File the submission

```bash
cd ~/workspace/agent-games/wildcard
~/workspace/agent-games/venv/bin/python submit-wildcard.py --dry-run  # checks only
~/workspace/agent-games/venv/bin/python submit-wildcard.py            # files it
```

The script signs in as account #1 (SIWE, key read from the waitlist file
inside the process only), posts the `submitWildcardSubmission` server action
with the payload in `submission-payload.json`, and saves the result to
`wildcard-submission-result.json`. Payload fields (form-validated):

- `title` (≥3 chars): "MintGuard — mint-safety verification agent for .ai Agent IDs"
- `projectUrl` (required, public HTTPS): the repo URL above
- `endpoint` (optional, public HTTPS): the GitHub Pages demo URL
- `whatItDoes` (required, ≤2000 chars): use case + how it works + key decisions
- `additionalLinks` (optional, one HTTPS URL per line): README link
- `proofReference` (optional, blank): no zkVerify proof — the verdict is
  reproducible from the pinned block instead (see README)
- `message` (optional, ≤1000 chars): note for the panel

## 4. (Optional, durable endpoint) Connect Vercel, then deploy

The VM's egress proxy blocks all tunnels (trycloudflare 403, SSH reset,
localtunnel/tunnelmole stalled), so there is no stable public server URL from
this VM. The durable fix is Vercel via the MCP connector:

1. `/opt/hatch/bin/vercel status` → currently `not_connected`.
2. `/opt/hatch/bin/vercel authorize-url` → share the `connect_url`; the user
   signs in to Vercel in the browser.
3. Then deploy this repo with the `create_deployment` tool (code is ready:
   `api/verify.js` + `api/index.js` + `vercel.json`).
4. Use the Vercel URL as the submission's `endpoint` (update the payload and
   re-file, or file with it if done before step 3).

The local server (`node server.js`, port 8787) is running on this VM as the
live reference implementation, but it dies on VM restart and has no public URL.
