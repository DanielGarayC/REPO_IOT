(function () {
    const origin = window.location.origin;
    const selA = document.getElementById('compare-sensor-a');
    const selB = document.getElementById('compare-sensor-b');
    const btnCompare = document.getElementById('btn-compare');
    const btnReset = document.getElementById('btn-reset');
    const insightsArea = document.getElementById('insights-area');
    const sensorsListArea = document.getElementById('sensors-list-area');
    const tableArea = document.getElementById('comparison-table-area');
    let chart = null;

    function initChart() {
        const ctx = document.getElementById('compareChart').getContext('2d');
        if (chart) chart.destroy();
        chart = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: {
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            title: function(items) {
                                try {
                                    const idx = items && items[0] && items[0].dataIndex;
                                    const ts = chart && chart.data && chart.data._timestamps && chart.data._timestamps[idx];
                                    return formatShortDate(ts);
                                } catch (e) { return '' }
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            callback: function(value, index) {
                                try {
                                    const timestamps = chart && chart.data && chart.data._timestamps ? chart.data._timestamps : [];
                                    const iso = timestamps[index];
                                    if (!iso) return '';
                                    const d = new Date(iso);
                                    const pad = (n) => (n < 10 ? '0' + n : String(n));
                                    const day = pad(d.getDate());
                                    const month = pad(d.getMonth() + 1);
                                    const year = d.getFullYear();
                                    const hours = pad(d.getHours());
                                    const minutes = pad(d.getMinutes());
                                    return `${day}/${month}/${year} ${hours}:${minutes}`;
                                } catch (e) { return '' }
                            },
                            autoSkip: true,
                            maxRotation: 0
                        },
                        grid: { color: 'rgba(16,37,84,0.04)' }
                    },
                    y: { grid: { color: 'rgba(16,37,84,0.04)' } }
                }
            }
        });
    }

    async function loadSensors() {
        try {
            const res = await fetch(origin + '/api/sensors/info');
            if (!res.ok) return;
            const list = await res.json();
            selA.innerHTML = '';
            selB.innerHTML = '';
            list.forEach((s, idx) => {
                const o1 = document.createElement('option'); o1.value = s.sensor_id; o1.textContent = s.name + (s.location ? (' — ' + s.location) : '');
                const o2 = o1.cloneNode(true);
                selA.appendChild(o1); selB.appendChild(o2);
            });
            if (list.length > 0) { selA.value = list[0].sensor_id; selB.value = list.length > 1 ? list[1].sensor_id : list[0].sensor_id }
            // ensure selects can't pick same sensor and attach change listeners
            if (selA && selB) {
                selA.addEventListener('change', () => { syncSelects(); });
                selB.addEventListener('change', () => { syncSelects(); });
                // initial sync to disable matching options
                syncSelects();
            }
        } catch (e) { console.error('loadSensors', e); }
    }

    // Format ISO timestamp to numeric DD/MM/YYYY HH:MM
    function formatShortDate(iso) {
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) return iso;
            const pad = (n) => (n < 10 ? '0' + n : String(n));
            const day = pad(d.getDate());
            const month = pad(d.getMonth() + 1);
            const year = d.getFullYear();
            const hours = pad(d.getHours());
            const minutes = pad(d.getMinutes());
            return `${day}/${month}/${year} ${hours}:${minutes}`;
        } catch (e) { return iso }
    }

    // compute statistics including standard deviation for temperature and humidity
    function computeStats(arr) {
        const valsT = []; const valsH = [];
        let minT = null, maxT = null, minH = null, maxH = null;
        arr.forEach(it => {
            if (it.avgT != null) { const v = Number(it.avgT); valsT.push(v); minT = minT == null ? v : Math.min(minT, v); maxT = maxT == null ? v : Math.max(maxT, v); }
            if (it.avgH != null) { const v = Number(it.avgH); valsH.push(v); minH = minH == null ? v : Math.min(minH, v); maxH = maxH == null ? v : Math.max(maxH, v); }
        });
        const sum = a => a.reduce((s, x) => s + x, 0);
        const mean = a => a.length ? sum(a) / a.length : null;
        const variance = a => {
            if (!a.length) return null;
            const m = mean(a); return a.reduce((s, x) => s + Math.pow(x - m, 2), 0) / a.length;
        };
        const std = a => { const v = variance(a); return v == null ? null : Math.sqrt(v); };
        return {
            avgT: mean(valsT), avgH: mean(valsH),
            stdT: std(valsT), stdH: std(valsH),
            minT, maxT, minH, maxH,
            countT: valsT.length, countH: valsH.length
        };
    }

    // Simple linear regression forecast for next N minutes. Returns array of {timestamp, value}
    // Simple linear regression forecast producing `steps` predictions spaced by stepMinutes (default 5min)
    function linearForecast(arr, valueKey = 'avgT', steps = 4, stepMinutes = 5) {
        // arr: list of items with .timestamp and a numeric value at valueKey
        const pts = arr.map(it => { try { return { x: new Date(it.timestamp).getTime() / 60000.0, y: Number(it[valueKey]) }; } catch (e) { return null } }).filter(p => p && !isNaN(p.y));
        if (pts.length === 0) return null;
        // If only one point, repeat same value at future intervals
        if (pts.length === 1) {
            const lastX = pts[pts.length - 1].x; const lastY = pts[pts.length - 1].y; const out = [];
            for (let i = 1; i <= steps; i++) { out.push({ timestamp: new Date((lastX + stepMinutes * i) * 60000).toISOString(), value: lastY }); }
            return out;
        }
        // compute linear regression (y = a + b*x) using minutes as x
        const n = pts.length;
        const sumX = pts.reduce((s, p) => s + p.x, 0); const sumY = pts.reduce((s, p) => s + p.y, 0);
        const sumXY = pts.reduce((s, p) => s + p.x * p.y, 0); const sumXX = pts.reduce((s, p) => s + p.x * p.x, 0);
        const denom = (n * sumXX - sumX * sumX);
        // if denom is nearly zero fallback to repeating last value
        if (Math.abs(denom) < 1e-9) { const lastY = pts[pts.length - 1].y; const lastX = pts[pts.length - 1].x; const out = []; for (let i = 1; i <= steps; i++) { out.push({ timestamp: new Date((lastX + stepMinutes * i) * 60000).toISOString(), value: lastY }); } return out; }
        const b = (n * sumXY - sumX * sumY) / denom;
        const a = (sumY - b * sumX) / n;
        const lastX = pts[pts.length - 1].x; const out = [];
        for (let i = 1; i <= steps; i++) {
            const xf = lastX + stepMinutes * i; const yf = a + b * xf; out.push({ timestamp: new Date(xf * 60000).toISOString(), value: yf });
        }
        return out;
    }

    async function compare() {
        const a = selA.value; const b = selB.value;
        if (!a || !b) { alert('Selecciona ambos sensores'); return }
        const activeBtn = document.querySelector('.time-btn.active');
        const mapping = { '1H': '1h', '24H': '24h', '7D': '7d', '30D': '30d' };
        const filter = activeBtn ? mapping[activeBtn.textContent.trim().toUpperCase()] || '24h' : '24h';
        try {
            const res = await fetch(origin + '/api/sensors/data/multi?ids=' + encodeURIComponent(a + ',' + b) + '&filter=' + filter);
            if (!res.ok) { console.error('multi failed', res.status); return }
            const data = await res.json();
            // prepare datasets
            const seriesA = data[a] || []; const seriesB = data[b] || [];
            const labels = Array.from(new Set((seriesA.concat(seriesB)).map(x => x.timestamp))).sort();
            const tempA = labels.map(lbl => { const it = seriesA.find(s => s.timestamp === lbl); return it ? (it.avgT != null ? Number(it.avgT) : null) : null });
            const humA = labels.map(lbl => { const it = seriesA.find(s => s.timestamp === lbl); return it ? (it.avgH != null ? Number(it.avgH) : null) : null });
            const tempB = labels.map(lbl => { const it = seriesB.find(s => s.timestamp === lbl); return it ? (it.avgT != null ? Number(it.avgT) : null) : null });
            const humB = labels.map(lbl => { const it = seriesB.find(s => s.timestamp === lbl); return it ? (it.avgH != null ? Number(it.avgH) : null) : null });

            initChart();
            chart.data.labels = labels.map(l => { const d = new Date(l); return d.toLocaleString(); });
            // use friendly sensor names from selects if available
            const nameA = (selA.options[selA.selectedIndex] && selA.options[selA.selectedIndex].text) || a;
            const nameB = (selB.options[selB.selectedIndex] && selB.options[selB.selectedIndex].text) || b;
            // smoother lines, hide points by default for cleaner look, spanGaps=true connects nulls
            chart.data.datasets = [
                { label: `Temperatura — ${nameA}`, data: tempA, borderColor: '#ff6b6b', tension: 0.4, pointRadius: 0, pointHoverRadius: 6, borderWidth: 2, fill: false, spanGaps: true, cubicInterpolationMode: 'monotone' },
                { label: `Humedad — ${nameA}`, data: humA, borderColor: '#4ecdc4', tension: 0.4, pointRadius: 0, pointHoverRadius: 6, borderWidth: 2, fill: false, spanGaps: true, cubicInterpolationMode: 'monotone' },
                { label: `Temperatura — ${nameB}`, data: tempB, borderColor: '#6366f1', tension: 0.4, pointRadius: 0, pointHoverRadius: 6, borderWidth: 2, fill: false, spanGaps: true, cubicInterpolationMode: 'monotone' },
                { label: `Humedad — ${nameB}`, data: humB, borderColor: '#f59e0b', tension: 0.4, pointRadius: 0, pointHoverRadius: 6, borderWidth: 2, fill: false, spanGaps: true, cubicInterpolationMode: 'monotone' }
            ];
            // ensure points visually hidden but interactive on hover
            chart.options.elements = { point: { radius: 0, hitRadius: 10 } };
            chart.update();

            // insights with std dev and forecast (friendly labels)
            const sA = computeStats(seriesA); const sB = computeStats(seriesB);
            // forecasts: 4 predictions spaced by 5 minutes (user requested) => 4x5 = next 20 minutes
            const fA_T = linearForecast(seriesA, 'avgT', 4, 5); const fB_T = linearForecast(seriesB, 'avgT', 4, 5);

            function fmtNum(v, digits = 2) { return v == null ? '—' : Number(v).toFixed(digits) }
            // renderForecastList(f, sensorCls) - optional sensorCls ('sensor-a'|'sensor-b') to color-code items
            function renderForecastList(f, sensorCls) {
                if (!f) return `<div class="forecast-item ${sensorCls||''}">—</div>`;
                return f.map(p => `<div class="forecast-item ${sensorCls||''}">${new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}<br/><small>${Number(p.value).toFixed(2)}°C</small></div>`).join('')
            }

                        insightsArea.innerHTML = `
                <div class="stat-row">
                    <div class="stat-pill sensor-a">
                        <div class="pill-title">Sensor A</div>
                        <small>${a}</small>
                    </div>
                    <div class="stat-pill sensor-b">
                        <div class="pill-title">Sensor B</div>
                        <small>${b}</small>
                    </div>
                </div>

                <div class="stat-row" style="margin-top:12px">
                    <div class="stat-pill sensor-a">
                        <div class="metric-label">Promedio Temp (A)</div>
                        <div class="metric">${fmtNum(sA.avgT)} °C</div>
                    </div>
                    <div class="stat-pill sensor-a">
                        <div class="metric-label">Desviación Temp (A)</div>
                        <div class="metric">${fmtNum(sA.stdT)}</div>
                    </div>
                    <div class="stat-pill sensor-a">
                        <div class="metric-label">Promedio Hum (A)</div>
                        <div class="metric">${fmtNum(sA.avgH, 1)} %</div>
                    </div>
                </div>

                <div class="stat-row" style="margin-top:12px">
                    <div class="stat-pill sensor-b">
                        <div class="metric-label">Promedio Temp (B)</div>
                        <div class="metric">${fmtNum(sB.avgT)} °C</div>
                    </div>
                    <div class="stat-pill sensor-b">
                        <div class="metric-label">Desviación Temp (B)</div>
                        <div class="metric">${fmtNum(sB.stdT)}</div>
                    </div>
                    <div class="stat-pill sensor-b">
                        <div class="metric-label">Promedio Hum (B)</div>
                        <div class="metric">${fmtNum(sB.avgH, 1)} %</div>
                    </div>
                </div>

                <hr style="width:90%;margin:14px auto"/>

                <div class="stat-row" style="margin-top:8px;align-items:center;justify-content:center">
                    <strong>Diferencia (Promedio Temp A - B):</strong>
                    <div style="margin-left:8px">${(sA.avgT != null && sB.avgT != null) ? (sA.avgT - sB.avgT).toFixed(2) + ' °C' : '—'}</div>
                </div>

                <hr style="width:90%;margin:14px auto"/>

                <div style="margin-top:12px; width:100%; text-align:center">
                    <strong>Predicción — Temperaturas</strong>
                    <div style="display:flex;gap:12px;justify-content:center;margin-top:8px;flex-wrap:wrap">
                        <div style="min-width:140px;text-align:center">
                            <strong>Sensor A — ${nameA}</strong>
                            <div class="forecast-list">${renderForecastList(fA_T,'sensor-a')}</div>
                        </div>
                        <div style="min-width:140px;text-align:center">
                            <strong>Sensor B — ${nameB}</strong>
                            <div class="forecast-list">${renderForecastList(fB_T,'sensor-b')}</div>
                        </div>
                    </div>
                </div>
            `;

            // sensors list
            const resInfo = await fetch(origin + '/api/sensors/info'); const sensors = await resInfo.json();
            sensorsListArea.innerHTML = sensors.map(s => `<div class="sensor-item"><div class="name">${s.name}</div><div class="meta">${s.sensor_id} — ${s.location || 'Sin ubicación'}</div></div>`).join('');
            // adjust sensors list height to match number of sensors (approx 56px per item)
            if (sensorsListArea) {
                const count = sensors.length || 1;
                const h = Math.min(8 + count * 56, 600); // cap height
                sensorsListArea.style.maxHeight = h + 'px';
            }

            // table: simple merged table of recent points
            function buildRows(arr, label) { return arr.slice(-10).map(it => `<tr><td>${label}</td><td>${formatShortDate(it.timestamp)}</td><td>${it.avgT != null ? it.avgT : '—'}</td><td>${it.avgH != null ? it.avgH : '—'}</td></tr>`).join('') }
            if (tableArea) { tableArea.innerHTML = `<table><thead><tr><th>Sensor</th><th>Timestamp</th><th>AvgT</th><th>AvgH</th></tr></thead><tbody>${buildRows(seriesA, 'A')}${buildRows(seriesB, 'B')}</tbody></table>`; }

            // store last comparison payload for exports
            window.__lastComparison = { ids: [a, b], series: { [a]: seriesA, [b]: seriesB }, stats: { [a]: sA, [b]: sB } };

        } catch (e) { console.error('compare error', e) }
    }

    function resetAll() { initChart(); insightsArea.innerHTML = '<p>Seleccione dos sensores y presione "Comparar" para ver estadísticas y diferencias.</p>'; sensorsListArea.innerHTML = ''; tableArea.innerHTML = ''; }
    // guard reset to handle missing tableArea
    function resetAllGuarded() { initChart(); insightsArea.innerHTML = '<p>Seleccione dos sensores y presione "Comparar" para ver estadísticas y diferencias.</p>'; sensorsListArea.innerHTML = ''; if (tableArea) tableArea.innerHTML = ''; }

    // --- Export helpers ---
    function downloadCSV(filename, rows) {
        const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }

    function exportComparisonCSV() {
        const payload = window.__lastComparison; if (!payload) { alert('Realice una comparación primero!'); return }
        const rows = ['sensor_id,timestamp,avgT,avgH,minT,maxT,medT,medH'];
        Object.keys(payload.series).forEach(sid => {
            payload.series[sid].forEach(it => {
                rows.push([sid, it.timestamp || '', it.avgT != null ? it.avgT : '', it.avgH != null ? it.avgH : '', it.minT != null ? it.minT : '', it.maxT != null ? it.maxT : '', it.medT != null ? it.medT : '', it.medH != null ? it.medH : ''].join(','));
            });
        });
        downloadCSV('comparison_data.csv', rows);
    }

    function exportComparisonXLSX() {
        const payload = window.__lastComparison; if (!payload) { alert('Realice una comparación primero!'); return }
        const wb = XLSX.utils.book_new();
        // data sheet
        const data = [];
        Object.keys(payload.series).forEach(sid => {
            payload.series[sid].forEach(it => data.push({ sensor_id: sid, timestamp: it.timestamp, avgT: it.avgT, avgH: it.avgH, minT: it.minT, maxT: it.maxT }));
        });
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'data');
        // stats sheet
        const stats = Object.keys(payload.stats).map(sid => ({ sensor_id: sid, avgT: payload.stats[sid].avgT, stdT: payload.stats[sid].stdT, avgH: payload.stats[sid].avgH, stdH: payload.stats[sid].stdH, countT: payload.stats[sid].countT, countH: payload.stats[sid].countH }));
        const ws2 = XLSX.utils.json_to_sheet(stats);
        XLSX.utils.book_append_sheet(wb, ws2, 'stats');
        XLSX.writeFile(wb, 'comparison_report.xlsx');
    }

    async function exportComparisonPDF() {
        const payload = window.__lastComparison; if (!payload) { alert('Realice una comparación primero!'); return }
        const { jsPDF } = window.jspdf || {}; if (!jsPDF) { alert('jsPDF library no cargada'); return }
        const doc = new jsPDF();
        doc.setFontSize(14); doc.text('Reporte de Comparación de Sensores', 14, 20);
        let y = 30;
        const rows = [];
        Object.keys(payload.stats).forEach(sid => {
            const s = payload.stats[sid];
            rows.push([sid, s.avgT != null ? s.avgT.toFixed(2) : '—', s.stdT != null ? s.stdT.toFixed(2) : '—', s.avgH != null ? s.avgH.toFixed(1) : '—', s.stdH != null ? s.stdH.toFixed(2) : '—']);
        });
        doc.autoTable({ head: [['Sensor', 'avgT', 'stdT', 'avgH', 'stdH']], body: rows, startY: y });
        doc.save('comparison_report.pdf');
    }

    document.addEventListener('DOMContentLoaded', async () => {
        initChart(); await loadSensors();
        document.querySelectorAll('.time-btn').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.time-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); }));
        btnCompare.addEventListener('click', compare); btnReset.addEventListener('click', async () => { await loadSensors(); resetAllGuarded(); });
    });

    // wire export buttons
    document.addEventListener('DOMContentLoaded', () => {
        const bCsv = document.getElementById('btn-export-csv'); if (bCsv) bCsv.addEventListener('click', exportComparisonCSV);
        const bXlsx = document.getElementById('btn-export-xlsx'); if (bXlsx) bXlsx.addEventListener('click', exportComparisonXLSX);
        const bPdf = document.getElementById('btn-export-pdf'); if (bPdf) bPdf.addEventListener('click', exportComparisonPDF);
    });

    // --- Select synchronization: prevent choosing same sensor in both selects ---
    function syncSelects() {
        const aVal = selA.value; const bVal = selB.value;
        // disable option in other select if values equal
        Array.from(selA.options).forEach(opt => { opt.disabled = (opt.value === bVal); });
        Array.from(selB.options).forEach(opt => { opt.disabled = (opt.value === aVal); });
        // if both equal, try to pick a different value for selB
        if (aVal && bVal && aVal === bVal) {
            for (const o of selB.options) { if (o.value !== aVal) { selB.value = o.value; break; } }
        }
    }

    // attach listeners after loading sensors
    (function attachSelectSync() {
        const obs = new MutationObserver(() => { if (selA && selB) { selA.addEventListener('change', () => { syncSelects(); }); selB.addEventListener('change', () => { syncSelects(); }); } });
        obs.observe(document.body, { childList: true, subtree: true });
    })();
})();
