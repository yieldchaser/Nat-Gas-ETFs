/* ============================================
   Price-Volume Studies — classic volume indicators
   Volume, Volume Oscillator, Net Volume, OBV, PVT
   ============================================ */

const VolumeStudies = {
    state: {
        ticker: 'BOIL',
        study: 'vol',
        range: '1y',
        customRange: null,    // { startIdx, endIdx }
        hoverIdx: null,
        lastMouse: { x: 0, y: 0 }
    },
    _bound: false,
    _sliderBound: false,
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

    fmtVol(v, unit) {
        if (v == null || !isFinite(v)) return '--';
        const prefix = unit === 'dollar' ? '$' : '';
        const a = Math.abs(v);
        const sign = v < 0 ? '-' : '';
        if (a >= 1e12) return `${sign}${prefix}${(a / 1e12).toFixed(2)}T`;
        if (a >= 1e9) return `${sign}${prefix}${(a / 1e9).toFixed(2)}B`;
        if (a >= 1e6) return `${sign}${prefix}${(a / 1e6).toFixed(2)}M`;
        if (a >= 1e3) return `${sign}${prefix}${(a / 1e3).toFixed(0)}K`;
        return `${sign}${prefix}${a.toFixed(0)}`;
    },

    fmtSigned(v, unit) {
        if (v == null || !isFinite(v)) return '--';
        const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
        const prefix = unit === 'dollar' ? '$' : '';
        const a = Math.abs(v);
        if (a >= 1e12) return `${sign}${prefix}${(a / 1e12).toFixed(2)}T`;
        if (a >= 1e9) return `${sign}${prefix}${(a / 1e9).toFixed(2)}B`;
        if (a >= 1e6) return `${sign}${prefix}${(a / 1e6).toFixed(2)}M`;
        if (a >= 1e3) return `${sign}${prefix}${(a / 1e3).toFixed(0)}K`;
        return `${sign}${prefix}${a.toFixed(0)}`;
    },

    fmtPrice(p) {
        if (p == null || !isFinite(p)) return '--';
        const a = Math.abs(p);
        if (a >= 1e9) return (p / 1e9).toFixed(2) + 'B';
        if (a >= 1e6) return (p / 1e6).toFixed(1) + 'M';
        if (a >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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

    fmtFullDate(d) {
        if (!d) return '--';
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dt = new Date(d + 'T00:00:00');
        const dayName = isNaN(dt.getDay()) ? '' : days[dt.getDay()];
        return `${d} (${dayName})`;
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
        return volumes.map((_, i) => {
            if (f[i] == null || s[i] == null) return null;
            if (s[i] === 0) return f[i] === 0 ? 0 : 100;
            return ((f[i] - s[i]) / s[i]) * 100;
        });
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

    _buildPayload(dates, closes, volumes, startIdx, endIdx, extra) {
        let actualEnd = endIdx;
        let actualExtra = extra;
        if (typeof endIdx === 'object' && endIdx !== null && extra === undefined) {
            actualExtra = endIdx;
            actualEnd = dates.length - 1;
        }
        const end = (actualEnd != null) ? actualEnd : dates.length - 1;
        const slice = arr => arr ? arr.slice(startIdx, end + 1) : null;
        return {
            dates: dates.slice(startIdx, end + 1),
            closes: closes.slice(startIdx, end + 1),
            volumes: volumes.slice(startIdx, end + 1),
            rawVolumes: ((actualExtra && actualExtra.rawVolumes) || volumes).slice(startIdx, end + 1),
            dollarVolumes: ((actualExtra && actualExtra.dollarVolumes) || []).slice(startIdx, end + 1),
            bars: slice(actualExtra && actualExtra.bars),
            line: slice(actualExtra && actualExtra.line),
            ma: slice(actualExtra && actualExtra.ma),
            colorSigns: slice(actualExtra && actualExtra.colorSigns),
            zeroCentered: !!(actualExtra && actualExtra.zeroCentered),
            study: actualExtra ? actualExtra.study : null,
            unit: (actualExtra && actualExtra.unit) || 'shares',
            startIdx,
            endIdx: end,
            fullLength: dates.length
        };
    },

    compute(history, study, rangeKey, opts) {
        if (!history || !history.length) return null;
        const options = opts || {};
        const unit = options.unit || this.state.unit || 'shares';
        const dates = [], closes = [], rawVolumes = [], dollarVolumes = [];
        for (const b of history) {
            if (!b || b.close == null) continue;
            const c = b.close;
            const v = b.volume || 0;
            dates.push(b.date);
            closes.push(c);
            rawVolumes.push(v);
            dollarVolumes.push(c * v);
        }
        if (dates.length < 2) return null;

        const volumes = (unit === 'dollar') ? dollarVolumes : rawVolumes;

        let startIdx = 0;
        let endIdx = dates.length - 1;
        if (options.customStart != null && options.customEnd != null) {
            startIdx = Math.max(0, Math.min(dates.length - 2, options.customStart));
            endIdx = Math.max(startIdx + 1, Math.min(dates.length - 1, options.customEnd));
        } else if (rangeKey === 'custom' && this.state.customRange) {
            startIdx = Math.max(0, Math.min(dates.length - 2, this.state.customRange.startIdx));
            endIdx = Math.max(startIdx + 1, Math.min(dates.length - 1, this.state.customRange.endIdx));
        } else {
            startIdx = this._sliceStart(dates, rangeKey);
            endIdx = dates.length - 1;
        }

        const cfg = this._cfg();
        const fast = (cfg.oscillator || {}).fast || 5;
        const slow = (cfg.oscillator || {}).slow || 21;
        const maLen = cfg.ma || 21;

        const extraBase = {
            unit,
            rawVolumes,
            dollarVolumes
        };

        if (study === 'vol') {
            const ma = this.sma(volumes, maLen);
            const signs = this.signSeries(closes);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase, bars: volumes, line: null, ma, colorSigns: signs, zeroCentered: false, study
            });
        }
        if (study === 'osc') {
            const line = this.volumeOscillator(volumes, fast, slow);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase, bars: null, line, ma: null, zeroCentered: true, study
            });
        }
        if (study === 'net') {
            const signed = this.signedVolume(closes, volumes);
            const line = this.rollingSum(signed, maLen);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase, bars: signed, line, ma: null, zeroCentered: true, study
            });
        }
        if (study === 'obv' || study === 'pvt') {
            const full = study === 'obv' ? this.obv(closes, volumes) : this.pvt(closes, volumes);
            const base = full[startIdx];
            const line = full.map(v => v - base);
            const maFull = this.sma(full, maLen);
            const ma = maFull.map(v => v == null ? null : v - base);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase, bars: null, line, ma, zeroCentered: false, study
            });
        }
        return null;
    },

    _getPayload(ticker, history) {
        const last = history.length ? (history[history.length - 1].date || '') : '';
        const customPart = this.state.customRange ? `${this.state.customRange.startIdx}-${this.state.customRange.endIdx}` : '';
        const key = `${ticker}|${this.state.study}|${this.state.unit}|${this.state.range}|${customPart}|${history.length}|${last}`;
        if (this._cache && this._cache.key === key) return this._cache.payload;
        const payload = this.compute(history, this.state.study, this.state.range, {
            unit: this.state.unit,
            customStart: this.state.customRange ? this.state.customRange.startIdx : null,
            customEnd: this.state.customRange ? this.state.customRange.endIdx : null
        });
        this._cache = { key, payload };
        return payload;
    },

    render() {
        const panel = document.getElementById('vs-panel');
        if (!panel) return;
        this._bind();

        const all = (typeof App !== 'undefined' && App.allMetrics) ? App.allMetrics : {};
        const tickers = (typeof CONFIG !== 'undefined' && CONFIG.etfs) ? Object.keys(CONFIG.etfs) : [];

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
        this._syncSliderToRange(payload.fullLength, payload.startIdx, payload.endIdx);
        const rangeTabs = document.getElementById('vs-range-tabs');
        if (rangeTabs && this.state.range !== 'custom') {
            rangeTabs.querySelectorAll('button').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-range') === this.state.range);
            });
        }
        this._draw();
        this._updateReading(metrics, payload, null);
    },

    _bind() {
        if (this._bound) return;
        const studyTabs = document.getElementById('vs-study-tabs');
        const unitTabs = document.getElementById('vs-unit-tabs');
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
            this._cache = null;
            this.render();
        });



        rangeTabs.addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (!btn) return;
            rangeTabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.state.range = btn.getAttribute('data-range');
            this.state.customRange = null;
            this.state.hoverIdx = null;
            this._cache = null;
            this.render();
        });

        canvas.addEventListener('mousemove', e => this._onMove(e));
        canvas.addEventListener('mouseleave', () => this._onLeave());

        this._initSlider();
        this._bound = true;
    },

    _initSlider() {
        const sStart = document.getElementById('vs-range-start');
        const sEnd = document.getElementById('vs-range-end');
        if (!sStart || !sEnd || this._sliderBound) return;

        const MIN_GAP = 5;

        const onChange = (e) => {
            const payload = this._payload;
            if (!payload || !payload.fullLength) return;
            const maxVal = payload.fullLength - 1;
            let v1 = parseInt(sStart.value, 10);
            let v2 = parseInt(sEnd.value, 10);

            if (e.target.id === 'vs-range-start') {
                if (v1 > v2 - MIN_GAP) {
                    v1 = Math.max(0, v2 - MIN_GAP);
                    sStart.value = v1;
                }
            } else {
                if (v2 < v1 + MIN_GAP) {
                    v2 = Math.min(maxVal, v1 + MIN_GAP);
                    sEnd.value = v2;
                }
            }

            if (v2 - v1 < 2) {
                if (v2 >= maxVal) {
                    v1 = Math.max(0, maxVal - MIN_GAP);
                    v2 = maxVal;
                } else {
                    v2 = Math.min(maxVal, v1 + MIN_GAP);
                }
                sStart.value = v1;
                sEnd.value = v2;
            }

            // Dynamic z-index
            if (v1 > maxVal - 60) {
                sStart.style.zIndex = '5';
                sEnd.style.zIndex = '4';
            } else {
                sStart.style.zIndex = '4';
                sEnd.style.zIndex = '3';
            }

            this.state.range = 'custom';
            this.state.customRange = { startIdx: v1, endIdx: v2 };
            this.state.hoverIdx = null;

            const rangeTabs = document.getElementById('vs-range-tabs');
            if (rangeTabs) {
                rangeTabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            }

            this._updateSliderHighlight(v1, v2, maxVal);
            this.render();
        };

        const elevateThumb = (e) => {
            if (e.target) e.target.style.zIndex = '6';
        };
        sStart.addEventListener('mousedown', elevateThumb);
        sStart.addEventListener('touchstart', elevateThumb);
        sEnd.addEventListener('mousedown', elevateThumb);
        sEnd.addEventListener('touchstart', elevateThumb);

        sStart.addEventListener('input', onChange);
        sEnd.addEventListener('input', onChange);
        this._sliderBound = true;
    },

    _syncSliderToRange(totalBars, startIdx, endIdx) {
        const sStart = document.getElementById('vs-range-start');
        const sEnd = document.getElementById('vs-range-end');
        if (!sStart || !sEnd || totalBars < 2) return;

        const maxVal = totalBars - 1;
        sStart.max = maxVal;
        sEnd.max = maxVal;
        sStart.value = startIdx;
        sEnd.value = endIdx;

        this._updateSliderHighlight(startIdx, endIdx, maxVal);
    },

    _updateSliderHighlight(v1, v2, maxVal) {
        const highlight = document.getElementById('vs-range-highlight');
        const lblActive = document.getElementById('vs-range-active-label');

        if (maxVal <= 0) return;
        const p1 = (v1 / maxVal);
        const p2 = (v2 / maxVal);

        if (highlight) {
            highlight.style.left = `calc(${p1 * 100}% + ${(10 - p1 * 20)}px)`;
            highlight.style.width = `calc(${(p2 - p1) * 100}% + ${((p1 - p2) * 20)}px)`;
        }

        if (lblActive) {
            lblActive.textContent = (this.state.range === 'custom')
                ? 'CUSTOM SELECTION'
                : `PRESET: ${this.state.range.toUpperCase()}`;
        }
    },

    _buildChips() {
        const container = document.getElementById('vs-chips');
        if (!container || this._chipsBuilt) return;
        container.innerHTML = '';
        const etfs = (typeof CONFIG !== 'undefined' && CONFIG.etfs) ? CONFIG.etfs : {};
        for (const t of Object.keys(etfs)) {
            const side = (etfs[t] || {}).side || 'long';
            const name = (etfs[t] || {}).name || t;
            const color = side === 'long' ? this.COLORS.up : this.COLORS.down;
            const chip = document.createElement('button');
            chip.className = 'vs-chip';
            chip.textContent = t;
            chip.setAttribute('data-ticker', t);
            chip.setAttribute('data-tooltip', `${t} (${name})`);
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

    _yFormat(study, unit) {
        if (study === 'osc') return v => (v >= 0 ? '+' : '') + v.toFixed(0) + '%';
        if (unit === 'dollar') return v => (v < 0 ? '-' : '') + '$' + this.fmtVol(Math.abs(v));
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

        const yFmt = this._yFormat(payload.study, payload.unit);
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
                const hBar = Math.max(1.5, Math.abs(zeroY - yv));
                ctx.fillRect(x, Math.min(yv, zeroY), w, hBar);
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
                    ctx.strokeRect(bx - 0.5, Math.min(yv, y0) - 0.5, barW + 1, Math.max(1.5, Math.abs(y0 - yv)) + 1);
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

        if (x < pad.left - 4 || x > rect.width - pad.right + 4) {
            this._onLeave();
            return;
        }

        let idx = Math.round(((x - pad.left) / chartW) * (n - 1));
        idx = Math.max(0, Math.min(n - 1, idx));
        this.state.hoverIdx = idx;
        this.state.lastMouse = { x, y };
        this._scheduleDraw();
        this._showTooltip(idx);

        const all = (typeof App !== 'undefined' && App.allMetrics) ? App.allMetrics : {};
        this._updateReading(all[this.state.ticker], this._payload, idx);
    },

    _onLeave() {
        this.state.hoverIdx = null;
        const tooltip = document.getElementById('vs-tooltip');
        if (tooltip) tooltip.style.display = 'none';
        this._scheduleDraw();

        const all = (typeof App !== 'undefined' && App.allMetrics) ? App.allMetrics : {};
        this._updateReading(all[this.state.ticker], this._payload, null);
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
        const prevClose = (i > 0) ? payload.closes[i - 1] : close;
        const priceChg = close - prevClose;
        const pricePct = prevClose > 0 ? (priceChg / prevClose) * 100 : 0;
        const priceChgColor = priceChg > 0 ? this.COLORS.up : priceChg < 0 ? this.COLORS.down : this.COLORS.flat;
        const priceChgSign = priceChg > 0 ? '+' : '';

        const rawVol = payload.rawVolumes ? payload.rawVolumes[i] : payload.volumes[i];
        const dollarVol = payload.dollarVolumes ? payload.dollarVolumes[i] : (close * rawVol);

        const studyNames = { vol: 'VOLUME', osc: 'VOL OSC', net: 'NET VOL', obv: 'OBV', pvt: 'PVT' };
        let value = null, valueLabel = studyNames[payload.study] || payload.study;
        if (payload.bars) value = payload.bars[i];
        else if (payload.line) value = payload.line[i];

        const dirSign = payload.colorSigns ? (payload.colorSigns[i] || 0) : (value > 0 ? 1 : value < 0 ? -1 : 0);
        const dirColor = ' style="color:' + (dirSign > 0 ? this.COLORS.up : dirSign < 0 ? this.COLORS.down : this.COLORS.flat) + '"';

        let studyValStr = 'n/a';
        let badgeText = '';
        let badgeColor = '';

        if (payload.study === 'osc') {
            studyValStr = value == null ? 'n/a' : (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
            if (value != null) {
                badgeText = value > 0 ? 'EXPANSION' : value < 0 ? 'CONTRACTION' : 'NEUTRAL';
                badgeColor = value > 0 ? this.COLORS.up : value < 0 ? this.COLORS.down : this.COLORS.label;
            }
        } else if (payload.study === 'vol') {
            studyValStr = value == null ? 'n/a' : (payload.unit === 'dollar' ? '$' + this.fmtVol(value) : this.fmtVol(value));
            badgeText = dirSign > 0 ? 'UP DAY' : dirSign < 0 ? 'DOWN DAY' : 'FLAT';
            badgeColor = dirSign > 0 ? this.COLORS.up : dirSign < 0 ? this.COLORS.down : this.COLORS.label;
        } else if (payload.study === 'net') {
            studyValStr = value == null ? 'n/a' : (payload.unit === 'dollar' ? (value > 0 ? '+$' : (value < 0 ? '-$' : '')) + this.fmtVol(Math.abs(value)) : this.fmtSigned(value));
            badgeText = value > 0 ? 'NET INFLOW' : value < 0 ? 'NET OUTFLOW' : 'FLAT';
            badgeColor = value > 0 ? this.COLORS.up : value < 0 ? this.COLORS.down : this.COLORS.label;
        } else {
            studyValStr = value == null ? 'n/a' : (payload.unit === 'dollar' ? (value > 0 ? '+$' : (value < 0 ? '-$' : '')) + this.fmtVol(Math.abs(value)) : this.fmtSigned(value));
            const maVal = payload.ma ? payload.ma[i] : null;
            if (value != null && maVal != null) {
                badgeText = value >= maVal ? 'ACCUMULATION' : 'DISTRIBUTION';
                badgeColor = value >= maVal ? this.COLORS.up : this.COLORS.down;
            }
        }

        let rowsHtml = '';

        rowsHtml += `
            <div class="vs-tt-row">
                <span class="vs-tt-lbl">CLOSE</span>
                <span class="vs-tt-val">$${this.fmtPrice(close)} <span style="color:${priceChgColor};font-size:0.58rem;">(${priceChgSign}${pricePct.toFixed(1)}%)</span></span>
            </div>
        `;

        rowsHtml += `
            <div class="vs-tt-row">
                <span class="vs-tt-lbl">${valueLabel}</span>
                <span class="vs-tt-val"${dirColor}>${studyValStr}</span>
            </div>
        `;

        if (payload.ma && payload.ma[i] != null) {
            const maVal = payload.ma[i];
            const maFmt = payload.study === 'vol'
                ? (payload.unit === 'dollar' ? '$' + this.fmtVol(maVal) : this.fmtVol(maVal))
                : (payload.unit === 'dollar' ? (maVal > 0 ? '+$' : (maVal < 0 ? '-$' : '')) + this.fmtVol(Math.abs(maVal)) : this.fmtSigned(maVal));
            rowsHtml += `
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">21D MA</span>
                    <span class="vs-tt-val" style="color:${this.COLORS.ma};">${maFmt}</span>
                </div>
            `;
            if (payload.study === 'vol' && maVal > 0 && value != null) {
                const rvol = value / maVal;
                const rColor = rvol >= 2.0 ? this.COLORS.up : rvol >= 1.2 ? 'var(--cyan)' : 'inherit';
                rowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">RVOL-21</span>
                        <span class="vs-tt-val" style="color:${rColor};">${rvol.toFixed(2)}×</span>
                    </div>
                `;
            }
        }

        if (payload.study === 'net' && payload.line && payload.line[i] != null) {
            const r = payload.line[i];
            const rFmt = payload.unit === 'dollar'
                ? (r > 0 ? '+$' : (r < 0 ? '-$' : '')) + this.fmtVol(Math.abs(r))
                : this.fmtSigned(r);
            rowsHtml += `
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">NET 21D</span>
                    <span class="vs-tt-val">${rFmt}</span>
                </div>
            `;
        }

        rowsHtml += `<div class="vs-tt-divider"></div>`;
        rowsHtml += `
            <div class="vs-tt-row">
                <span class="vs-tt-lbl">SHARES</span>
                <span class="vs-tt-val">${this.fmtVol(rawVol)}</span>
            </div>
            <div class="vs-tt-row">
                <span class="vs-tt-lbl">DOLLAR VOL</span>
                <span class="vs-tt-val">$${this.fmtVol(dollarVol)}</span>
            </div>
        `;

        const badgeHtml = badgeText ? `<span class="vs-tt-badge" style="background:${badgeColor}22;color:${badgeColor};border:1px solid ${badgeColor}44;">${badgeText}</span>` : '';

        tooltip.innerHTML = `
            <div class="vs-tt-header">
                <span class="vs-tt-date">${this.fmtFullDate(date)}</span>
                ${badgeHtml}
            </div>
            ${rowsHtml}
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

    _updateReading(metrics, payload, hoverIdx) {
        const el = document.getElementById('vs-reading');
        if (!el) return;
        if (!payload || !payload.dates.length) {
            el.innerHTML = '<span class="vs-reading-na">No data</span>';
            return;
        }

        const study = payload.study;
        const last = (hoverIdx != null && hoverIdx >= 0 && hoverIdx < payload.dates.length)
            ? hoverIdx
            : payload.dates.length - 1;

        const isHover = (hoverIdx != null && hoverIdx !== payload.dates.length - 1);
        const dateTag = isHover ? `<span class="vs-reading-item"><span class="vs-lbl">DATE</span> ${payload.dates[last]}</span>` : '';

        const close = payload.closes[last];
        const prev = last > 0 ? payload.closes[last - 1] : close;
        const pctChg = prev > 0 ? ((close - prev) / prev) * 100 : 0;
        const chgColor = pctChg > 0 ? this.COLORS.up : pctChg < 0 ? this.COLORS.down : this.COLORS.flat;
        const chgSign = pctChg > 0 ? '+' : '';
        const closeTag = `<span class="vs-reading-item"><span class="vs-lbl">CLOSE</span> $${this.fmtPrice(close)} <span style="color:${chgColor};font-size:0.68rem;font-weight:700;">(${chgSign}${pctChg.toFixed(1)}%)</span></span>`;

        const rawVol = payload.rawVolumes ? payload.rawVolumes[last] : payload.volumes[last];
        const dollarVol = payload.dollarVolumes ? payload.dollarVolumes[last] : (close * rawVol);

        const parts = [];
        if (dateTag) parts.push(dateTag);
        parts.push(closeTag);

        if (study === 'vol') {
            const ma = payload.ma ? payload.ma[last] : null;
            const rvol = (ma && ma > 0) ? (payload.bars[last] / ma) : ((metrics && metrics.rvol) ? metrics.rvol['21d'] : null);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">RVOL-21</span> ${rvol != null ? rvol.toFixed(2) + '×' : 'n/a'}</span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">VOL</span> ${this.fmtVol(rawVol)}</span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">VALUE</span> $${this.fmtVol(dollarVol)}</span>`);
        } else if (study === 'osc') {
            const v = payload.line ? payload.line[last] : null;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">OSC</span> ${v != null ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : 'n/a'}</span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">STATE</span> <span style="color:${v > 0 ? this.COLORS.up : v < 0 ? this.COLORS.down : 'inherit'}">${v == null ? 'n/a' : v > 0 ? 'EXPANSION' : v < 0 ? 'CONTRACTION' : 'NEUTRAL'}</span></span>`);
        } else if (study === 'net') {
            const r = payload.line ? payload.line[last] : null;
            const day = payload.bars ? payload.bars[last] : null;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">DAY</span> ${day != null ? this.fmtSigned(day) : 'n/a'}</span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">21D</span> ${r != null ? this.fmtSigned(r) : 'n/a'}</span>`);
        } else if (study === 'obv' || study === 'pvt') {
            const line = payload.line || [];
            const ma = payload.ma || [];
            const lv = line[last], mv = ma[last];
            const state = (lv != null && mv != null) ? (lv >= mv ? 'ABOVE' : 'BELOW') : 'n/a';
            const stateColor = state === 'ABOVE' ? this.COLORS.up : state === 'BELOW' ? this.COLORS.down : 'inherit';
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">MA</span> <span style="color:${stateColor}">${state}</span></span>`);
            const back = Math.max(0, last - 21);
            const delta = (lv != null && line[back] != null) ? lv - line[back] : null;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">21D Δ</span> ${delta != null ? this.fmtSigned(delta) : 'n/a'}</span>`);
            const bias = delta == null ? 'n/a' : delta > 0 ? 'ACCUMULATION' : delta < 0 ? 'DISTRIBUTION' : 'FLAT';
            const biasColor = bias === 'ACCUMULATION' ? this.COLORS.up : bias === 'DISTRIBUTION' ? this.COLORS.down : 'inherit';
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">BIAS</span> <span style="color:${biasColor}">${bias}</span></span>`);
        }
        el.innerHTML = parts.join('');
    }
};
