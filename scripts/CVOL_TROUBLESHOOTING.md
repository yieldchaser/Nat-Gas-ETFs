# CVOL Fetch — Troubleshooting Guide

## How to diagnose a failed run
1. Go to https://github.com/yieldchaser/Nat-Gas-ETFs/actions/workflows/fetch_cvol.yml
2. Click the failed run → click **fetch-cvol** job → expand **Fetch NGVL CVOL data**
3. Read the error message — match it to a case below

---

## Case 1 — `Response too small (6,590 bytes) — session likely invalid`
**Cause:** CME session tokens (CME_TOKEN / CME_USERINFO) have expired.

**Fix:**
1. Open Chrome → go to https://www.cmegroup.com/market-data/cme-group-benchmark-administration/cme-group-volatility-indexes.html
2. Log in if prompted
3. Press **F12** → click **Application** tab → left sidebar → **Cookies** → **https://www.cmegroup.com**
4. Click `cmeToken` row → click inside the **Cookie Value box at the bottom** → **Ctrl+A** → **Ctrl+C**
5. Go to https://github.com/yieldchaser/Nat-Gas-ETFs/settings/secrets/actions → click `CME_TOKEN` → **Update** → paste
6. Back in DevTools → click `userinfo` row → **Ctrl+A** → **Ctrl+C** in the value box
7. Click `CME_USERINFO` → **Update** → paste
8. Re-run the workflow

---

## Case 2 — `ObjectStore + stored object` error in Final URL
**Cause:** The `insid` value hardcoded in `fetch_cvol.py` has expired — CME rotates these periodically.

**Fix:**
1. Open Chrome → go to the CME CVOL page (log in first)
2. Press **F12** → **Network tab** → type `ControlPopup` in the filter box
3. Reload the page
4. Click the `ControlPopup.aspx` request that appears
5. Copy the full **Request URL** — it looks like:
```
   https://cmegroup-tools.quikstrike.net//User/ControlPopup.aspx?...&insid=XXXXXXXXX&qsid=...
```
6. Note the new `insid` number
7. In `scripts/fetch_cvol.py` update both:
   - `POPUP_PARAMS["insid"]` 
   - `TOOLS_PARAMS["insid"]`
8. Commit and push → re-run workflow

---

## Case 3 — `CME_TOKEN and CME_USERINFO must be set as environment variables`
**Cause:** GitHub secrets are missing entirely.

**Fix:** Follow Case 1 steps 4–7 to add the secrets from scratch.

---

## Case 4 — `Permission denied` / `403` on git push
**Cause:** GitHub Actions doesn't have write permission.

**Fix:**
1. Go to https://github.com/yieldchaser/Nat-Gas-ETFs/settings/actions
2. Scroll to **Workflow permissions**
3. Select **Read and write permissions**
4. Click **Save** → re-run workflow

---

## Case 5 — Run succeeds but 0 new rows appended
**Cause:** Market was closed (weekend/holiday) or CME hasn't published today's data yet.

**Fix:** No action needed. Data will appear on the next trading day run.

---

## How often tokens expire
- `cmeToken` / `userinfo` — typically every **4–8 weeks**
- `insid` — every **few months**
- When in doubt, refresh both

---

## Quick health check
A healthy run log looks like:
```
Status    : 200  |  Size: 3,300+ bytes     ← SSO working
X,XXX,XXX bytes received                   ← data page loaded (should be 3MB+)
8 series found                             ← JSON parsed correctly
New rows appended : 1                      ← daily append working
```
