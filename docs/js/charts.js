/* ============================================
   Lightweight Canvas Charts
   No external dependencies
   ============================================ */

const Charts = {

    /* SPARKLINE (Price) */
    drawSparkline(canvas, data, color = '#4a80b8', fillAlpha = 0.1, hoverIndex = null) {
        if (!data || data.length < 2) return;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.parentElement ? canvas.parentElement.clientWidth : (canvas.clientWidth || 200);
        const h = canvas.parentElement ? (canvas.parentElement.clientHeight || 50) : (canvas.clientHeight || 50);
        if (w <= 0 || h <= 0) return;

        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const closes = data.map(d => d.close);
        const min = Math.min(...closes);
        const max = Math.max(...closes);
        const range = max - min || 1;
        const padding = 3;

        const xStep = (w - padding * 2) / (closes.length - 1);
        const yScale = (h - padding * 2) / range;

        // Fill
        ctx.beginPath();
        ctx.moveTo(padding, h - padding);
        for (let i = 0; i < closes.length; i++) {
            const x = padding + i * xStep;
            const y = h - padding - (closes[i] - min) * yScale;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(padding + (closes.length - 1) * xStep, h - padding);
        ctx.closePath();
        // Support both hex (#rrggbb) and rgb() color formats
        if (color.startsWith('#')) {
            const r = parseInt(color.slice(1,3), 16);
            const g = parseInt(color.slice(3,5), 16);
            const b = parseInt(color.slice(5,7), 16);
            ctx.fillStyle = `rgba(${r},${g},${b},${fillAlpha})`;
        } else {
            ctx.fillStyle = color.replace(')', `, ${fillAlpha})`).replace('rgb', 'rgba');
        }
        ctx.fill();

        // Line
        ctx.beginPath();
        for (let i = 0; i < closes.length; i++) {
            const x = padding + i * xStep;
            const y = h - padding - (closes[i] - min) * yScale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Crosshair & Highlight dot when hovering
        if (hoverIndex != null && hoverIndex >= 0 && hoverIndex < closes.length) {
            const hx = padding + hoverIndex * xStep;
            const hy = h - padding - (closes[hoverIndex] - min) * yScale;

            // Dashed vertical crosshair
            ctx.save();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(hx, 0);
            ctx.lineTo(hx, h);
            ctx.stroke();
            ctx.restore();

            // Highlight dot
            ctx.beginPath();
            ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        } else {
            // Default current price dot on last point
            const lastX = padding + (closes.length - 1) * xStep;
            const lastY = h - padding - (closes[closes.length - 1] - min) * yScale;
            ctx.beginPath();
            ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        }
    },

    /* VOLUME BARS */
    drawVolumeBars(canvas, data, percentiles = null, hoverIndex = null, mode = 'share') {
        if (!data || data.length < 2) return;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.parentElement ? canvas.parentElement.clientWidth : (canvas.clientWidth || 200);
        const h = canvas.parentElement ? (canvas.parentElement.clientHeight || 24) : (canvas.clientHeight || 24);
        if (w <= 0 || h <= 0) return;

        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const volumes = data.map(d => {
            if (mode === 'dollar') {
                return (d.dollarVolume != null) ? d.dollarVolume : ((d.close || 0) * (d.volume || 0));
            }
            return d.volume != null ? d.volume : 0;
        });
        const max = Math.max(...volumes) || 1;
        const validVols = volumes.filter(v => v > 0);
        const mean = validVols.length ? (validVols.reduce((a, b) => a + b, 0) / validVols.length) : max;
        // Anchor color scale to at least 2.2x of the 30d mean so quiet windows without a spike
        // do not falsely color a normal 1.2x bar as an extreme purple climax (#8855bb).
        const colorMax = Math.max(max, mean * 2.2) || 1;
        const barW = Math.max(1, (w / volumes.length) - 1);

        for (let i = 0; i < volumes.length; i++) {
            const x = i * (w / volumes.length);
            const barH = Math.max(2, (volumes[i] / max) * h);

            // Color by regime-anchored magnitude
            const ratio = volumes[i] / colorMax;
            let color;
            if (ratio > 0.9) color = '#8855bb';
            else if (ratio > 0.75) color = '#c04040';
            else if (ratio > 0.5) color = '#c07828';
            else if (ratio > 0.3) color = '#385e88';
            else if (ratio > 0.15) color = '#1e2438';
            else color = '#121422';

            const isHovered = (hoverIndex != null && i === hoverIndex);

            ctx.save();
            if (hoverIndex != null) {
                // Dim non-hovered bars slightly to spotlight the hovered day
                ctx.globalAlpha = isHovered ? 1.0 : 0.40;
            }

            ctx.fillStyle = color;
            ctx.fillRect(x, h - barH, barW, barH);

            if (isHovered) {
                // White accent stroke on hovered bar
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.strokeRect(x, h - barH, barW, barH);

                // Dashed vertical crosshair continuation
                ctx.setLineDash([2, 2]);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
                ctx.beginPath();
                ctx.moveTo(x + barW / 2, 0);
                ctx.lineTo(x + barW / 2, h);
                ctx.stroke();
            }
            ctx.restore();
        }
    },

    evaluateViewportSpotlight(visibleSlice, mode, activeFilter) {
        const N = visibleSlice.length;
        if (N === 0) return [];

        const k99 = Math.max(1, Math.round(0.01 * N));
        const k95 = Math.max(k99 + 1, Math.round(0.05 * N));
        const k90 = Math.max(k95 + 1, Math.round(0.10 * N));

        const sortedIndices = Array.from({ length: N }, (_, i) => i);
        sortedIndices.sort((a, b) => {
            const keyA = mode === 'PEAKS' ? visibleSlice[a].compositeTieKeyPeak : visibleSlice[a].compositeTieKeyValley;
            const keyB = mode === 'PEAKS' ? visibleSlice[b].compositeTieKeyPeak : visibleSlice[b].compositeTieKeyValley;
            return keyB - keyA;
        });

        const ranks = new Int32Array(N);
        const baselineBins = new Uint8Array(N);
        for (let rankZero = 0; rankZero < N; rankZero++) {
            const origIdx = sortedIndices[rankZero];
            ranks[origIdx] = rankZero + 1;
            baselineBins[origIdx] = Math.min(4, Math.floor(((N - 1 - rankZero) / N) * 5));
        }

        const STRUCTURAL_FLOORS = {
            PEAKS: { P99: 68.0, P95: 52.0, P90: 38.0 },
            VALLEYS: { P99: 64.0, P95: 48.0, P90: 34.0 }
        };
        const floors = STRUCTURAL_FLOORS[mode] || STRUCTURAL_FLOORS.PEAKS;
        const output = new Array(N);

        for (let i = 0; i < N; i++) {
            const rec = visibleSlice[i];
            const score = mode === 'PEAKS' ? rec.peakScore : rec.valleyScore;
            const r = ranks[i];

            let visualTier = 'NONE';
            let isStructuralClimax = false;

            if (r <= k99) {
                visualTier = 'RED_P99';
                isStructuralClimax = score >= floors.P99;
            } else if (r <= k95) {
                visualTier = 'ORANGE_P95';
                isStructuralClimax = score >= floors.P95;
            } else if (r <= k90) {
                visualTier = 'AMBER_P90';
                isStructuralClimax = score >= floors.P90;
            }

            let isHighlighted = true;
            if (activeFilter === 'P99') {
                isHighlighted = r <= k99;
            } else if (activeFilter === 'P95') {
                isHighlighted = r <= k95;
            } else if (activeFilter === 'P90') {
                isHighlighted = r <= k90;
            }

            output[i] = {
                date: rec.date,
                score,
                maxRvol: rec.maxRvol,
                windowRank: r,
                visualTier,
                isHighlighted,
                isStructuralClimax,
                baselineQuantileBin: baselineBins[i]
            };
        }

        return output;
    },

    _escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    formatHeatPrice(price, ticker) {
        if (price == null || !Number.isFinite(Number(price))) return null;
        const p = Number(price);
        const prefix = (ticker && ticker.endsWith('.TO')) ? 'CA$' : '$';
        let formatted;
        if (p >= 10000) formatted = p.toFixed(0);
        else if (p >= 1) formatted = p.toFixed(2);
        else formatted = p.toFixed(4);
        return prefix + formatted;
    },

    getDdSeverity(dd63Pct) {
        if (dd63Pct == null || !Number.isFinite(dd63Pct)) {
            return { cls: 'dd-unknown', label: 'N/A', fillPct: 0 };
        }
        const mag = Math.max(0, -dd63Pct);
        if (mag < 10.0) {
            return { cls: 'dd-near-high', label: 'NEAR HIGH', fillPct: 0 };
        }
        if (mag < 25.0) {
            const pct = Math.round(25 + ((mag - 10.0) / 15.0) * 30);
            return { cls: 'dd-pullback', label: 'PULLBACK', fillPct: pct };
        }
        if (mag < 40.0) {
            const pct = Math.round(55 + ((mag - 25.0) / 15.0) * 30);
            return { cls: 'dd-deep', label: 'DEEP DD', fillPct: pct };
        }
        const pct = Math.min(100, Math.round(85 + ((mag - 40.0) / 25.0) * 15));
        return { cls: 'dd-bloodbath', label: 'BLOODBATH', fillPct: pct };
    },

    _ensureHeatTooltip() {
        if (typeof document === 'undefined' || !document.body) return null;
        let el = document.getElementById('heat-tooltip');
        if (!el) {
            el = document.createElement('div');
            el.id = 'heat-tooltip';
            el.className = 'heat-tooltip';
            el.setAttribute('role', 'tooltip');
            el.setAttribute('aria-hidden', 'true');
            document.body.appendChild(el);
        }
        return el;
    },

    hideHeatTooltip() {
        if (typeof document === 'undefined' || !document.body) return;
        const el = document.getElementById('heat-tooltip');
        if (el) {
            el.classList.remove('visible');
            el.setAttribute('aria-hidden', 'true');
            el.style.display = 'none';
        }
        this._activeHeatCell = null;
    },

    showHeatTooltip(cell) {
        if (!cell || !cell._heatMeta || typeof document === 'undefined' || !document.body) return;
        const el = this._ensureHeatTooltip();
        if (!el) return;

        const m = cell._heatMeta;
        this._activeHeatCell = cell;

        const leadLabel = m.leadTicker
            ? (m.isBasket ? ('Lead ' + this._escapeHtml(m.leadTicker)) : this._escapeHtml(m.leadTicker))
            : '';

        let chgHtml = '';
        if (m.chg1dPct != null && Number.isFinite(m.chg1dPct)) {
            const dispChg = (m.chg1dPct > -0.05 && m.chg1dPct < 0.05) ? 0.0 : m.chg1dPct;
            const sign = dispChg > 0 ? '+' : '';
            const chgCls = dispChg > 0.05 ? 'pos' : (dispChg < -0.05 ? 'neg' : 'flat');
            chgHtml = '<span class="hm-tt-chg ' + chgCls + '">' + sign + dispChg.toFixed(1) + '%</span>';
        }

        let priceRowHtml = '';
        if (leadLabel || m.priceStr || chgHtml) {
            priceRowHtml = '<div class="hm-tt-price-row">' +
                (leadLabel ? '<span class="hm-tt-asset">' + leadLabel + '</span>' : '') +
                (m.priceStr ? '<span class="hm-tt-price">' + this._escapeHtml(m.priceStr) + '</span>' : '') +
                chgHtml +
                '</div>';
        }

        const pctTop = m.totalN > 0 ? Math.max(1, Math.round((m.windowRank / m.totalN) * 100)) : 100;
        const fmtDd = v => (v > -0.05 && v <= 0) ? '0.0%' : (v.toFixed(1) + '%');
        let ddRowHtml = '';
        if (m.dd63Pct != null && Number.isFinite(m.dd63Pct)) {
            const dd252Part = (m.dd252Pct != null && Number.isFinite(m.dd252Pct))
                ? ' &middot; DD252 ' + fmtDd(m.dd252Pct)
                : '';
            ddRowHtml = '<div class="hm-tt-dd ' + m.ddTierCls + (m.ddOverlay ? ' overlay-active' : '') + '">' +
                '<span class="hm-tt-dd-vals">DD63 ' + fmtDd(m.dd63Pct) + dd252Part + '</span>' +
                '<span class="hm-tt-dd-pill ' + m.ddTierCls + '">' + this._escapeHtml(m.ddSeverityLabel) + '</span>' +
                '</div>';
        }

        let tagHtml = '';
        if (m.isSpotlight) {
            const basketSuffix = (m.isBasket && m.activeCount > 1) ? (' &middot; ' + m.activeCount + ' ETFs') : '';
            if (m.isHighlighted) {
                const regimeCls = m.isValleys ? 'is-valley' : 'is-peak';
                tagHtml = '<div class="hm-tt-tag ' + regimeCls + '">' +
                    this._escapeHtml(m.filterTag) + ' &middot; ' + this._escapeHtml(m.climaxTag) + basketSuffix +
                    '</div>';
            } else {
                const tierNote = (m.filterTag && m.filterTag !== 'BASE') ? (' &middot; Tier ' + this._escapeHtml(m.filterTag)) : '';
                tagHtml = '<div class="hm-tt-tag is-dim">DIMMED &middot; Below P' + m.peaksThreshold + ' cutoff' + tierNote + basketSuffix + '</div>';
            }
        } else if (m.isBasket && m.activeCount > 1) {
            tagHtml = '<div class="hm-tt-tag">Basket: ' + m.activeCount + ' ETFs &middot; ' + this._escapeHtml(m.modeWord) + '</div>';
        }

        el.innerHTML = priceRowHtml +
            '<div class="hm-tt-date">' + this._escapeHtml(m.dateFormatted) + '</div>' +
            '<div class="hm-tt-rank">Rank #' + m.windowRank + ' / ' + m.totalN + ' &middot; Top ' + pctTop + '%</div>' +
            '<div class="hm-tt-main"><span class="hm-tt-lbl">' + this._escapeHtml(m.metricLabel) + ':</span> <strong>' + m.scoreStr + '</strong> &middot; <span class="hm-tt-rvol">RVOL ' + m.rvolStr + '</span></div>' +
            ddRowHtml +
            tagHtml;

        el.style.visibility = 'hidden';
        el.style.display = 'flex';

        const rect = cell.getBoundingClientRect();
        const panelEl = typeof cell.closest === 'function'
            ? (cell.closest('#heat-calendar-panel') || cell.closest('.heat-calendar'))
            : null;
        const panelRect = panelEl && typeof panelEl.getBoundingClientRect === 'function'
            ? panelEl.getBoundingClientRect()
            : null;
        const tw = el.offsetWidth || 216;
        const th = el.offsetHeight || 88;
        const pad = 8;
        const GAP = 8;
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

        const minLeft = panelRect ? Math.max(pad, panelRect.left + 6) : pad;
        const maxRight = panelRect ? Math.min(vw - pad, panelRect.right - 6) : (vw - pad);
        const maxLeft = Math.max(minLeft, maxRight - tw);

        let left = rect.left + rect.width / 2 - tw / 2;
        left = Math.max(minLeft, Math.min(maxLeft, left));

        const topMin = panelRect ? Math.max(62, panelRect.top + 4) : 62;
        let top = rect.top - th - GAP;
        if (top < topMin) {
            top = rect.bottom + GAP;
        }
        top = Math.max(pad, Math.min(vh - th - pad, top));

        el.style.left = Math.round(left) + 'px';
        el.style.top = Math.round(top) + 'px';
        el.style.visibility = 'visible';
        el.classList.add('visible');
        el.setAttribute('aria-hidden', 'false');
    },

    _bindHeatTooltipEvents(container) {
        if (typeof document === 'undefined' || !document.body || !container || typeof container.addEventListener !== 'function') {
            return;
        }
        if (!container._heatTtBound) {
            container.addEventListener('mouseover', (e) => {
                const target = e.target;
                const cell = target && typeof target.closest === 'function' ? target.closest('.heat-cell') : null;
                if (cell && container.contains(cell)) {
                    this.showHeatTooltip(cell);
                }
            });
            container.addEventListener('mouseleave', () => {
                this.hideHeatTooltip();
            });
            container.addEventListener('click', (e) => {
                if (Date.now() - (this._lastTouchAt || 0) < 450) return;
                const target = e.target;
                const cell = target && typeof target.closest === 'function' ? target.closest('.heat-cell') : null;
                if (cell && container.contains(cell)) {
                    this.showHeatTooltip(cell);
                }
            });
            container._heatTtBound = true;
        }
        if (!this._globalHeatTtBound && typeof document.addEventListener === 'function') {
            document.addEventListener('touchstart', (e) => {
                this._lastTouchAt = Date.now();
                const target = e.target;
                const cell = target && typeof target.closest === 'function' ? target.closest('.heat-cell') : null;
                if (cell) {
                    if (this._activeHeatCell === cell) {
                        this.hideHeatTooltip();
                    } else {
                        this.showHeatTooltip(cell);
                    }
                } else {
                    this.hideHeatTooltip();
                }
            }, { passive: true });
            if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
                window.addEventListener('scroll', () => this.hideHeatTooltip(), { passive: true });
                window.addEventListener('resize', () => this.hideHeatTooltip(), { passive: true });
            }
            this._globalHeatTtBound = true;
        }
    },

    /* HEAT CALENDAR */
    drawHeatCalendar(container, visibleSlice, mode = 'share', spotlightMode = false, peaksThreshold = 95, globalPercentiles = null, side = 'all', ddOverlay = false) {
        this.hideHeatTooltip();
        this._bindHeatTooltipEvents(container);
        container.innerHTML = '';
        const isPeaks = (spotlightMode === 'peaks' || spotlightMode === true);
        const isValleys = (spotlightMode === 'valleys');
        const isSpotlight = isPeaks || isValleys;
        container.classList.toggle('peaks-mode', isPeaks);
        container.classList.toggle('valleys-mode', isValleys);
        container.classList.toggle('dd-overlay-mode', !!ddOverlay);
        if (!visibleSlice || !visibleSlice.length) return 0;

        const colors = [
            '#14141e', '#1a1a28', '#202838', '#283848',
            '#385060', '#4a6878', '#d4a830',
            '#c07828', '#c04040', '#a03838', '#8855bb'
        ];

        const label = mode === 'dollar' ? 'DVCVI' : 'CVI';
        const N = visibleSlice.length;
        const regimeMode = isValleys ? 'VALLEYS' : 'PEAKS';
        const activeFilter = isSpotlight ? ('P' + peaksThreshold) : 'NONE';
        const isSingleTicker = Boolean(side && side !== 'all' && side !== 'long' && side !== 'short');

        const cellStates = this.evaluateViewportSpotlight(visibleSlice, regimeMode, activeFilter);
        let count = 0;

        for (let i = 0; i < N; i++) {
            const day = visibleSlice[i];
            const state = cellStates[i];
            const cell = document.createElement('div');
            cell.className = 'heat-cell';

            const score = state.score;
            const idx = Math.min(colors.length - 1, Math.floor((score / 100) * colors.length));
            cell.style.background = colors[idx];

            const lead = isValleys ? (day.leadValley || day.leadPeak) : (day.leadPeak || day.leadValley);
            const leadTicker = lead && lead.ticker ? lead.ticker : (isSingleTicker ? side : null);
            const activeCount = day.activeCount || 1;
            const isBasket = !isSingleTicker && activeCount > 1;

            const dateFormatted = typeof formatDisplayDate === 'function' ? formatDisplayDate(day.date) : day.date;
            const rvolVal = isValleys
                ? ((lead && lead.rvol != null) ? lead.rvol : (day.minRvol != null ? day.minRvol : (day.maxRvol != null ? day.maxRvol : 1.0)))
                : ((lead && lead.rvol != null) ? lead.rvol : (day.maxRvol != null ? day.maxRvol : 1.0));
            const rvolStr = rvolVal.toFixed(2) + 'x';
            const priceStr = (lead && lead.close != null) ? this.formatHeatPrice(lead.close, lead.ticker || leadTicker) : null;
            const chg1dPct = lead ? lead.chg1dPct : null;
            const dd63Pct = lead ? lead.dd63Pct : null;
            const dd252Pct = lead ? lead.dd252Pct : null;
            const ddInfo = this.getDdSeverity(dd63Pct);

            let climaxTag = '';
            let filterTag = 'BASE';
            if (isSpotlight) {
                if (!state.isHighlighted) {
                    cell.classList.add('heat-dim');
                } else {
                    count++;
                    if (isPeaks) {
                        if (state.visualTier === 'RED_P99') {
                            cell.classList.add('heat-peak-extreme');
                        } else if (state.visualTier === 'ORANGE_P95') {
                            cell.classList.add('heat-peak-significant');
                        } else {
                            cell.classList.add('heat-peak-notable');
                        }
                        if (!state.isStructuralClimax) {
                            cell.classList.add('local-max');
                        }
                    } else if (isValleys) {
                        if (state.visualTier === 'RED_P99') {
                            cell.classList.add('heat-valley-extreme');
                        } else if (state.visualTier === 'ORANGE_P95') {
                            cell.classList.add('heat-valley-significant');
                        } else {
                            cell.classList.add('heat-valley-notable');
                        }
                        if (!state.isStructuralClimax) {
                            cell.classList.add('local-min');
                        }
                    }
                }

                climaxTag = state.isStructuralClimax
                    ? (isPeaks ? 'MACRO CLIMAX' : 'MACRO DROUGHT')
                    : (isPeaks ? 'LOCAL PEAK' : 'LOCAL DROUGHT');
                filterTag = state.visualTier === 'RED_P99'
                    ? 'P99'
                    : (state.visualTier === 'ORANGE_P95' ? 'P95' : (state.visualTier === 'AMBER_P90' ? 'P90' : 'BASE'));
            }

            const metricLabel = isValleys ? 'VOL DROUGHT' : label;
            cell._heatMeta = {
                dateFormatted,
                leadTicker,
                isBasket,
                activeCount,
                priceStr,
                chg1dPct,
                metricLabel,
                modeWord: mode === 'dollar' ? 'Dollar Vol' : 'Share Vol',
                scoreStr: score.toFixed(1),
                rvolStr,
                windowRank: state.windowRank,
                totalN: N,
                dd63Pct,
                dd252Pct,
                ddSeverityLabel: ddInfo.label,
                ddTierCls: ddInfo.cls,
                ddOverlay: !!ddOverlay,
                isSpotlight,
                isPeaks,
                isValleys,
                isHighlighted: state.isHighlighted,
                isStructuralClimax: state.isStructuralClimax,
                visualTier: state.visualTier,
                peaksThreshold,
                climaxTag,
                filterTag
            };

            if (ddOverlay) {
                if (ddInfo.cls) cell.classList.add(ddInfo.cls);
                const track = document.createElement('span');
                track.className = 'heat-dd-track';
                if (ddInfo.fillPct > 0) {
                    const fill = document.createElement('span');
                    fill.className = 'heat-dd-fill ' + ddInfo.cls;
                    fill.style.width = ddInfo.fillPct + '%';
                    track.appendChild(fill);
                }
                cell.appendChild(track);

                if (chg1dPct != null && Number.isFinite(chg1dPct) && chg1dPct <= -5.0) {
                    const pip = document.createElement('span');
                    pip.className = chg1dPct <= -10.0 ? 'heat-dd-drop severe' : 'heat-dd-drop';
                    cell.appendChild(pip);
                }
            }

            container.appendChild(cell);
        }

        return count;
    },

    /* CONVERGENCE GAUGE (SVG Ring) */
    createGaugeRing(count, total, ticker, tooltip = '', meta = {}) {
        const circumference = 2 * Math.PI * 22; // radius = 22
        const progress = total > 0 ? count / total : 0;
        const dashOffset = circumference * (1 - progress);

        const side = meta.side || (typeof CONFIG !== 'undefined' ? CONFIG.etfs[ticker]?.side : 'long');
        const isLong = side === 'long';
        const cfg = meta.cfg || (typeof CONFIG !== 'undefined' ? CONFIG.etfs[ticker] : {}) || {};
        const region = cfg.exchange === 'NYSE' ? 'US' : cfg.exchange === 'TSX' ? 'CA' : cfg.exchange === 'LSE' ? 'UK' : (cfg.exchange || '');
        const lev = cfg.leverage || '';
        const regBadge = region && lev ? `${region} · ${lev}` : (region || lev || '');

        let strokeColor;
        if (count === total && total > 0) strokeColor = 'var(--purple)';
        else if (count >= total - 1 && count > 0) strokeColor = 'var(--red)';
        else if (count >= 3) strokeColor = 'var(--orange)';
        else if (count > 0) strokeColor = isLong ? 'var(--green)' : 'var(--red)';
        else strokeColor = 'rgba(255, 255, 255, 0.12)';

        const sideColor = isLong ? 'var(--long-accent)' : 'var(--short-accent)';
        const countColor = count === total && total > 0 ? 'var(--purple)'
            : count >= total - 1 && count > 0 ? 'var(--red)'
            : count >= 3 ? 'var(--orange)'
            : count > 0 ? (isLong ? 'var(--green)' : 'var(--red)')
            : 'rgba(255, 255, 255, 0.85)';

        const windows = meta.windows || (typeof CONFIG !== 'undefined' ? CONFIG.windows.percentile : [5, 10, 21, 63, 126, 252]);
        const volPct = meta.volPercentile || {};
        const threshold = meta.threshold || (typeof CONFIG !== 'undefined' ? CONFIG.thresholds.mwca_threshold : 90);

        const pipsHtml = windows.map(w => {
            const val = volPct[`${w}d`];
            const isAlert = val != null && val >= threshold;
            const pipCls = isAlert ? (isLong ? 'gauge-pip alert-long' : 'gauge-pip alert-short') : 'gauge-pip';
            const pipTip = `${ticker} ${w}d: ${val != null ? val.toFixed(1) + '%' : '—'} volume percentile${isAlert ? ` (ALERT ≥${threshold}%)` : ''}`;
            return `<span class="${pipCls}" data-tooltip="${pipTip}">${w}d</span>`;
        }).join('');

        const ttAttr = tooltip ? `data-tooltip="${tooltip}"` : '';

        // Clean uniform card: no left-side colored border
        return `
            <div class="convergence-gauge ${count >= 3 ? 'gauge-in-alert' : ''}" ${ttAttr}>
                <div class="gauge-header">
                    <span class="gauge-ticker" style="color: ${sideColor}">${ticker}</span>
                    <span class="gauge-sub">${regBadge}</span>
                </div>
                <div class="gauge-ring">
                    <svg viewBox="0 0 50 50">
                        <circle class="ring-bg" cx="25" cy="25" r="22"/>
                        <circle class="ring-fill" cx="25" cy="25" r="22"
                            stroke="${strokeColor}"
                            stroke-dasharray="${circumference}"
                            stroke-dashoffset="${dashOffset}"/>
                    </svg>
                    <span class="gauge-count" style="color: ${countColor}">${count}/${total}</span>
                </div>
                <div class="gauge-label">windows in alert</div>
                <div class="gauge-pips">${pipsHtml}</div>
            </div>
        `;
    },

    /* CORRELATION BAR */
    createCorrelationBar(ticker, value, side) {
        if (value == null) value = 0;
        const absVal = Math.abs(value);
        const widthPct = Math.min(absVal * 100, 50); // max 50% of bar width each side
        const isNeg = value < 0;
        const colorClass = isNeg ? 'negative' : 'positive';
        const valueColor = isNeg ? 'var(--red)' : 'var(--green)';
        const tickerColor = side === 'long' ? 'var(--green)' : 'var(--red)';

        let barStyle;
        if (isNeg) {
            barStyle = `right: 50%; width: ${widthPct}%;`;
        } else {
            barStyle = `left: 50%; width: ${widthPct}%;`;
        }

        const tip = `30-day Spearman correlation between ${ticker} daily log returns and NG=F spot returns. Current: ${value.toFixed(3)}.`;

        return `
            <div class="corr-row" data-tooltip="${tip}">
                <span class="corr-ticker" style="color: ${tickerColor}">${ticker}</span>
                <div class="corr-bar-container">
                    <div class="corr-bar-center"></div>
                    <div class="corr-bar-fill ${colorClass}" style="${barStyle}"></div>
                </div>
                <span class="corr-value" style="color: ${valueColor}">${value.toFixed(3)}</span>
            </div>
        `;
    }
};