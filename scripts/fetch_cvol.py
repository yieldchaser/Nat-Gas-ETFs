#!/usr/bin/env python3
"""
fetch_cvol.py  —  Daily NGVL CVOL history scraper
Reads CME auth from environment variables (GitHub Actions secrets).

Usage:
    CME_TOKEN=<value> CME_USERINFO=<value> python fetch_cvol.py
"""

import os
import re
import json
import uuid
import pandas as pd
import requests
from datetime import datetime, timezone
from pathlib import Path

# ── CONFIG ────────────────────────────────────────────────────────────────────
QUIKSTRIKE_BASE = "https://cmegroup-tools.quikstrike.net"
TOOLS_URL       = f"{QUIKSTRIKE_BASE}/User/QuikStrikeTools.aspx"
POPUP_BASE      = f"{QUIKSTRIKE_BASE}/User/ControlPopup.aspx"

# Parameters for the NGVL history popup (the page with JSONSettings data)
POPUP_PARAMS = {
    "ControlPath": "~/UserControls/VolIndex/HistoryChart/ViewControl.ascx",
    "insid":       "217381151",
    "dsrc":        "Intraday",
    "pcode":       "LN",
    "top":         "10",
    "caption":     "Real-time CVOL",
    "gcode":       "Red",
}

# Parameters for the QuikStrike dashboard page (used to activate a qsid via SSO)
TOOLS_PARAMS = {
    "viewitemid": "IntegratedVolIndexDashboard",
    "insid":      "217381151",
}

# Output path (relative to repo root — script should be run from repo root)
OUTPUT_CSV  = Path("data/cvol/ngvl_cvol_history.csv")
DOCS_CSV    = Path("docs/data/cvol/ngvl_cvol_history.csv")  # GitHub Pages copy

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer":         "https://www.cmegroup.com/",
}


# ── STEP 1: ACTIVATE QSID VIA CME SSO ────────────────────────────────────────
def get_fresh_qsid(cme_token: str, userinfo: str) -> tuple[str, requests.Session]:
    """
    Hits QuikStrikeTools with CME auth cookies and follows the SSO redirect
    chain to activate a fresh session. Returns (active_qsid, session).

    Flow:
      GET QuikStrikeTools?qsid=X  →  302 Login.aspx
      Login.aspx  →  CME SSO (cmegroup.com — our cookies fire here)
      CME SSO  →  302 back to QuikStrikeTools?qsid=X  →  200 OK, session active
    """
    session = requests.Session()
    session.headers.update(HEADERS)

    # Plant CME auth cookies for the cmegroup.com domain
    for name, val in [("cmeToken", cme_token), ("userinfo", userinfo)]:
        session.cookies.set(name, val, domain=".cmegroup.com", path="/")

    # Generate our candidate qsid (QuikStrike will accept any UUID we supply)
    qsid = str(uuid.uuid4())
    params = {**TOOLS_PARAMS, "qsid": qsid}

    print(f"  Requesting QuikStrikeTools (qsid={qsid[:8]}…)")
    resp = session.get(TOOLS_URL, params=params, allow_redirects=True, timeout=30)
    print(f"  Final URL : {resp.url[:90]}")
    print(f"  Status    : {resp.status_code}  |  Size: {len(resp.text):,} bytes")

    # Extract the active qsid from the final URL or HTML form action
    for src, pattern in [
        ("URL",  r'[?&]qsid=([\w\-]+)'),
        ("HTML", r'action="[^"]*qsid=([\w\-]+)"'),
        ("HTML", r'qsid=([\w\-]{36})'),   # bare UUID anywhere in HTML
    ]:
        m = re.search(pattern, resp.url if src == "URL" else resp.text)
        if m:
            active = m.group(1)
            print(f"  Active qsid extracted from {src}: {active[:8]}…")
            return active, session

    # Fallback: use the UUID we generated (may already be active if SSO worked)
    print(f"  Warning: qsid not found in response — using generated UUID as fallback")
    return qsid, session


# ── STEP 2: FETCH DATA PAGE ───────────────────────────────────────────────────
def fetch_data_page(qsid: str, session: requests.Session) -> str:
    params = {**POPUP_PARAMS, "qsid": qsid}
    resp   = session.get(POPUP_BASE, params=params, timeout=30)
    resp.raise_for_status()
    return resp.text


# ── STEP 3: PARSE JSONSETTINGS ────────────────────────────────────────────────
def extract_json_settings(html: str) -> dict:
    if len(html) < 10_000:
        raise ValueError(
            f"Response too small ({len(html):,} bytes) — session likely invalid.\n"
            "Check that CME_TOKEN and CME_USERINFO secrets are current."
        )

    script_pat = re.compile(
        r'<script[^>]*>(.*?UserControls\.VolIndex\.HistoryChart\.Chart.*?)</script>',
        re.DOTALL | re.IGNORECASE,
    )
    sm = script_pat.search(html)
    if not sm:
        raise ValueError("HistoryChart <script> block not found. Session may have expired.")

    js_pat = re.compile(r'"JSONSettings"\s*:\s*"((?:[^"\\]|\\.)*)"')
    jm     = js_pat.search(sm.group(1))
    if not jm:
        raise ValueError("'JSONSettings' key not found inside script block.")

    raw_str: str = json.loads(f'"{jm.group(1)}"')
    return json.loads(raw_str)


# ── STEP 4: BUILD WIDE DATAFRAME (ALL 8 SERIES) ───────────────────────────────
def build_all_series(parsed: dict) -> pd.DataFrame:
    frames = []
    for i, s in enumerate(parsed.get("Series", [])):
        name = (s.get("name") or s.get("Name") or f"Series_{i}").strip()
        col  = name.upper().replace(" ", "_").replace("-", "_")
        rows = []
        for pt in s.get("data", []):
            x_ms = pt.get("x")
            ts   = datetime.fromtimestamp(x_ms / 1000.0, tz=timezone.utc) if x_ms else None
            rows.append({"Timestamp": ts, col: pt.get("y")})
        df_s = pd.DataFrame(rows).dropna(subset=["Timestamp"]).set_index("Timestamp")
        frames.append(df_s)
        print(f"    [{i}] {col:<30} {len(df_s):>5} points")

    df = pd.concat(frames, axis=1).sort_index()
    df.index.name = "Timestamp"
    return df


# ── STEP 5: INCREMENTAL APPEND ────────────────────────────────────────────────
def incremental_update(new_df: pd.DataFrame, csv_path: Path) -> tuple[pd.DataFrame, int]:
    """Append only rows newer than what's already in the CSV."""
    if csv_path.exists():
        # Explicitly handle day-first date format (DD-MM-YYYY)
        existing = pd.read_csv(csv_path, index_col="Timestamp")
        existing.index = pd.to_datetime(existing.index, dayfirst=True)

        if existing.index.tzinfo is None:
            existing.index = existing.index.tz_localize("UTC")
        last_date = existing.index.max()
        new_rows  = new_df[new_df.index > last_date]
        combined  = pd.concat([existing, new_rows]).sort_index()
        combined  = combined[~combined.index.duplicated(keep="last")]
        return combined, len(new_rows)
    else:
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        return new_df, len(new_df)


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    # Read secrets from environment (set via GitHub Actions secrets)
    cme_token = os.environ.get("CME_TOKEN", "").strip()
    userinfo  = os.environ.get("CME_USERINFO", "").strip()

    if not cme_token or not userinfo:
        raise EnvironmentError(
            "CME_TOKEN and CME_USERINFO must be set as environment variables.\n"
            "On GitHub Actions, add them as repository secrets.\n"
            "Locally: CME_TOKEN=xxx CME_USERINFO=yyy python fetch_cvol.py"
        )

    print("[1/5] Activating QuikStrike session via CME SSO…")
    qsid, session = get_fresh_qsid(cme_token, userinfo)

    print("\n[2/5] Fetching NGVL CVOL data page…")
    html = fetch_data_page(qsid, session)
    print(f"      {len(html):,} bytes received")

    print("\n[3/5] Parsing JSONSettings…")
    parsed   = extract_json_settings(html)
    n_series = len(parsed.get("Series", []))
    print(f"      {n_series} series found")

    print("\n[4/5] Building DataFrame (all series)…")
    df_new = build_all_series(parsed)

    print("\n[5/5] Incremental CSV update…")
    df_final, new_rows = incremental_update(df_new, OUTPUT_CSV)
    
    # Save with clean DD-MM-YYYY date format
    df_final.to_csv(OUTPUT_CSV, date_format='%d-%m-%Y')

    # Sync to docs/data/ for GitHub Pages
    DOCS_CSV.parent.mkdir(parents=True, exist_ok=True)
    df_final.to_csv(DOCS_CSV, date_format='%d-%m-%Y')

    print(f"\n{'='*60}")
    print(f"  New rows appended : {new_rows}")
    print(f"  Total rows        : {len(df_final)}")
    print(f"  Date range        : {df_final.index.min().date()} → {df_final.index.max().date()}")
    print(f"  Saved to          : {OUTPUT_CSV}")
    print(f"  Docs copy         : {DOCS_CSV}")
    if new_rows == 0:
        print("  (No new data — market may have been closed, or data not yet released)")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
