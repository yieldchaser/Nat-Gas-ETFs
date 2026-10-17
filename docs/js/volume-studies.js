/* ============================================
   Price-Volume Studies — classic volume indicators
   Volume, Volume Oscillator, Net Volume, OBV, PVT
   ============================================ */

const VolumeStudies = {
    state: {
        ticker: 'BOIL',
        study: 'vol',
        range: '1y',
        hoverIdx: null,
        lastMouse: { x: 0, y: 0 }
    },
    _bound: false,
    _chipsBuilt: false,
    _cache: null,
    _payload: null,
    _rafId: null,

    COLORS: {
        up: '#3db87a',
        down: '#c04040',
        flat: 'rgba(255,255,255,0.30)',
        line: '#5090a0',
        ma: '#d4a830',
        grid: 'rgba(255,255,255,0.06)',
        label: 'rgba(255,255,255,0.40)',
        crosshair: 'rgba(255,255,255,0.35)'
    },

    PAD: { top: 12, right: 14, bottom: 24, left: 58 },

    _cfg() {
        const fallback = { oscillator: { fast: 5, slow: 21 }, ma: 21 };
        if (typeof CONFIG === 'undefined') return fallback;
        return CONFIG.volumeStudies || fallback;
    },

    fmtVol(v) {
        if (v == null || !isFinite(v)) return '--';
        const a = Math.abs(v);
        if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
        if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
        return v.toFixed(0);
    },

    fmtSigned(v) {
        if (v == null || !isFinite(v)) return '--';
        return (v > 0 ? '+' : '') + this.fmtVol(v);
    },

    fmtPrice(p) {
        if (p == null || !isFinite(p)) return '--';
        const a = Math.abs(p);
        if (a >= 1e9) return (p / 1e9).toFixed(2) + 'B';
        if (a >= 1e6) return (p / 1e6).toFixed(1) + 'M';
        if (a >= 100) return p.toFixed(1);
        if (a >= 1) return p.toFixed(2);
        return p.toFixed(3);
    },

    fmtDate(d) {
        if (!d) return '--';
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const m = parseInt(d.slice(5, 7), 10);
        return `${months[m - 1] || '?'} '${d.slice(2, 4)}`;
    },

    sma(values, n) {
        const out = new Array(values.length).fill(null);
        if (!values || n <= 0) return out;
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
            sum += values[i] || 0;
            if (i >= n) sum -= values[i - n] || 0;
            if (i >= n - 1) out[i] = sum / n;
        }
        return out;
    },

    rollingSum(series, n) {
        const out = new Array(series.length).fill(null);
        if (!series || n <= 0) return out;
        let sum = 0;
        for (let i = 0; i < series.length; i++) {
            sum += series[i] || 0;
            if (i >= n) sum -= series[i - n] || 0;
            if (i >= n - 1) out[i] = sum;
        }
        return out;
    },

    signSeries(closes) {
        const out = new Array(closes.length).fill(0);
        for (let i = 1; i < closes.length; i++) {
            out[i] = closes[i] > closes[i - 1] ? 1 : closes[i] < closes[i - 1] ? -1 : 0;
        }
        return out;
    },

    signedVolume(closes, volumes) {
        const signs = this.signSeries(closes);
        return volumes.map((v, i) => signs[i] * (v || 0));
    },

    obv(closes, volumes) {
        const signs = this.signSeries(closes);
        const out = new Array(closes.length).fill(0);
        let acc = 0;
        for (let i = 1; i < closes.length; i++) {
            acc += signs[i] * (volumes[i] || 0);
            out[i] = acc;
        }
        return out;
    },

    pvt(closes, volumes) {
        const out = new Array(closes.length).fill(0);
        let acc = 0;
        for (let i = 1; i < closes.length; i++) {
            const pc = closes[i - 1];
            if (pc > 0 && closes[i] != null) acc += (volumes[i] || 0) * (closes[i] - pc) / pc;
            out[i] = acc;
        }
        return out;
    },

    volumeOscillator(volumes, fast, slow) {
        const f = this.sma(volumes, fast);
        const s = this.sma(volumes, slow);
        return volumes.map((_, i) => (f[i] != null && s[i] != null && s[i] > 0) ? ((f[i] - s[i]) / s[i]) * 100 : null);
    },

    sliceStartForDays(dates, days, nowMs) {
        if (!dates || !dates.length) return 0;
        if (days == null) return 0;
        const now = (nowMs == null) ? Date.now() : nowMs;
        const cutoff = new Date(now - days * 864e5).toISOString().slice(0, 10);
        let idx = 0;
        while (idx < dates.length && dates[idx] < cutoff) idx++;
        return Math.min(idx, Math.max(0, dates.length - 2));
    },

    _sliceStart(dates, rangeKey) {
        const cfg = this._cfg();
        let days = null;
        const ranges = cfg.ranges || [];
        for (const r of ranges) {
            if (r.key === rangeKey) { days = r.days; break; }
        }
        return this.sliceStartForDays(dates, days);
    },

    _buildPayload(dates, closes, volumes, startIdx, extra) {
        const slice = arr => arr ? arr.slice(startIdx) : null;
        return {
            dates: dates.slice(startIdx),
            closes: closes.slice(startIdx),
            volumes: volumes.slice(startIdx),
            bars: slice(extra.bars),
            line: slice(extra.line),
            ma: slice(extra.ma),
            colorSigns: slice(extra.colorSigns),
            zeroCentered: !!extra.zeroCentered,
            study: extra.study,
            startIdx
        };
    },

    compute(history, study, rangeKey) {
        if (!history || !history.length) return null;
        const dates = [], closes = [], volumes = [];
        for (const b of history) {
            if (!b || b.close == null) continue;
            dates.push(b.date);
            closes.push(b.close);
            volumes.push(b.volume || 0);
        }
        if (dates.length < 2) return null;
        const cfg = this._cfg();
        const startIdx = this._sliceStart(dates, rangeKey);
        const fast = (cfg.oscillator || {}).fast || 5;
        const slow = (cfg.oscillator || {}).slow || 21;
        const maLen = cfg.ma || 21;

        if (study === 'vol') {
            const ma = this.sma(volumes, maLen);
            const signs = this.signSeries(closes);
            return this._buildPayload(dates, closes, volumes, startIdx, {
                bars: volumes, line: null, ma, colorSigns: signs, zeroCentered: false, study
            });
        }
        if (study === 'osc') {
            const line = this.volumeOscillator(volumes, fast, slow);
            return this._buildPayload(dates, closes, volumes, startIdx, {
                bars: null, line, ma: null, zeroCentered: true, study
            });
        }
        if (study === 'net') {
            const signed = this.signedVolume(closes, volumes);
            const line = this.rollingSum(signed, maLen);
            return this._buildPayload(dates, closes, volumes, startIdx, {
                bars: signed, line, ma: null, zeroCentered: true, study
            });
        }
        if (study === 'obv' || study === 'pvt') {
            const full = study === 'obv' ? this.obv(closes, volumes) : this.pvt(closes, volumes);
            const base = full[startIdx];
            const line = full.map(v => v - base);
            const maFull = this.sma(full, maLen);
            const ma = maFull.map(v => v == null ? null : v - base);
            return this._buildPayload(dates, closes, volumes, startIdx, {
                bars: null, line, ma, zeroCentered: false, study
            });
        }
        return null;
    },

    _getPayload(ticker, history) {
        const last = history.length ? (history[history.length - 1].date || '') : '';
        const key = `${ticker}|${this.state.study}|${this.state.range}|${history.length}|${last}`;
        if (this._cache && this._cache.key === key) return this._cache.payload;
        const payload = this.compute(history, this.state.study, this.state.range);
        this._cache = { key, payload };
        return payload;
    },

    render() {
        const panel = document.getElementById('vs-panel');
        if (!panel) return;
        this._bind();

        const all = (typeof App !== 'undefined' && App.allMetrics) ? App.allMetrics : {};
        const tickers = Object.keys(CONFIG.etfs);

        if (!all[this.state.ticker] || !(all[this.state.ticker] || {}).history) {
            const first = tickers.find(t => all[t] && all[t].history && all[t].history.length > 30);
            if (first) this.state.ticker = first;
        }
        this._updateChips();

        const metrics = all[this.state.ticker];
        const history = (metrics && metrics.history) || [];
        if (history.length < 3) {
            this._payload = null;
            this._drawMessage('Waiting for price-volume history…');
            this._updateReading(null, null);
            return;
        }

        const payload = this._getPayload(this.state.ticker, history);
        if (!payload || payload.dates.length < 2) {
            this._payload = null;
            this._drawMessage('Insufficient history for selected range');
            this._updateReading(null, null);
            return;
        }
        this._payload = payload;
        this._draw();
        this._updateReading(metrics, payload);
    },

    _bind() {
        if (this._bound) return;
        const studyTabs = document.getElementById('vs-study-tabs');
        const rangeTabs = document.getElementById('vs-range-tabs');
        const chips = document.getElementById('vs-chips');
        const canvas = document.getElementById('vs-canvas');
        if (!studyTabs || !rangeTabs || !chips || !canvas) return;

        studyTabs.addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (!btn) return;
            studyTabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.state.study = btn.getAttribute('data-study');
            this.state.hoverIdx = null;
            this.render();
        });

        rangeTabs.addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (!btn) return;
            rangeTabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.state.range = btn.getAttribute('data-range');
            this.state.hoverIdx = null;
            this.render();
        });

        canvas.addEventListener('mousemove', e => this._onMove(e));
        canvas.addEventListener('mouseleave', () => this._onLeave());

        this._bound = true;
    },

    _buildChips() {
        const container = document.getElementById('vs-chips');
        if (!container || this._chipsBuilt) return;
        container.innerHTML = '';
        for (const t of Object.keys(CONFIG.etfs)) {
            const side = (CONFIG.etfs[t] || {}).side || 'long';
            const color = side === 'long' ? this.COLORS.up : this.COLORS.down;
            const chip = document.createElement('button');
            chip.className = 'vs-chip';
            chip.textContent = t;
            chip.setAttribute('data-ticker', t);
            chip.style.color = color;
            chip.style.borderColor = color;
            chip.addEventListener('click', () => {
                this.state.ticker = t;
                this.state.hoverIdx = null;
                this._cache = null;
                this.render();
            });
            container.appendChild(chip);
        }
        this._chipsBuilt = true;
    },

    _updateChips() {
        this._buildChips();
        const container = document.getElementById('vs-chips');
        if (!container) return;
        container.querySelectorAll('.vs-chip').forEach(chip => {
            const active = chip.getAttribute('data-ticker') === this.state.ticker;
            chip.classList.toggle('active', active);
            chip.classList.toggle('inactive', !active);
        });
    },

    _drawMessage(text) {
        const canvas = document.getElementById('vs-canvas');
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
        ctx.fillStyle = this.COLORS.label;
        ctx.textAlign = 'center';
        ctx.fillText(text, rect.width / 2, rect.height / 2);
        const tooltip = document.getElementById('vs-tooltip');
        if (tooltip) tooltip.style.display = 'none';
    },

    _yFormat(study) {
        if (study === 'osc') return v => (v >= 0 ? '+' : '') + v.toFixed(0) + '%';
        return v => this.fmtVol(v);
    },

    _draw() {
        const payload = this._payload;
        const canvas = document.getElementById('vs-canvas');
        if (!payload || !canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 40) return;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const w = rect.width, h = rect.height;
        const pad = this.PAD;
        const chartW = w - pad.left - pad.right;
        const chartH = h - pad.top - pad.bottom;
        if (chartW < 10 || chartH < 10) return;

        const n = payload.dates.length;
        const bars = payload.bars, line = payload.line, ma = payload.ma;

        let yMin = Infinity, yMax = -Infinity;
        const consider = arr => {
            if (!arr) return;
            for (const v of arr) {
                if (v == null || !isFinite(v)) continue;
                if (v < yMin) yMin = v;
                if (v > yMax) yMax = v;
            }
        };
        consider(bars); consider(line); consider(ma);
        if (!isFinite(yMin) || !isFinite(yMax)) { this._drawMessage('No data in range'); return; }
        if (bars && !payload.zeroCentered) { yMin = Math.min(0, yMin); }
        if (payload.zeroCentered || (yMin < 0 && yMax > 0)) {
            yMin = Math.min(0, yMin); yMax = Math.max(0, yMax);
        }
        if (yMin === yMax) { yMin -= 1; yMax += 1; }
        const padY = (yMax - yMin) * 0.05;
        yMin -= padY; yMax += padY;
        if (bars && !payload.zeroCentered) yMin = Math.max(0, yMin);

        const getX = i => pad.left + (n <= 1 ? 0 : (i / (n - 1)) * chartW);
        const mapY = v => pad.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
        const clampY = v => Math.max(pad.top, Math.min(pad.top + chartH, v));

        ctx.font = '9px monospace';

        const yFmt = this._yFormat(payload.study);
        for (let i = 0; i <= 4; i++) {
            const v = yMax - (i / 4) * (yMax - yMin);
            const y = pad.top + (i / 4) * chartH;
            ctx.strokeStyle = this.COLORS.grid;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
            ctx.fillStyle = this.COLORS.label;
            ctx.textAlign = 'right';
            ctx.fillText(yFmt(v), pad.left - 6, y + 3);
        }

        ctx.fillStyle = this.COLORS.label;
        const xTicks = Math.min(5, n);
        for (let k = 0; k < xTicks; k++) {
            const i = Math.round((k / Math.max(1, xTicks - 1)) * (n - 1));
            ctx.textAlign = k === 0 ? 'left' : k === xTicks - 1 ? 'right' : 'center';
            ctx.fillText(this.fmtDate(payload.dates[i]), getX(i), pad.top + chartH + 14);
        }
        ctx.textAlign = 'left';

        if (yMin < 0 && yMax > 0) {
            const zy = mapY(0);
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(pad.left, zy); ctx.lineTo(pad.left + chartW, zy); ctx.stroke();
            ctx.setLineDash([]);
        }

        if (bars) {
            const colW = chartW / n;
            const barW = Math.max(1, colW * 0.7);
            const zeroY = (yMin < 0 && yMax > 0) ? mapY(0) : pad.top + chartH;
            const fillBar = (v, sign, x, w) => {
                const color = sign > 0 ? this.COLORS.up : sign < 0 ? this.COLORS.down : this.COLORS.flat;
                const yv = clampY(mapY(v));
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.75;
                ctx.fillRect(x, Math.min(yv, zeroY), w, Math.max(1, Math.abs(zeroY - yv)));
                ctx.globalAlpha = 1;
            };
            if (colW < 1) {
                // Dense ranges: one column per pixel — averaged daily value, net up/down colour
                const per = Math.ceil(n / Math.max(1, Math.floor(chartW)));
                const nCols = Math.ceil(n / per);
                const colStep = chartW / nCols;
                const w = Math.max(1, colStep * 0.7);
                for (let c = 0; c < nCols; c++) {
                    let sum = 0, cnt = 0, dir = 0;
                    const i0 = c * per, i1 = Math.min(n, i0 + per);
                    for (let i = i0; i < i1; i++) {
                        const v = bars[i];
                        if (v == null || !isFinite(v)) continue;
                        sum += v;
                        cnt++;
                        dir += payload.colorSigns ? payload.colorSigns[i] : (v > 0 ? 1 : v < 0 ? -1 : 0);
                    }
                    if (!cnt) continue;
                    fillBar(sum / cnt, dir > 0 ? 1 : dir < 0 ? -1 : 0, pad.left + c * colStep + (colStep - w) / 2, w);
                }
            } else {
                for (let i = 0; i < n; i++) {
                    const v = bars[i];
                    if (v == null || !isFinite(v)) continue;
                    const sign = payload.colorSigns ? payload.colorSigns[i] : (v > 0 ? 1 : v < 0 ? -1 : 0);
                    fillBar(v, sign, pad.left + i * colW + (colW - barW) / 2, barW);
                }
            }
        }

        const drawPath = (arr, color, width, dash) => {
            if (!arr) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            if (dash) ctx.setLineDash(dash);
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < n; i++) {
                const v = arr[i];
                if (v == null || !isFinite(v)) { started = false; continue; }
                const x = getX(i), y = clampY(mapY(v));
                if (!started) { ctx.moveTo(x, y); started = true; }
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            if (dash) ctx.setLineDash([]);
        };

        if (line && payload.study === 'osc') {
            const colW = chartW / n;
            const zeroY = mapY(0);
            for (let i = 0; i < n; i++) {
                const v = line[i];
                if (v == null || !isFinite(v)) continue;
                ctx.fillStyle = v >= 0 ? 'rgba(61,184,122,0.12)' : 'rgba(192,64,64,0.12)';
                const x = pad.left + i * colW;
                const yv = clampY(mapY(v));
                ctx.fillRect(x, Math.min(yv, zeroY), colW, Math.abs(zeroY - yv));
            }
            drawPath(line, this.COLORS.line, 1.4, null);
        } else if (line) {
            drawPath(line, this.COLORS.line, 1.4, null);
        }

        if (ma) drawPath(ma, this.COLORS.ma, 1, [3, 3]);

        if (this.state.hoverIdx != null && this.state.hoverIdx >= 0 && this.state.hoverIdx < n) {
            const i = this.state.hoverIdx;
            const x = getX(i);
            ctx.strokeStyle = this.COLORS.crosshair;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + chartH); ctx.stroke();
            ctx.setLineDash([]);
            if (bars) {
                const colW = chartW / n;
                const barW = Math.max(1, colW * 0.7);
                const bx = pad.left + i * colW + (colW - barW) / 2;
                const v = bars[i];
                if (v != null && isFinite(v)) {
                    const yv = clampY(mapY(v));
                    const y0 = (yMin < 0 && yMax > 0) ? mapY(0) : pad.top + chartH;
                    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(bx - 0.5, Math.min(yv, y0) - 0.5, barW + 1, Math.max(1, Math.abs(y0 - yv)) + 1);
                }
            } else if (line) {
                const v = line[i];
                if (v != null && isFinite(v)) {
                    ctx.beginPath();
                    ctx.arc(x, clampY(mapY(v)), 3, 0, Math.PI * 2);
                    ctx.fillStyle = this.COLORS.line;
                    ctx.fill();
                }
            }
        }
    },

    _onMove(e) {
        if (!this._payload) return;
        const canvas = document.getElementById('vs-canvas');
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const pad = this.PAD;
        const chartW = rect.width - pad.left - pad.right;
        const n = this._payload.dates.length;
        if (chartW <= 0 || n < 2) return;
        let idx = Math.round(((x - pad.left) / chartW) * (n - 1));
        idx = Math.max(0, Math.min(n - 1, idx));
        this.state.hoverIdx = idx;
        this.state.lastMouse = { x, y };
        this._scheduleDraw();
        this._showTooltip(idx);
    },

    _onLeave() {
        this.state.hoverIdx = null;
        const tooltip = document.getElementById('vs-tooltip');
        if (tooltip) tooltip.style.display = 'none';
        this._scheduleDraw();
    },

    _scheduleDraw() {
        if (this._rafId) return;
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this._draw();
        });
    },

    _showTooltip(idx) {
        const tooltip = document.getElementById('vs-tooltip');
        const wrap = document.getElementById('vs-canvas-wrap');
        const payload = this._payload;
        if (!tooltip || !wrap || !payload) return;
        const i = idx;
        const date = payload.dates[i];
        const close = payload.closes[i];
        const volume = payload.volumes[i];
        const studyNames = { vol: 'VOLUME', osc: 'VOL OSC', net: 'NET VOL', obv: 'OBV', pvt: 'PVT' };
        let value = null, valueLabel = studyNames[payload.study] || payload.study;
        if (payload.bars) value = payload.bars[i];
        else if (payload.line) value = payload.line[i];
        const dirSign = payload.colorSigns ? (payload.colorSigns[i] || 0) : (value > 0 ? 1 : value < 0 ? -1 : 0);
        const dirColor = (payload.study === 'vol' || payload.study === 'net') && value != null
            ? ' style="color:' + (dirSign > 0 ? this.COLORS.up : dirSign < 0 ? this.COLORS.down : this.COLORS.label) + '"'
            : '';
        let valueStr;
        if (payload.study === 'osc') {
            valueStr = value == null ? 'n/a' : (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
        } else if (payload.study === 'vol') {
            valueStr = value == null ? 'n/a' : this.fmtVol(value);
        } else {
            valueStr = value == null ? 'n/a' : this.fmtSigned(value);
        }
        let netRow = '';
        if (payload.study === 'net' && payload.line) {
            const r = payload.line[i];
            netRow = `<div class="vs-tt-row"><span class="vs-tt-lbl">NET 21D</span><span class="vs-tt-val">${r == null ? 'n/a' : this.fmtSigned(r)}</span></div>`;
        }
        const studyRow = payload.study === 'vol'
            ? ''
            : `<div class="vs-tt-row"><span class="vs-tt-lbl">${valueLabel}</span><span class="vs-tt-val"${dirColor}>${valueStr}</span></div>`;
        const volRow = payload.study === 'vol'
            ? `<div class="vs-tt-row"><span class="vs-tt-lbl">VOLUME</span><span class="vs-tt-val"${dirColor}>${valueStr}</span></div>`
            : payload.study === 'net'
                ? ''
                : `<div class="vs-tt-row"><span class="vs-tt-lbl">VOLUME</span><span class="vs-tt-val">${volume == null ? 'n/a' : this.fmtVol(volume)}</span></div>`;
        tooltip.innerHTML = `
            <div class="vs-tt-date">${date || 'n/a'}</div>
            ${studyRow}
            ${netRow}
            <div class="vs-tt-row"><span class="vs-tt-lbl">CLOSE</span><span class="vs-tt-val">$${this.fmtPrice(close)}</span></div>
            ${volRow}
        `;
        const w = wrap.clientWidth, h = wrap.clientHeight;
        tooltip.style.display = 'block';
        const m = this.state.lastMouse;
        const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
        let left = m.x + 14;
        if (left + tw > w - 4) left = m.x - tw - 14;
        left = Math.max(4, left);
        let top = m.y + 12;
        if (top + th > h - 4) top = h - th - 4;
        top = Math.max(4, top);
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    },

    _updateReading(metrics, payload) {
        const el = document.getElementById('vs-reading');
        if (!el) return;
        if (!metrics || !payload) {
            el.innerHTML = '<span class="vs-reading-na">No data</span>';
            return;
        }
        const study = this.state.study;
        const last = payload.dates.length - 1;
        const parts = [];
        if (study === 'vol') {
            const rvol = (metrics.rvol || {})['21d'];
            const z = (metrics.zScore || {})['21d'];
            parts.push(`<span class="vs-lbl">RVOL-21</span> ${rvol != null ? rvol.toFixed(2) + '×' : 'n/a'}`);
            parts.push(`<span class="vs-lbl">Z-SCORE</span> ${z != null ? (z >= 0 ? '+' : '') + z.toFixed(2) : 'n/a'}`);
            parts.push(`<span class="vs-lbl">LAST BAR</span> ${payload.volumes[last] != null ? this.fmtVol(payload.volumes[last]) : 'n/a'}`);
        } else if (study === 'osc') {
            const v = payload.line ? payload.line[last] : null;
            parts.push(`<span class="vs-lbl">CURRENT</span> ${v != null ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : 'n/a'}`);
            parts.push(`<span class="vs-lbl">STATE</span> ${v == null ? 'n/a' : v > 0 ? 'EXPANSION' : v < 0 ? 'CONTRACTION' : 'NEUTRAL'}`);
        } else if (study === 'net') {
            const r = payload.line ? payload.line[last] : null;
            parts.push(`<span class="vs-lbl">NET 21D</span> ${r != null ? this.fmtSigned(r) : 'n/a'}`);
            const day = payload.bars ? payload.bars[last] : null;
            parts.push(`<span class="vs-lbl">TODAY</span> ${day != null ? this.fmtSigned(day) : 'n/a'}`);
        } else if (study === 'obv' || study === 'pvt') {
            const line = payload.line || [];
            const ma = payload.ma || [];
            const lv = line[last], mv = ma[last];
            const lab = study === 'obv' ? 'OBV' : 'PVT';
            parts.push(`<span class="vs-lbl">${lab} VS 21D MA</span> ${lv != null && mv != null ? (lv >= mv ? 'ABOVE' : 'BELOW') : 'n/a'}`);
            const back = Math.max(0, last - 21);
            const delta = (lv != null && line[back] != null) ? lv - line[back] : null;
            parts.push(`<span class="vs-lbl">21D Δ</span> ${delta != null ? this.fmtSigned(delta) : 'n/a'}`);
            parts.push(`<span class="vs-lbl">BIAS</span> ${delta == null ? 'n/a' : delta > 0 ? 'ACCUMULATION' : delta < 0 ? 'DISTRIBUTION' : 'FLAT'}`);
        }
        el.innerHTML = parts.join('');
    }
};
