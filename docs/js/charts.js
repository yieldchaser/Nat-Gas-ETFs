/* ============================================
   Lightweight Canvas Charts
   No external dependencies
   ============================================ */

const Charts = {

    // ---- SPARKLINE (Price) ----
    drawSparkline(canvas, data, color = '#4a80b8', fillAlpha = 0.1) {
        if (!data || data.length < 2) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.parentElement.clientWidth;
        const h = canvas.height = canvas.parentElement.clientHeight || 50;
        ctx.clearRect(0, 0, w, h);

        const closes = data.map(d => d.close);
        const min = Math.min(...closes);
        const max = Math.max(...closes);
        const range = max - min || 1;
        const padding = 2;

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

        // Current price dot
        const lastX = padding + (closes.length - 1) * xStep;
        const lastY = h - padding - (closes[closes.length - 1] - min) * yScale;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
    },

    // ---- VOLUME BARS ----
    drawVolumeBars(canvas, data, percentiles) {
        if (!data || data.length < 2) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.parentElement.clientWidth;
        const h = canvas.height = canvas.parentElement.clientHeight || 24;
        ctx.clearRect(0, 0, w, h);

        const volumes = data.map(d => d.volume);
        const max = Math.max(...volumes) || 1;
        const barW = Math.max(1, (w / volumes.length) - 1);

        for (let i = 0; i < volumes.length; i++) {
            const x = i * (w / volumes.length);
            const barH = (volumes[i] / max) * h;

            // Color by relative magnitude
            const ratio = volumes[i] / max;
            let color;
            if (ratio > 0.9) color = '#8855bb';
            else if (ratio > 0.75) color = '#c04040';
            else if (ratio > 0.5) color = '#c07828';
            else if (ratio > 0.3) color = '#385e88';
            else color = '#181828';

            ctx.fillStyle = color;
            ctx.fillRect(x, h - barH, barW, barH);
        }
    },

    // ---- HEAT CALENDAR ----
    drawHeatCalendar(container, dailyScores) {
        container.innerHTML = '';
        if (!dailyScores || !dailyScores.length) return;

        const colors = [
            '#14141e', '#1a1a28', '#202838', '#283848',
            '#385060', '#4a6878', '#d4a830',
            '#c07828', '#c04040', '#a03838', '#8855bb'
        ];

        for (const day of dailyScores) {
            const cell = document.createElement('div');
            cell.className = 'heat-cell';

            // Map score (0-100) to color index
            const idx = Math.min(colors.length - 1, Math.floor((day.score / 100) * colors.length));
            cell.style.background = colors[idx];

            const tooltip = document.createElement('span');
            tooltip.className = 'tooltip';
            tooltip.textContent = `${day.date}: CVI ${day.score.toFixed(0)}`;
            cell.appendChild(tooltip);

            container.appendChild(cell);
        }
    },

    // ---- CONVERGENCE GAUGE (SVG Ring) ----
    createGaugeRing(count, total, ticker, tooltip = '') {
        const circumference = 2 * Math.PI * 22; // radius = 22
        const progress = count / total;
        const dashOffset = circumference * (1 - progress);

        let strokeColor;
        if (count === total) strokeColor = 'var(--purple)';
        else if (count >= total - 1) strokeColor = 'var(--red)';
        else if (count >= total - 2) strokeColor = 'var(--orange)';
        else strokeColor = 'var(--blue-dim)';

        let countColor;
        if (count === total) countColor = 'var(--purple)';
        else if (count >= total - 1) countColor = 'var(--red)';
        else countColor = 'var(--text-secondary)';

        const ttAttr = tooltip ? `data-tooltip="${tooltip}"` : '';

        return `
            <div class="convergence-gauge" ${ttAttr}>
                <div class="gauge-ticker" style="color: ${countColor}">${ticker}</div>
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
            </div>
        `;
    },

    // ---- FORWARD RETURN CURVE ----
    // Bar chart showing median return at each forward window (5d→252d)
    // Green bars = positive median, red = negative; edge window highlighted brighter
    // Small dots show win rate deviation from 50%
    drawForwardReturnCurve(canvas, echoes) {
        if (!canvas || !echoes || !echoes.forward_returns) return;
        const fwd = echoes.forward_returns;
        const windows = ['5d', '10d', '21d', '42d', '63d', '126d', '252d'];
        const edgeWin = echoes.signal_edge_window;

        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.parentElement ? canvas.parentElement.clientWidth : 200;
        const h = canvas.height = 80;
        ctx.clearRect(0, 0, w, h);

        const data = windows
            .map(k => ({
                key: k,
                median:   fwd[k]?.median   ?? null,
                win_rate: fwd[k]?.win_rate ?? null,
                isEdge:   k === edgeWin
            }))
            .filter(d => d.median !== null);

        if (data.length === 0) return;

        const medians = data.map(d => d.median);
        const maxAbs  = Math.max(Math.max(...medians.map(Math.abs)), 5); // minimum ±5% scale

        const padL = 10, padR = 4, padT = 14, padB = 18;
        const chartW = w - padL - padR;
        const chartH = h - padT - padB;

        const barGap = 3;
        const barW   = Math.max(4, Math.floor(chartW / data.length) - barGap);
        const scale  = chartH / (2 * maxAbs);
        const zeroY  = padT + chartH / 2;

        // -- Zero axis --
        ctx.beginPath();
        ctx.moveTo(padL, zeroY);
        ctx.lineTo(w - padR, zeroY);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // -- dashed divider at 63d boundary (beyond = decay-dominated) --
        const idx63 = data.findIndex(d => d.key === '63d');
        if (idx63 >= 0 && idx63 < data.length - 1) {
            const divX = padL + (idx63 + 1) * (barW + barGap) - barGap / 2;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(divX, padT);
            ctx.lineTo(divX, padT + chartH);
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
        }

        data.forEach((d, i) => {
            const x      = padL + i * (barW + barGap);
            const bh     = Math.max(1, Math.abs(d.median) * scale);
            const y      = d.median >= 0 ? zeroY - bh : zeroY;
            const isEdge = d.isEdge;
            const isLong = d.median > 0;

            // Bar fill — edge window is fully opaque, others dimmer
            ctx.fillStyle = isLong
                ? (isEdge ? 'rgba(61,184,122,0.9)' : 'rgba(61,184,122,0.4)')
                : (isEdge ? 'rgba(192,64,64,0.9)'  : 'rgba(192,64,64,0.4)');
            ctx.fillRect(x, y, barW, bh);

            // Edge window outline glow
            if (isEdge) {
                ctx.strokeStyle = isLong ? '#3db87a' : '#c04040';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x - 0.5, y - 0.5, barW + 1, bh + 1);
            }

            // Win-rate dot — offset above/below bar proportional to edge from 50%
            if (d.win_rate != null) {
                const wrDev = d.win_rate - 50; // +ve = bullish edge
                const dotY  = zeroY - wrDev * scale * 0.7;
                const dotX  = x + barW / 2;
                ctx.beginPath();
                ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
                ctx.fillStyle = wrDev > 0 ? 'rgba(61,184,122,0.9)' : 'rgba(192,64,64,0.9)';
                ctx.fill();
            }

            // Value annotation on taller bars (≥5%)
            if (Math.abs(d.median) >= 5) {
                ctx.font = 'bold 7px monospace';
                ctx.fillStyle = isLong ? '#3db87a' : '#c04040';
                ctx.textAlign = 'center';
                const txt   = `${d.median >= 0 ? '+' : ''}${d.median.toFixed(0)}%`;
                const lblY  = d.median >= 0 ? y - 2 : y + bh + 7;
                ctx.fillText(txt, x + barW / 2, lblY);
            }

            // Window label on x-axis
            ctx.font = `${isEdge ? 'bold ' : ''}7px monospace`;
            ctx.fillStyle = isEdge ? '#ffffff' : 'rgba(255,255,255,0.4)';
            ctx.textAlign = 'center';
            ctx.fillText(d.key, x + barW / 2, h - 3);
        });

        // Legend: small dot + "win rate" label top-left
        ctx.font = '6px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.textAlign = 'left';
        ctx.fillText('● win rate  ▌ median return', padL, 9);
    },

    // ---- CORRELATION BAR ----
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

        return `
            <div class="corr-row">
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
