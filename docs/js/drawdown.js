/* ============================================
   ETF Drawdown Chart Module
   Calculates and displays multi-timeframe drawdown % for all ETFs
   ============================================ */

const Drawdown = {
    canvas: null,
    ctx: null,
    tooltip: null,
    chartData: null,
    activeHorizon: 'all', // '1y', '3y', '5y', '10y', 'all'
    
    // ETF colors matching the existing theme
    etfColors: {
        'BOIL': '#4a90e2',  // Blue
        'KOLD': '#e24a4a',  // Red
        'HNU': '#50e3c2',   // Cyan
        'HND': '#f5a623',   // Orange
        '3NGL': '#7ed321',  // Green
        '3NGS': '#bd10e0'   // Purple
    },

    init() {
        this.canvas = document.getElementById('drawdown-canvas');
        this.tooltip = document.getElementById('chart-tooltip');
        if (!this.canvas) {
            console.error('Drawdown canvas not found');
            return;
        }
        
        this.ctx = this.canvas.getContext('2d');
        this.setupEventListeners();
        console.log('Drawdown chart initialized');
    },

    setupEventListeners() {
        if (!this.canvas) return;
        
        // Horizon buttons
        document.querySelectorAll('.dd-horizon-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.dd-horizon-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.activeHorizon = e.target.dataset.horizon;
                this.render();
            });
        });

        // Canvas mouse events for tooltip
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseleave', () => {
            if (this.tooltip) this.tooltip.style.display = 'none';
        });

        // Resize handling
        window.addEventListener('resize', () => this.render());
    },

    async loadData(dashboardData) {
        if (!dashboardData || !dashboardData.etfs) {
            console.error('Drawdown: No dashboard data provided');
            return;
        }

        console.log('Drawdown: Loading data for ETFs...');
        
        // Calculate drawdowns for all ETFs
        const drawdowns = {};
        const etfList = ['BOIL', 'KOLD', 'HNU', 'HND', '3NGL', '3NGS'];
        
        etfList.forEach(ticker => {
            const etf = dashboardData.etfs[ticker];
            if (!etf || !etf.history) {
                console.warn(`Drawdown: No history for ${ticker}`);
                return;
            }

            const history = etf.history;
            const drawdownData = [];
            let runningPeak = -Infinity;

            // Calculate running drawdown
            history.forEach(point => {
                const price = point.close;
                const date = point.date;
                
                // Update running peak
                if (price > runningPeak) {
                    runningPeak = price;
                }

                // Calculate drawdown %
                const drawdownPct = ((price - runningPeak) / runningPeak) * 100;

                drawdownData.push({
                    date: date,
                    drawdown: drawdownPct,
                    price: price,
                    peak: runningPeak
                });
            });

            drawdowns[ticker] = drawdownData;
            console.log(`Drawdown: Loaded ${drawdownData.length} points for ${ticker}`);
        });

        this.chartData = drawdowns;
        console.log('Drawdown: Data loaded, rendering chart...');
        this.render();
    },

    filterDataByHorizon(data) {
        if (!data || data.length === 0) return data;
        
        const latestDate = new Date(data[data.length - 1].date);
        let cutoffDate;

        switch(this.activeHorizon) {
            case '1y':
                cutoffDate = new Date(latestDate);
                cutoffDate.setFullYear(latestDate.getFullYear() - 1);
                break;
            case '3y':
                cutoffDate = new Date(latestDate);
                cutoffDate.setFullYear(latestDate.getFullYear() - 3);
                break;
            case '5y':
                cutoffDate = new Date(latestDate);
                cutoffDate.setFullYear(latestDate.getFullYear() - 5);
                break;
            case '10y':
                cutoffDate = new Date(latestDate);
                cutoffDate.setFullYear(latestDate.getFullYear() - 10);
                break;
            default: // 'all'
                return data;
        }

        return data.filter(d => new Date(d.date) >= cutoffDate);
    },

    render() {
        if (!this.canvas || !this.chartData) {
            console.log('Drawdown render skipped:', { 
                hasCanvas: !!this.canvas, 
                hasData: !!this.chartData 
            });
            return;
        }

        console.log('Drawdown: Starting render...');

        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        const padding = { top: 20, right: 120, bottom: 40, left: 60 };
        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;

        this.ctx.clearRect(0, 0, w, h);

        // Filter all ETF data by active horizon
        const filteredData = {};
        let allDates = new Set();
        let minDrawdown = 0;
        let maxDrawdown = 0;

        Object.keys(this.chartData).forEach(ticker => {
            const filtered = this.filterDataByHorizon(this.chartData[ticker]);
            filteredData[ticker] = filtered;
            
            filtered.forEach(d => {
                allDates.add(d.date);
                if (d.drawdown < minDrawdown) minDrawdown = d.drawdown;
                if (d.drawdown > maxDrawdown) maxDrawdown = d.drawdown;
            });
        });

        const sortedDates = Array.from(allDates).sort();
        if (sortedDates.length === 0) {
            console.warn('Drawdown: No data to render');
            return;
        }

        console.log(`Drawdown: Rendering ${sortedDates.length} dates, drawdown range: ${minDrawdown.toFixed(2)}% to ${maxDrawdown.toFixed(2)}%`);

        // Round min drawdown to nearest -10%
        minDrawdown = Math.floor(minDrawdown / 10) * 10;
        const drawdownRange = Math.abs(minDrawdown);

        // Draw grid and axes
        this.drawGrid(padding, chartW, chartH, minDrawdown, sortedDates);

        // Draw each ETF line
        Object.keys(filteredData).forEach(ticker => {
            const data = filteredData[ticker];
            if (data.length === 0) return;

            const color = this.etfColors[ticker] || '#888';
            this.drawLine(data, sortedDates, padding, chartW, chartH, drawdownRange, color);
        });

        // Draw legend
        this.drawLegend(w, padding);

        // Store for tooltip
        this.filteredData = filteredData;
        this.sortedDates = sortedDates;
        this.padding = padding;
        this.chartW = chartW;
        this.chartH = chartH;
        this.drawdownRange = drawdownRange;
        
        console.log('Drawdown: Render complete');
    },

    drawGrid(padding, chartW, chartH, minDrawdown, dates) {
        const ctx = this.ctx;
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.lineWidth = 1;

        // Horizontal grid lines (drawdown %)
        const gridLines = Math.ceil(Math.abs(minDrawdown) / 10);
        for (let i = 0; i <= gridLines; i++) {
            const dd = i * -10;
            const y = padding.top + (chartH * i / gridLines);
            
            // Grid line
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartW, y);
            ctx.stroke();

            // Y-axis label
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${dd}%`, padding.left - 8, y);
        }

        // Vertical grid lines (dates)
        const maxDateLabels = 8;
        const dateStep = Math.ceil(dates.length / maxDateLabels);
        
        for (let i = 0; i < dates.length; i += dateStep) {
            const x = padding.left + (chartW * i / (dates.length - 1));
            
            // Grid line
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + chartH);
            ctx.stroke();

            // X-axis label
            const dateStr = new Date(dates[i]).toLocaleDateString('en-US', { 
                month: 'short', 
                year: '2-digit' 
            });
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(dateStr, x, padding.top + chartH + 8);
        }

        // 0% reference line (thicker)
        ctx.strokeStyle = 'rgba(0,255,255,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top);
        ctx.lineTo(padding.left + chartW, padding.top);
        ctx.stroke();
    },

    drawLine(data, allDates, padding, chartW, chartH, drawdownRange, color) {
        const ctx = this.ctx;
        
        // Create date lookup for fast indexing
        const dataByDate = {};
        data.forEach(d => dataByDate[d.date] = d);

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        let started = false;
        allDates.forEach((date, i) => {
            const point = dataByDate[date];
            if (!point) return;

            const x = padding.left + (chartW * i / (allDates.length - 1));
            const y = padding.top + (chartH * Math.abs(point.drawdown) / drawdownRange);

            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();
    },

    drawLegend(canvasWidth, padding) {
        const ctx = this.ctx;
        const legendX = canvasWidth - padding.right + 10;
        let legendY = padding.top + 10;

        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        Object.keys(this.etfColors).forEach(ticker => {
            const color = this.etfColors[ticker];
            
            // Color box
            ctx.fillStyle = color;
            ctx.fillRect(legendX, legendY - 4, 12, 8);

            // Ticker label
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fillText(ticker, legendX + 18, legendY);

            legendY += 20;
        });
    },

    handleMouseMove(e) {
        if (!this.filteredData || !this.sortedDates) return;

        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate date index from mouse X
        const chartX = mouseX - this.padding.left;
        if (chartX < 0 || chartX > this.chartW) {
            this.tooltip.style.display = 'none';
            return;
        }

        const dateIndex = Math.round((chartX / this.chartW) * (this.sortedDates.length - 1));
        const date = this.sortedDates[dateIndex];
        
        // Find nearest points for all ETFs at this date
        const points = {};
        Object.keys(this.filteredData).forEach(ticker => {
            const data = this.filteredData[ticker];
            const point = data.find(d => d.date === date);
            if (point) points[ticker] = point;
        });

        if (Object.keys(points).length === 0) {
            this.tooltip.style.display = 'none';
            return;
        }

        // Show tooltip
        this.showTooltip(e.clientX, e.clientY, date, points);
    },

    showTooltip(x, y, date, points) {
        const dateStr = new Date(date).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: 'numeric'
        });

        let html = `<div class="tooltip-date">${dateStr}</div>`;
        
        Object.keys(points).forEach(ticker => {
            const point = points[ticker];
            const color = this.etfColors[ticker];
            const ddStr = point.drawdown.toFixed(2);
            html += `<div class="tooltip-row">
                <span class="tooltip-lbl" style="color: ${color}">${ticker}</span>
                <span class="tooltip-val">${ddStr}%</span>
            </div>`;
        });

        this.tooltip.innerHTML = html;
        this.tooltip.style.display = 'block';
        this.tooltip.style.left = (x + 15) + 'px';
        this.tooltip.style.top = (y - 10) + 'px';
    }
};

// Initialize when Data is loaded
window.DrawdownChart = Drawdown;
