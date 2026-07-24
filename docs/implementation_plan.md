# STRATEGIC BLUEPRINT: CVOL Integration & System Harmony

**CONTEXT:** This document is a high-level strategic guide for integrating the CVOL (Volatility) Dashboard as the 4th major tab of the Stratum Meridian ecosystem. It defines the "Ground Truth" of the existing system and the "Design DNA" that must be maintained.

---

## 💎 THE GROUND TRUTH: Verified System State
*The following systems have been audited and hardened. Do not refactor their core logic without a specific mandate, as they are the production "Source of Truth".*

1.  **CVOL Data Pipeline:** `scripts/fetch_cvol.py` is bulletproof. It handles CME authentication, incremental updates, deduplication, and gap-filling.
2.  **Data Format Standardization:** The repository's "Source of Truth" for CVOL data (`data/cvol/ngvl_cvol_history.csv`) is strictly **DD-MM-YYYY**. 
3.  **Live Price/Volume Logic:** `app.js` and `data.js` contain the recently patched "Market State Machine". It correctly handles Live Price and Percentage Change across all market states (Open, Closed, Weekend).
4.  **True Live Volume:** Intraday Volume calculation has been decoupled from chart-bar delays and now uses `meta.regularMarketVolume` for real-time ticker-tape accuracy.

---

## 🏛️ ARCHITECTURAL DNA: Design Principles
*To maintain the "Stratum Meridian" premium feel, use these established paradigms as your foundation.*

### ⚡ Performance-First Rendering
*   **The Custom Canvas Rule:** For dense, interactive time-series analysis (e.g., CVOL Skew or Term Structure), bypass `Chart.js`. Utilize the repository's native HTML5 Canvas rendering engine (see `flows.html` or `trough-peak.html`) for 60FPS fluid interactivity during zoom/drag operations.
*   **The X-Axis Engine:** Use the existing `drawXAxis()` logic for all multi-year charts to ensure consistent date spacing and weekend/leap-year handling.

### 🌑 Visual & UX Excellence
*   **Glassmorphism & Contrast:** Maintain the dark, high-contrast aesthetic using `var(--bg-panel)`, `var(--bg-secondary)`, and subtle `1px` borders.
*   **Typography Hierarchy:** `JetBrains Mono` is for math and quantitative results. Bold, uppercase `sans-serif` is for headers and metadata.
*   **The Tooltip Singleton:** **Zero clutter policy.** Never place descriptive text directly on charts. Use the universal `#chart-tooltip` with the `data-tooltip="..."` system for all analytical explanations.
*   **Component Consistency:** Re-use the dual-input "Range Brush" slider and the `.tab-group` / `.tab-btn` interaction models for a seamless user experience across all four tabs.

---

## 🛠️ ENGINEERING GUARDRAILS
*Strict technical constraints to prevent system failure during integration.*

### 🛡️ The Date Parsing Trap
*   **CRITICAL:** Native Javascript `new Date("DD-MM-YYYY")` will return `Invalid Date`.
*   **Requirement:** Manually split and invert all CVOL CSV strings to `YYYY-MM-DD` before creating Date objects in the frontend.

### 🛡️ Zero-Dependency Strategy (ZDS)
*   **Native over Library:** Do not introduce external dependencies (e.g., D3, PapaParse, Tailwind) for the 4th tab. Use native `fetch()`, native `.split()`, and native CSS variables. This ensures the dashboard remains a single-file-per-tab architecture with sub-50ms execution overhead.

### 🛡️ Independent State Management
*   Encapsulate all new CVOL-specific variables within a localized `state` object to prevent namespace collisions with the existing Vol/Flow monitors.

---

## 🚀 VISION: The 4th Tab
*The analytical architecture of the CVOL tab is yours to define. The goal is to distill the freshly repaired CVOL data into actionable volatility insights (Skew, Relative Vol, Regime Detection) that matches the institutional-grade rigor of the existing three tabs.*
