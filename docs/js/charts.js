/* ============================================
   Lightweight Canvas Charts
   No external dependencies
   ============================================ */

const Charts = {

    // ---- SPARKLINE (Price) ----
    drawSparkline(canvas, data, color = '#2979ff', fillAlpha = 0.1) {
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
        ctx.fillStyle = color.replace(')', `, ${fillAlpha})`).replace('rgb', 'rgba');
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
            if (ratio > 0.9) color = '#d500f9';
            else if (ratio > 0.75) color = '#ff1744';
            else if (ratio > 0.5) color = '#ff9100';
            else if (ratio > 0.3) color = '#1565c0';
            else color = '#1a1a3e';

            ctx.fillStyle = color;
            ctx.fillRect(x, h - barH, barW, barH);
        }
    },

    // ---- HEAT CALENDAR ----
    drawHeatCalendar(container, dailyScores) {
        container.innerHTML = '';
        if (!dailyScores || !dailyScores.length) return;

        const colors = [
            '#1a1a2e', '#16213e', '#1a3060', '#1e4080',
            '#2a5090', '#4060a0', '#6080b0',
            '#d04040', '#e94560', '#ff006e', '#d500f9'
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
    createGaugeRing(count, total, ticker) {
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

        return `
            <div class="convergence-gauge">
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
