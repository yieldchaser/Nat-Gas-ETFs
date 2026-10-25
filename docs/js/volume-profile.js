/* ============================================================
   Volume Profile — volume at price
   Horizontal volume histogram by price bucket, Point of Control (POC),
   70% Value Area (VAL/VAH), up/down volume split, log/linear scale
   ============================================================ */

const VolumeProfile = {
    state: {
        ticker: 'BOIL',
        range: '1y',
        unit: 'shares',
        fixedFrom: null,
        fixedTo: null,
        hoverBucket: null,
        _cache: null,
        _bound: false
    },
    _chipsBuilt: false,
    _syncing: false,
    _payload: null,

    PRESETS: {
        '1m': 30,
        '3m': 90,
        '6m': 180,
        '1y': 365,
        '2y': 730,
        '5y': 1826,
        'all': null
    },

    ETF_COLORS: {
        'BOIL': '#c07828',
        'HNU.TO': '#3db87a',
        '3NGL.L': '#8855bb',
        'KOLD': '#5090a0',
        'HND.TO': '#d4a830',
        '3NGS.L': '#e06060'
    },

    fmtPrice(p) {
        if (p == null || !isFinite(p)) return '—';
        const a = Math.abs(p);
        if (a >= 1e9) return (p / 1e9).toFixed(2) + 'B';
        if (a >= 1e6) return (p / 1e6).toFixed(1) + 'M';
        if (a >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        if (a >= 100) return p.toFixed(1);
        if (a >= 1) return p.toFixed(2);
        return p.toFixed(3);
    },

    fmtVol(v, unit) {
        if (v == null || !isFinite(v)) return '—';
        const prefix = unit === 'dollar' ? '$' : '';
        const a = Math.abs(v);
        const sign = v < 0 ? '-' : '';
        if (a >= 1e12) return `${sign}${prefix}${(a / 1e12).toFixed(2)}T`;
        if (a >= 1e9) return `${sign}${prefix}${(a / 1e9).toFixed(2)}B`;
        if (a >= 1e6) return `${sign}${prefix}${(a / 1e6).toFixed(2)}M`;
        if (a >= 1e3) return `${sign}${prefix}${(a / 1e3).toFixed(0)}K`;
        return `${sign}${prefix}${a.toFixed(0)}`;
    },

    _lowerBound(dates, val) {
        let lo = 0;
        let hi = dates.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (dates[mid] < val) lo = mid + 1;
            else hi = mid;
        }
        return Math.min(lo, dates.length - 1);
    },

    _upperBound(dates, val) {
        let lo = 0;
        let hi = dates.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (dates[mid] <= val) lo = mid + 1;
            else hi = mid;
        }
        return Math.max(0, lo - 1);
    },

    priceAtFrac(prof, f) {
        if (!prof) return 0;
        if (prof.useLog) {
            return Math.exp(Math.log(prof.maxP) - f * (Math.log(prof.maxP) - Math.log(prof.minP)));
        }
        return prof.maxP - f * prof.span;
    },

    priceFrac(prof, price) {
        if (!prof || prof.span <= 0) return 0;
        if (prof.useLog) {
            return (Math.log(prof.maxP) - Math.log(price)) / (Math.log(prof.maxP) - Math.log(prof.minP));
        }
        return (prof.maxP - price) / prof.span;
    },

    bucketLowPrice(prof, b) {
        return this.priceAtFrac(prof, 1 - b / prof.n);
    },

    bucketHighPrice(prof, b) {
        return this.priceAtFrac(prof, 1 - (b + 1) / prof.n);
    },

    bucketMidPrice(prof, b) {
        return this.priceAtFrac(prof, 1 - (b + 0.5) / prof.n);
    },

    _getHistory(ticker) {
        if (typeof App !== 'undefined' && App.allMetrics && App.allMetrics[ticker]) {
            return App.allMetrics[ticker].history || [];
        }
        return [];
    },

    compute(ticker, rangeKey = '1y', unit = 'shares', fixedFrom = null, fixedTo = null, customHistory = null) {
        let history = customHistory;
        if (!history) {
            if (Array.isArray(ticker)) {
                history = ticker;
            } else if (typeof App !== 'undefined' && App.allMetrics && App.allMetrics[ticker]) {
                history = App.allMetrics[ticker].history;
            }
        }
        if (!history || !Array.isArray(history) || history.length < 3) return null;

        const dates = history.map(b => (b && b.date) ? b.date : '');
        let startIdx = 0;
        let endIdx = history.length - 1;

        if (rangeKey === 'custom') {
            const fromDate = fixedFrom || dates[0];
            const toDate = fixedTo || dates[dates.length - 1];
            startIdx = this._lowerBound(dates, fromDate);
            endIdx = this._upperBound(dates, toDate);
            if (startIdx > endIdx) {
                const tmp = startIdx;
                startIdx = endIdx;
                endIdx = tmp;
            }
        } else {
            const days = this.PRESETS[rangeKey];
            if (days == null) {
                startIdx = 0;
                endIdx = history.length - 1;
            } else {
                const lastDate = dates[dates.length - 1];
                const anchor = new Date(lastDate + 'T00:00:00').getTime();
                const cutoff = new Date(anchor - days * 864e5).toISOString().slice(0, 10);
                let s = dates.findIndex(d => d >= cutoff);
                startIdx = (s === -1) ? 0 : s;
                endIdx = history.length - 1;
            }
        }

        startIdx = Math.max(0, Math.min(history.length - 1, startIdx));
        endIdx = Math.max(0, Math.min(history.length - 1, endIdx));
        if (endIdx - startIdx < 2) return null;

        let minP = Infinity;
        let maxP = -Infinity;
        for (let i = startIdx; i <= endIdx; i++) {
            const bar = history[i];
            if (!bar) continue;
            const c = bar.close;
            if (c == null || !isFinite(c) || c <= 0) continue;
            if (c < minP) minP = c;
            if (c > maxP) maxP = c;
        }
        if (!isFinite(minP) || !isFinite(maxP)) return null;
        if (minP === maxP) {
            minP *= 0.999;
            maxP *= 1.001;
        }

        const n = 42;
        const span = maxP - minP;
        const useLog = (maxP / minP) > 4.0;
        const logMin = useLog ? Math.log(minP) : 0;
        const logSpan = useLog ? (Math.log(maxP) - logMin) : 0;

        const bucketOf = c => {
            if (useLog) {
                return Math.min(n - 1, Math.max(0, Math.floor(((Math.log(c) - logMin) / logSpan) * n)));
            }
            return Math.min(n - 1, Math.max(0, Math.floor(((c - minP) / span) * n)));
        };

        const buckets = [];
        for (let b = 0; b < n; b++) {
            buckets.push({ up: 0, down: 0, total: 0, sessions: 0 });
        }

        let totalVol = 0;
        for (let i = startIdx; i <= endIdx; i++) {
            const bar = history[i];
            if (!bar) continue;
            const c = bar.close;
            if (c == null || !isFinite(c) || c <= 0) continue;
            const b = bucketOf(c);

            const v = (unit === 'dollar')
                ? ((bar.dollarVolume != null && isFinite(bar.dollarVolume)) ? bar.dollarVolume : ((bar.volume || 0) * c))
                : (bar.volume || 0);

            const prevClose = (i > 0 && history[i - 1] && history[i - 1].close != null && isFinite(history[i - 1].close))
                ? history[i - 1].close
                : c;

            if (c >= prevClose) {
                buckets[b].up += v;
            } else {
                buckets[b].down += v;
            }
            buckets[b].total += v;
            buckets[b].sessions += 1;
            totalVol += v;
        }

        let pocIdx = 0;
        for (let b = 1; b < n; b++) {
            if (buckets[b].total > buckets[pocIdx].total) {
                pocIdx = b;
            }
        }

        let vaLo = pocIdx;
        let vaHi = pocIdx;
        let vaVol = buckets[pocIdx].total;
        while (vaVol < totalVol * 0.7 && (vaLo > 0 || vaHi < n - 1)) {
            const below = (vaLo > 0) ? buckets[vaLo - 1].total : -1;
            const above = (vaHi < n - 1) ? buckets[vaHi + 1].total : -1;
            if (above >= below) {
                vaHi++;
                vaVol += buckets[vaHi].total;
            } else {
                vaLo--;
                vaVol += buckets[vaLo].total;
            }
        }

        const profDraft = { n, minP, maxP, span, useLog };
        const val = this.bucketLowPrice(profDraft, vaLo);
        const vah = this.bucketHighPrice(profDraft, vaHi);

        return {
            buckets,
            n,
            minP,
            maxP,
            span,
            useLog,
            pocIdx,
            vaLo,
            vaHi,
            val,
            vah,
            totalVol,
            startIdx,
            endIdx,
            ticker: (typeof ticker === 'string') ? ticker : 'BOIL',
            unit,
            rangeKey
        };
    },

    _getPayload(ticker, history) {
        if (!history || history.length < 3) return null;
        const last = history[history.length - 1].date || '';
        const customPart = this.state.range === 'custom' ? `${this.state.fixedFrom}-${this.state.fixedTo}` : '';
        const key = `${ticker}|${this.state.range}|${this.state.unit}|${customPart}|${history.length}|${last}`;
        if (this.state._cache && this.state._cache.key === key) {
            return this.state._cache.prof;
        }
        const prof = this.compute(ticker, this.state.range, this.state.unit, this.state.fixedFrom, this.state.fixedTo, history);
        this.state._cache = { key, prof };
        return prof;
    },

    draw(prof, ticker, unit) {
        const canvas = document.getElementById('vp-canvas');
        if (!canvas || !prof) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (w < 40 || h < 40) return;

        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const pad = { top: 14, right: 74, bottom: 26, left: 14 };
        const chartW = w - pad.left - pad.right;
        const chartH = h - pad.top - pad.bottom;
        if (chartW < 10 || chartH < 10) return;

        const n = prof.n;
        const rowH = chartH / n;
        const maxTotal = Math.max(prof.buckets[prof.pocIdx].total, 1);

        // 1. Shaded Value Area horizontal rectangle
        if (prof.totalVol > 0 && prof.vaLo != null && prof.vaHi != null) {
            ctx.fillStyle = 'rgba(80,144,160,0.10)';
            const vaTopY = pad.top + (n - 1 - prof.vaHi) * rowH;
            const vaHeight = (prof.vaHi - prof.vaLo + 1) * rowH;
            ctx.fillRect(pad.left, vaTopY, chartW, vaHeight);
        }

        // 2. Hover bucket row highlight
        if (this.state.hoverBucket != null && this.state.hoverBucket >= 0 && this.state.hoverBucket < n) {
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            const hoverY = pad.top + (n - 1 - this.state.hoverBucket) * rowH;
            ctx.fillRect(pad.left, hoverY, chartW, Math.max(rowH, 2));
        }

        // 3. Grid lines & Right-side Price Axis labels
        ctx.font = '9px monospace';
        for (let t = 0; t <= 5; t++) {
            const price = this.priceAtFrac(prof, t / 5);
            const y = pad.top + (t / 5) * chartH;
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(pad.left + chartW, y);
            ctx.stroke();

            ctx.fillStyle = 'rgba(255,255,255,0.40)';
            ctx.textAlign = 'left';
            ctx.fillText(this.fmtPrice(price), pad.left + chartW + 6, y + 3);
        }

        // 4. Horizontal Volume Bars (Green up-volume on left, Red down-volume appended)
        for (let b = 0; b < n; b++) {
            const bk = prof.buckets[b];
            if (bk.total <= 0) continue;
            const y = pad.top + (n - 1 - b) * rowH;
            const barH = Math.max(1, rowH - 1);
            const len = (bk.total / maxTotal) * chartW * 0.95;
            const upLen = bk.total > 0 ? (bk.up / bk.total) * len : 0;
            const downLen = len - upLen;

            ctx.fillStyle = '#3db87a';
            ctx.fillRect(pad.left, y, upLen, barH);
            ctx.fillStyle = '#da3633';
            ctx.fillRect(pad.left + upLen, y, downLen, barH);

            // Gold 1px border around POC bar
            if (b === prof.pocIdx) {
                ctx.strokeStyle = 'rgba(212,168,48,0.95)';
                ctx.lineWidth = 1;
                ctx.strokeRect(pad.left - 0.5, y - 0.5, len + 1, barH + 1);
            }
        }

        // 5. Gold POC Tag
        if (prof.totalVol > 0) {
            const pocY = pad.top + (n - 1 - prof.pocIdx) * rowH + rowH / 2;
            const pocLen = (prof.buckets[prof.pocIdx].total / maxTotal) * chartW * 0.95;
            const px = Math.min(pad.left + pocLen + 6, pad.left + chartW - 28);
            ctx.font = 'bold 9px monospace';
            const pw = ctx.measureText('POC').width;
            ctx.fillStyle = 'rgba(10,10,18,0.85)';
            ctx.fillRect(px - 2, pocY - 6, pw + 4, 11);
            ctx.fillStyle = 'rgba(212,168,48,0.95)';
            ctx.textAlign = 'left';
            ctx.fillText('POC', px, pocY + 3);
        }

        // 6. Dashed line for latest session close with LAST $X.XX tag
        const history = this._getHistory(ticker);
        const lastClose = history && history[prof.endIdx] ? history[prof.endIdx].close : null;
        if (lastClose != null && isFinite(lastClose) && prof.span > 0) {
            const frac = this.priceFrac(prof, lastClose);
            let y = pad.top + frac * chartH;
            y = Math.max(pad.top, Math.min(pad.top + chartH, y));

            ctx.strokeStyle = 'rgba(80,144,160,0.9)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(pad.left + chartW, y);
            ctx.stroke();
            ctx.setLineDash([]);

            const endLbl = (prof.endIdx === history.length - 1 ? 'LAST $' : 'RANGE CLOSE $') + this.fmtPrice(lastClose);
            ctx.font = 'bold 9px monospace';
            const endW = ctx.measureText(endLbl).width;
            const endY = (y - 3 < pad.top + 9) ? y + 10 : y - 3;
            ctx.fillStyle = 'rgba(10,10,18,0.85)';
            ctx.fillRect(pad.left + 2, endY - 8, endW + 5, 11);
            ctx.fillStyle = 'rgba(80,144,160,0.95)';
            ctx.fillText(endLbl, pad.left + 4, endY);
        }
    },

    updateMeta(prof, ticker, unit) {
        const rangeEl = document.getElementById('vp-range-label');
        const statsEl = document.getElementById('vp-stats');
        const history = this._getHistory(ticker);

        if (rangeEl) {
            if (prof && history && history[prof.startIdx] && history[prof.endIdx]) {
                const startIso = history[prof.startIdx].date;
                const endIso = history[prof.endIdx].date;
                const sessionsCount = prof.endIdx - prof.startIdx + 1;
                const startFmt = (typeof formatDisplayDate === 'function') ? formatDisplayDate(startIso) : startIso;
                const endFmt = (typeof formatDisplayDate === 'function') ? formatDisplayDate(endIso) : endIso;
                const logBadge = prof.useLog ? ' · <span class="vp-log">LOG</span>' : '';
                rangeEl.innerHTML = `${startFmt} → ${endFmt} · ${sessionsCount} sessions${logBadge}`;
                rangeEl.title = prof.useLog ? 'Price range spans more than 4x. Buckets use log-price spacing to keep split-adjusted history readable.' : '';
            } else {
                rangeEl.innerHTML = '';
                rangeEl.title = '';
            }
        }

        if (!statsEl) return;
        if (!prof || !prof.totalVol) {
            statsEl.innerHTML = '<span class="vp-stats-na">NO VOLUME DATA</span>';
            return;
        }

        const pocP = this.bucketMidPrice(prof, prof.pocIdx);
        const vaLoP = this.bucketLowPrice(prof, prof.vaLo);
        const vaHiP = this.bucketHighPrice(prof, prof.vaHi);
        const lastClose = history && history[prof.endIdx] ? history[prof.endIdx].close : null;

        let upTot = 0;
        for (const b of prof.buckets) {
            upTot += b.up;
        }
        const upPct = prof.totalVol > 0 ? (upTot / prof.totalVol) * 100 : 0;

        let vaPos = '';
        let vaPosColor = 'rgba(255,255,255,0.7)';
        if (lastClose != null && isFinite(lastClose)) {
            if (lastClose > vaHiP) {
                vaPos = 'ABOVE VALUE AREA';
                vaPosColor = '#3db87a';
            } else if (lastClose < vaLoP) {
                vaPos = 'BELOW VALUE AREA';
                vaPosColor = '#da3633';
            } else {
                vaPos = 'INSIDE VALUE AREA';
                vaPosColor = '#5090a0';
            }
        }

        const closeSpan = (lastClose != null && isFinite(lastClose))
            ? `<span><b>RANGE CLOSE</b> $${this.fmtPrice(lastClose)} <span style="color:${vaPosColor};font-weight:800;">${vaPos}</span></span>`
            : '';

        statsEl.innerHTML =
            `<span><b>POC</b> $${this.fmtPrice(pocP)}</span>` +
            `<span><b>VALUE AREA</b> $${this.fmtPrice(vaLoP)} – $${this.fmtPrice(vaHiP)}</span>` +
            closeSpan +
            `<span><b>TOTAL VOL</b> ${this.fmtVol(prof.totalVol, unit)}</span>` +
            `<span style="color:#3db87a;"><b style="color:#3db87a;">UP-DAY VOL</b> ${upPct.toFixed(0)}%</span>` +
            `<span style="color:#da3633;"><b style="color:#da3633;">DOWN-DAY VOL</b> ${(100 - upPct).toFixed(0)}%</span>`;
    },

    _onMove(e) {
        const canvas = document.getElementById('vp-canvas');
        const wrap = document.getElementById('vp-canvas-wrap');
        const tooltip = document.getElementById('vp-tooltip');
        if (!canvas || !wrap || !tooltip) return;
        const prof = this._payload;
        if (!prof) return;

        const rect = canvas.getBoundingClientRect();
        const pad = { top: 14, right: 74, bottom: 26, left: 14 };
        const chartH = rect.height - pad.top - pad.bottom;
        if (chartH <= 0) return;

        const clientX = e.clientX;
        const clientY = e.clientY;
        const y = clientY - rect.top;
        const x = clientX - rect.left;

        if (x < pad.left || x > rect.width - pad.right || y < pad.top || y > rect.height - pad.bottom) {
            this._onLeave();
            return;
        }

        const b = (prof.n - 1) - Math.floor(((y - pad.top) / chartH) * prof.n);
        if (b < 0 || b >= prof.n) {
            this._onLeave();
            return;
        }

        if (this.state.hoverBucket !== b) {
            this.state.hoverBucket = b;
            this.draw(prof, this.state.ticker, this.state.unit);
        }

        const bk = prof.buckets[b];
        const loP = this.bucketLowPrice(prof, b);
        const hiP = this.bucketHighPrice(prof, b);
        const pct = prof.totalVol > 0 ? (bk.total / prof.totalVol) * 100 : 0;
        const upPct = bk.total > 0 ? (bk.up / bk.total) * 100 : 0;

        let badge = '';
        if (b === prof.pocIdx) {
            badge = '<span class="vp-tt-badge vp-tt-poc">POC</span>';
        } else if (b >= prof.vaLo && b <= prof.vaHi) {
            badge = '<span class="vp-tt-badge vp-tt-va">VALUE AREA</span>';
        } else {
            badge = '<span class="vp-tt-badge vp-tt-out">OUTSIDE VA</span>';
        }

        tooltip.innerHTML =
            `<div class="vp-tt-header"><span class="vp-tt-date">$${this.fmtPrice(loP)} – $${this.fmtPrice(hiP)}</span>${badge}</div>` +
            `<div class="vp-tt-row"><span class="vp-tt-lbl">VOLUME</span><span class="vp-tt-val">${this.fmtVol(bk.total, this.state.unit)}</span></div>` +
            `<div class="vp-tt-row"><span class="vp-tt-lbl">VOL SHARE</span><span class="vp-tt-val">${pct.toFixed(1)}%</span></div>` +
            `<div class="vp-tt-row"><span class="vp-tt-lbl">SESSIONS</span><span class="vp-tt-val">${bk.sessions}</span></div>` +
            `<div class="vp-tt-divider"></div>` +
            `<div class="vp-tt-row"><span class="vp-tt-lbl">UP-DAY VOL</span><span class="vp-tt-val" style="color:#3db87a;">${upPct.toFixed(0)}%</span></div>` +
            `<div class="vp-tt-row"><span class="vp-tt-lbl">DOWN-DAY VOL</span><span class="vp-tt-val" style="color:#da3633;">${(100 - upPct).toFixed(0)}%</span></div>`;

        tooltip.style.display = 'block';
        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;
        let left = x + 16;
        if (left + tw > rect.width - 4) left = x - tw - 16;
        left = Math.max(4, left);
        let top = y - th / 2;
        top = Math.max(4, Math.min(rect.height - th - 4, top));
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    },

    _onLeave() {
        const tooltip = document.getElementById('vp-tooltip');
        if (tooltip) tooltip.style.display = 'none';
        if (this.state.hoverBucket !== null) {
            this.state.hoverBucket = null;
            if (this._payload) {
                this.draw(this._payload, this.state.ticker, this.state.unit);
            }
        }
    },

    _drawMessage(text) {
        const canvas = document.getElementById('vp-canvas');
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 40) return;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.font = '11px monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.40)';
        ctx.textAlign = 'center';
        ctx.fillText(text, rect.width / 2, rect.height / 2);
        const tooltip = document.getElementById('vp-tooltip');
        if (tooltip) tooltip.style.display = 'none';
    },

    _syncDateInputs(history) {
        const fromEl = document.getElementById('vp-from');
        const toEl = document.getElementById('vp-to');
        if (!fromEl || !toEl || !history || history.length < 2) return;
        const first = history[0].date;
        const last = history[history.length - 1].date;
        fromEl.min = first;
        fromEl.max = last;
        toEl.min = first;
        toEl.max = last;
        if (!this.state.fixedFrom || this.state.fixedFrom < first || this.state.fixedFrom > last) {
            this.state.fixedFrom = first;
        }
        if (!this.state.fixedTo || this.state.fixedTo < first || this.state.fixedTo > last) {
            this.state.fixedTo = last;
        }
        fromEl.value = this.state.fixedFrom;
        toEl.value = this.state.fixedTo;
    },

    _buildChips() {
        const container = document.getElementById('vp-chips');
        if (!container || this._chipsBuilt || typeof document === 'undefined' || typeof document.createElement !== 'function') return;
        container.innerHTML = '';
        const etfs = (typeof CONFIG !== 'undefined' && CONFIG.etfs) ? CONFIG.etfs : {};
        const order = ['BOIL', 'HNU.TO', '3NGL.L', 'KOLD', 'HND.TO', '3NGS.L'];
        for (const t of order) {
            const info = etfs[t] || {};
            const name = info.name || t;
            const color = this.ETF_COLORS[t] || (info.side === 'long' ? '#3db87a' : '#c04040');
            const chip = document.createElement('button');
            chip.className = 'vp-chip';
            chip.textContent = t;
            chip.setAttribute('data-ticker', t);
            chip.setAttribute('data-tooltip', `${t} (${name})`);
            chip.style.color = color;
            chip.style.borderColor = color;
            chip.addEventListener('click', () => {
                this.selectTicker(t);
            });
            container.appendChild(chip);
        }
        this._chipsBuilt = true;
    },

    _updateChips() {
        this._buildChips();
        const container = document.getElementById('vp-chips');
        if (!container) return;
        container.querySelectorAll('.vp-chip').forEach(chip => {
            const t = chip.getAttribute('data-ticker');
            const active = (t === this.state.ticker);
            const color = this.ETF_COLORS[t] || '#3db87a';
            chip.classList.toggle('active', active);
            chip.classList.toggle('inactive', !active);
            chip.style.background = active ? `${color}22` : 'transparent';
            chip.style.borderColor = color;
            chip.style.color = color;
            chip.style.opacity = active ? '1' : '0.45';
            chip.style.boxShadow = active ? '0 2px 6px rgba(0, 0, 0, 0.4)' : 'none';
        });
    },

    selectTicker(ticker) {
        if (!ticker) return;
        this.state.ticker = ticker;
        this.state.hoverBucket = null;
        this.state._cache = null;
        this._updateChips();
        this.updateCardSelection();

        if (!VolumeProfile._syncing) {
            VolumeProfile._syncing = true;
            try {
                if (typeof VolumeStudies !== 'undefined' && typeof VolumeStudies.selectTicker === 'function') {
                    if (VolumeStudies.state && VolumeStudies.state.ticker !== ticker) {
                        VolumeStudies.selectTicker(ticker);
                    }
                }
            } finally {
                VolumeProfile._syncing = false;
            }
        }
        this.render();
    },

    setRange(rangeKey) {
        const prev = this.state.range;
        this.state.range = rangeKey;
        const history = this._getHistory(this.state.ticker);

        if (rangeKey === 'custom' && history && history.length >= 3 && (!this.state.fixedFrom || !this.state.fixedTo)) {
            const days = this.PRESETS[prev === 'custom' ? '1y' : prev] || 365;
            const dates = history.map(b => (b && b.date) ? b.date : '');
            const lastDate = dates[dates.length - 1];
            const anchor = new Date(lastDate + 'T00:00:00').getTime();
            const cutoff = new Date(anchor - days * 864e5).toISOString().slice(0, 10);
            let s = dates.findIndex(d => d >= cutoff);
            this.state.fixedFrom = dates[(s === -1) ? 0 : s];
            this.state.fixedTo = dates[dates.length - 1];
        }

        if (rangeKey === 'custom' && this.state.fixedFrom && this.state.fixedTo && this.state.fixedFrom > this.state.fixedTo) {
            const tmp = this.state.fixedFrom;
            this.state.fixedFrom = this.state.fixedTo;
            this.state.fixedTo = tmp;
        }

        const fixed = document.getElementById('vp-fixed-controls');
        if (fixed) fixed.style.display = (rangeKey === 'custom') ? 'flex' : 'none';

        const rangeTabs = document.getElementById('vp-range-tabs');
        if (rangeTabs) {
            rangeTabs.querySelectorAll('button').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-range') === rangeKey);
            });
        }

        this.state.hoverBucket = null;
        this.state._cache = null;
        this.render();
    },

    setUnit(unit) {
        if (unit !== 'shares' && unit !== 'dollar') return;
        this.state.unit = unit;

        const unitTabs = document.getElementById('vp-unit-tabs');
        if (unitTabs) {
            unitTabs.querySelectorAll('button').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-unit') === unit);
            });
        }

        this.state.hoverBucket = null;
        this.state._cache = null;
        this.render();
    },

    updateCardSelection() {
        if (typeof document === 'undefined') return;
        const selected = this.state.ticker;
        document.querySelectorAll('.etf-card[data-ticker]').forEach(card => {
            card.classList.toggle('card-selected', card.getAttribute('data-ticker') === selected);
        });
    },

    render() {
        const panel = document.getElementById('vp-panel');
        if (!panel) return;
        this._bind();

        const all = (typeof App !== 'undefined' && App.allMetrics) ? App.allMetrics : {};
        const tickers = ['BOIL', 'HNU.TO', '3NGL.L', 'KOLD', 'HND.TO', '3NGS.L'];

        if (!all[this.state.ticker] || !(all[this.state.ticker] || {}).history) {
            const first = tickers.find(t => all[t] && all[t].history && all[t].history.length >= 3);
            if (first) this.state.ticker = first;
        }
        this._updateChips();
        this.updateCardSelection();

        const history = this._getHistory(this.state.ticker);
        if (!history || history.length < 3) {
            this._payload = null;
            this._drawMessage('Waiting for price-volume history…');
            this.updateMeta(null, this.state.ticker, this.state.unit);
            return;
        }

        if (this.state.range === 'custom') {
            this._syncDateInputs(history);
        }

        const prof = this._getPayload(this.state.ticker, history);
        if (!prof) {
            this._payload = null;
            this._drawMessage('Insufficient history for selected range');
            this.updateMeta(null, this.state.ticker, this.state.unit);
            return;
        }
        this._payload = prof;

        const rangeTabs = document.getElementById('vp-range-tabs');
        if (rangeTabs) {
            rangeTabs.querySelectorAll('button').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-range') === this.state.range);
            });
        }
        const unitTabs = document.getElementById('vp-unit-tabs');
        if (unitTabs) {
            unitTabs.querySelectorAll('button').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-unit') === (this.state.unit || 'shares'));
            });
        }

        this.draw(prof, this.state.ticker, this.state.unit);
        this.updateMeta(prof, this.state.ticker, this.state.unit);
    },

    init() {
        this._bind();
    },

    _bind() {
        if (this._bound) return;
        const rangeTabs = document.getElementById('vp-range-tabs');
        const unitTabs = document.getElementById('vp-unit-tabs');
        const fromEl = document.getElementById('vp-from');
        const toEl = document.getElementById('vp-to');
        const canvas = document.getElementById('vp-canvas');

        if (rangeTabs) {
            rangeTabs.addEventListener('click', e => {
                const btn = e.target.closest('button');
                if (!btn) return;
                const r = btn.getAttribute('data-range');
                if (r) this.setRange(r);
            });
        }

        if (unitTabs) {
            unitTabs.addEventListener('click', e => {
                const btn = e.target.closest('button');
                if (!btn) return;
                const u = btn.getAttribute('data-unit');
                if (u) this.setUnit(u);
            });
        }

        const onDateChange = () => {
            if (!fromEl || !toEl) return;
            this.state.fixedFrom = fromEl.value || null;
            this.state.fixedTo = toEl.value || null;
            if (this.state.fixedFrom && this.state.fixedTo && this.state.fixedFrom > this.state.fixedTo) {
                const tmp = this.state.fixedFrom;
                this.state.fixedFrom = this.state.fixedTo;
                this.state.fixedTo = tmp;
                fromEl.value = this.state.fixedFrom;
                toEl.value = this.state.fixedTo;
            }
            this.state.hoverBucket = null;
            this.state._cache = null;
            this.render();
        };

        if (fromEl) fromEl.addEventListener('change', onDateChange);
        if (toEl) toEl.addEventListener('change', onDateChange);

        if (canvas) {
            canvas.addEventListener('mousemove', e => this._onMove(e));
            canvas.addEventListener('mouseleave', () => this._onLeave());

            const getTouchPos = e => {
                if (!e.touches || !e.touches.length) return null;
                return {
                    clientX: e.touches[0].clientX,
                    clientY: e.touches[0].clientY
                };
            };
            canvas.addEventListener('touchstart', e => {
                const pos = getTouchPos(e);
                if (pos) this._onMove(pos);
            }, { passive: true });
            canvas.addEventListener('touchmove', e => {
                const pos = getTouchPos(e);
                if (pos) this._onMove(pos);
            }, { passive: true });
            canvas.addEventListener('touchend', () => this._onLeave(), { passive: true });
            canvas.addEventListener('touchcancel', () => this._onLeave(), { passive: true });
        }

        this._buildChips();
        this._bound = true;
    }
};

if (typeof window !== 'undefined') {
    window.VolumeProfile = VolumeProfile;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VolumeProfile;
}
