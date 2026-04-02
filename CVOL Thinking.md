Context: We have CVOL (CME Volatility Index) data for Natural Gas with the following columns:
CVOL_INDEX_(NGVL), DOWN_VAR_(NGDN), UP_VAR_(NGUP), SKEW_(NGSK), SKEW_RATIO_(NGSK), ATM_(NGAT), CONVEXITY_(NGCO), UNDERLYING
Objective: Every other sheet in our system is designed — to varying degrees — to catch peaks and troughs in natural gas. CVOL data is the cherry on top: if integrated correctly, these indices can take our signal quality to another level.
What I need — a deep implementation plan, NO code:

Define each column. For every column above, explain what it represents, what it measures, and what its behavior implies about market conditions. Debate the nuances — don't just give textbook definitions.
Signal logic per column. For each index, reason through: when it hits a peak or trough, what does that historically suggest about NG price direction? Which columns are leading indicators vs. confirming indicators vs. noise?
Cross-column relationships. These columns are all connected. Map out the key relationships — e.g., how does skew diverging from ATM vol signal something different than when they move together? How does convexity confirm or contradict what down-variance is saying?
Backtesting framework. Outline how we'd validate this: when NG hit known bottoms or tops, what were these CVOL indices doing? Define the methodology for checking alignment — not the code, but the logic and the lookback structure.
Integration into our current system. How does this fit into the existing workbook architecture? Propose a new 4th tab — what gets displayed, how it's structured, and how it feeds into or cross-references the signals from our other sheets.
Ground rules:

Think like a quant who actually trades vol, not a textbook.
Be statistically rigorous — no hand-waving.
The foundation has to be bulletproof before we write a single line of code.
Every design choice must serve the core goal: catching directional inflection points in NG.