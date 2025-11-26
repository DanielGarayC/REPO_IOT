// script.js
// Lógica del frontend para consumir los endpoints del Flask y actualizar la UI uu
// - /api/sensors/data/last  -> último registro (avgT, avgH, min/max)
// - /api/sensors/data/list?filter=1h|24h|7d|30d  -> lista de registros para graficar

(() => {
  const origin = window.location.origin; // usa la IP/host actual del navegador
  let currentSensorId = null;
  let currentSensorName = null;
  let currentFilter = '1h';
  // mapa local de metadata de sensores (sensor_id -> objeto desde /api/sensors/info)
  let sensorInfoMap = {};

  // Elementos del DOM
  const statAvgTemp = document.getElementById('stat-avg-temp');
  const statAvgHum = document.getElementById('stat-avg-humidity');
  const statSensorCard = document.getElementById('stat-sensor');
  let sensorSelectEl = null; // se inicializa cuando carguemos la lista de sensores
  const statSensorNameEl = document.getElementById('stat-sensor-name');
  const statSensorIdEl = document.getElementById('stat-sensor-id');
  const alertsList = document.getElementById('alerts-list');

  const deviceCards = document.querySelectorAll('.device-card');

  // Chart.js setup
  const ctx = document.getElementById('mainChart').getContext('2d');
  let chart = null;

  function initChart() {
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Temperatura (Promedio) °C',
            data: [],
            borderColor: '#ff6b6b',
            backgroundColor: 'rgba(255,107,107,0.12)',
            fill: true,
            tension: 0.3,
            pointRadius: 4
          },
          {
            label: 'Humedad (Promedio) %',
            data: [],
            borderColor: '#4ecdc4',
            backgroundColor: 'rgba(78,205,196,0.12)',
            fill: true,
            tension: 0.3,
            pointRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          tooltip: {
            callbacks: {
              // título del tooltip: fecha y hora completa por punto
              title: function(tooltipItems) {
                try {
                  const idx = tooltipItems && tooltipItems[0] && tooltipItems[0].dataIndex;
                  const ts = chart && chart.data && chart.data._timestamps && chart.data._timestamps[idx];
                  return prettyTimestamp(ts);
                } catch (e) { return '' }
              },
              // muestra min/max/med si están disponibles en el punto asociado
              label: function(context) {
                const idx = context.dataIndex;
                const ds = context.datasetIndex;
                const item = context.chart.data._items && context.chart.data._items[idx];
                const v = context.formattedValue;
                if (item) {
                  if (ds === 0) { // temperatura
                    const extras = [];
                    if (item.minT != null) extras.push('min ' + item.minT);
                    if (item.maxT != null) extras.push('max ' + item.maxT);
                    return context.dataset.label + ': ' + v + (extras.length ? ' (' + extras.join(', ') + ')' : '');
                  } else {
                    const extras = [];
                    if (item.minH != null) extras.push('min ' + item.minH);
                    if (item.maxH != null) extras.push('max ' + item.maxH);
                    return context.dataset.label + ': ' + v + (extras.length ? ' (' + extras.join(', ') + ')' : '');
                  }
                }
                return context.dataset.label + ': ' + v;
              }
            }
          },
          legend: { position: 'top' }
        },
        scales: {
          x: {
            ticks: {
              color: '#64748b',
              autoSkip: true,
              maxRotation: 0,
              // smart per-point formatting: show date DD/MM/YY when day changes, otherwise show time HH:MM
              callback: function(value, index) {
                try {
                  const timestamps = chart && chart.data && chart.data._timestamps ? chart.data._timestamps : [];
                  const iso = timestamps[index];
                  if (!iso) return '';
                  const d = new Date(iso);
                  const h = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const pad = (n) => (n < 10 ? '0' + n : String(n));
                  const date = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)}`;
                  // if first label or day differs from previous data point, show date + time; else show time only
                  if (index === 0) return `${date} ${h}`;
                  const prevIso = timestamps[index-1];
                  if (!prevIso) return `${date} ${h}`;
                  const pd = new Date(prevIso);
                  if (pd.getFullYear() !== d.getFullYear() || pd.getMonth() !== d.getMonth() || pd.getDate() !== d.getDate()) {
                    return `${date} ${h}`;
                  }
                  return h;
                } catch (e) { return '' }
              }
            },
            grid: { color: 'rgba(16,37,84,0.06)' }
          },
          y: { ticks: { color: '#64748b' } }
        }
      }
    });
  }

  // Formatea timestamp ISO a '29 Oct 07:14'
  function prettyTimestamp(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const pad = (n) => (n < 10 ? '0' + n : String(n));
      const day = pad(d.getDate());
      const month = pad(d.getMonth() + 1);
      const year = d.getFullYear();
      const hours = pad(d.getHours());
      const minutes = pad(d.getMinutes());
      // Format: DD/MM/YYYY HH:MM
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    } catch (e) { return iso; }
  }

  // GET /api/sensors/data/last
  async function fetchLastAndUpdate() {
    try {
      const q = currentSensorId ? `?sensor_id=${encodeURIComponent(currentSensorId)}` : '';
      const res = await fetch(`${origin}/api/sensors/data/last${q}`);
      if (!res.ok) return;
      const data = await res.json();
  // Actualizar stats
  if (statAvgTemp) statAvgTemp.textContent = data.temperatura != null ? data.temperatura.toFixed(1) + '°C' : '—';
  if (statAvgHum) statAvgHum.textContent = data.humedad != null ? Math.round(data.humedad) + '%' : '—';
  // No sobrescribimos el contenido de `stat-sensor` (contiene el <select>).
  // Si queremos mostrar el nombre en otro sitio podríamos actualizarlo aquí.

      // Actualizar devices-grid: si alguna tarjeta tiene data-sensor-id igual, rellenar min/max
      deviceCards.forEach(card => {
        const sid = card.getAttribute('data-sensor-id');
        if (sid === currentSensorId) {
          const minSp = card.querySelector('.metric-min');
          const maxSp = card.querySelector('.metric-max');
          const tempSp = card.querySelector('.metric-value.temp');
          const humSp = card.querySelector('.metric-value.hum');
          if (tempSp && data.temperatura != null) tempSp.textContent = data.temperatura.toFixed(1) + '°C';
          if (humSp && data.humedad != null) humSp.textContent = Math.round(data.humedad) + '%';
          if (minSp && data.minT != null) minSp.textContent = 'min: ' + Number(data.minT).toFixed(1) + '°C';
          if (maxSp && data.maxT != null) maxSp.textContent = 'max: ' + Number(data.maxT).toFixed(1) + '°C';
        }
      });
    } catch (e) {
      console.error('fetchLast error', e);
    }
  }

  // GET /api/sensors/data/list?filter=...
  async function fetchListAndPlot(filter = '1h') {
    try {
      const qSensor = currentSensorId ? `&sensor_id=${encodeURIComponent(currentSensorId)}` : '';
      const res = await fetch(`${origin}/api/sensors/data/list?filter=${filter}${qSensor}`);
      if (!res.ok) {
        console.error('list request failed', res.status);
        return;
      }
      const arr = await res.json();
      // ordenar por timestamp asc para graficar (ya lo hace el backend, pero por seguridad)
      arr.sort((a,b) => (a.timestamp||'').localeCompare(b.timestamp||''));

      // Calcular estadísticos globales: max/min y contador
      let globalMaxT = null, globalMaxH = null, globalMinT = null, globalMinH = null;
      arr.forEach(it => {
        if (it.maxT != null) globalMaxT = globalMaxT == null ? Number(it.maxT) : Math.max(globalMaxT, Number(it.maxT));
        if (it.maxH != null) globalMaxH = globalMaxH == null ? Number(it.maxH) : Math.max(globalMaxH, Number(it.maxH));
        if (it.minT != null) globalMinT = globalMinT == null ? Number(it.minT) : Math.min(globalMinT, Number(it.minT));
        if (it.minH != null) globalMinH = globalMinH == null ? Number(it.minH) : Math.min(globalMinH, Number(it.minH));
      });
      // Actualizar cards globales y contador
      const maxTempEl = document.getElementById('global-max-temp');
      const maxHumEl = document.getElementById('global-max-hum');
      const minTempEl = document.getElementById('global-min-temp');
      const minHumEl = document.getElementById('global-min-hum');
      const countEl = document.getElementById('period-count');
      if (maxTempEl) maxTempEl.textContent = globalMaxT != null ? Number(globalMaxT).toFixed(1)+'°C' : '—';
      if (maxHumEl) maxHumEl.textContent = globalMaxH != null ? Number(globalMaxH).toFixed(1)+'%' : '—';
      if (minTempEl) minTempEl.textContent = globalMinT != null ? Number(globalMinT).toFixed(1)+'°C' : '—';
      if (minHumEl) minHumEl.textContent = globalMinH != null ? Number(globalMinH).toFixed(1)+'%' : '—';
      if (countEl) countEl.textContent = arr.length;

      // timestamps array (ISO strings) for per-point decisions in ticks and tooltips
      const timestamps = arr.map(it => it.timestamp || '');
      const temps = arr.map(it => it.avgT != null ? Number(it.avgT) : null);
      const hums = arr.map(it => it.avgH != null ? Number(it.avgH) : null);

      initChart();
      // keep raw timestamps for callbacks
      chart.data._timestamps = timestamps;
      // use timestamps as labels; ticks callback will render them smartly
      chart.data.labels = timestamps;
      chart.data.datasets[0].data = temps;
      chart.data.datasets[1].data = hums;
      // attach raw items for tooltip access
      chart.data._items = arr;
      // ajustar visibilidad de puntos según cantidad de datos
      const n = arr.length;
      chart.data.datasets.forEach(ds => {
        ds.pointRadius = n > 150 ? 0 : 4;
        ds.pointHoverRadius = n > 150 ? 6 : 6;
      });
      chart.update();

      // actualizar alerts-section con listado (descendente)
      updateAlerts(arr.slice().sort((a,b)=> (b.timestamp||'').localeCompare(a.timestamp||'')));
    } catch (e) {
      console.error('fetchList error', e);
    }
  }

  function updateAlerts(list) {
    if (!alertsList) return;
    alertsList.innerHTML = '';
    if (!list || list.length === 0) {
      alertsList.innerHTML = '<div class="empty">No hay registros</div>';
      return;
    }
    list.forEach((it, idx) => {
      const el = document.createElement('div');
      el.className = 'alert-item animate__animated animate__fadeInUp';

      // Content wrapper
      const content = document.createElement('div');
      content.className = 'alert-content';

      // Title: sensor small + timestamp prominent
      const titleRow = document.createElement('div');
      titleRow.style.display = 'flex';
      titleRow.style.alignItems = 'baseline';

      const time = document.createElement('div');
      time.className = 'alert-time';
      time.textContent = prettyTimestamp(it.timestamp || '');
      // make timestamp stand out and align right
      time.style.marginLeft = 0;

      titleRow.appendChild(time);

      content.appendChild(titleRow);

            const rowContainer = document.createElement('div');
      rowContainer.className = 'row';
      rowContainer.style.marginTop = '8px';
      rowContainer.style.display = 'flex';
      rowContainer.style.gap = '12px';

      const tempCol = document.createElement('div');
      tempCol.className = 'col-6';
      tempCol.style.flex = '1';
      tempCol.innerHTML = `
        <div style="font-size:0.85rem; color:#0f172a; font-weight:600;">Temperatura</div>
        <div style="font-size:0.82rem; color:#475569; margin-top:4px;">Promedio: ${it.avgT != null ? String(it.avgT) : '—'}°C</div>
        <div style="font-size:0.82rem; color:#475569;">Máximo: ${it.maxT != null ? String(it.maxT) : '—'}°C</div>
        <div style="font-size:0.82rem; color:#475569;">Mínimo: ${it.minT != null ? String(it.minT) : '—'}°C</div>
      `;

      const humCol = document.createElement('div');
      humCol.className = 'col-6';
      humCol.style.flex = '1';
      humCol.innerHTML = `
        <div style="font-size:0.85rem; color:#0f172a; font-weight:600;">Humedad</div>
        <div style="font-size:0.82rem; color:#475569; margin-top:4px;">Promedio: ${it.avgH != null ? String(it.avgH) : '—'}%</div>
        <div style="font-size:0.82rem; color:#475569;">Máximo: ${it.maxH != null ? String(it.maxH) : '—'}%</div>
        <div style="font-size:0.82rem; color:#475569;">Mínimo: ${it.minH != null ? String(it.minH) : '—'}%</div>
      `;

      rowContainer.appendChild(tempCol);
      rowContainer.appendChild(humCol);
      content.appendChild(rowContainer);

      el.appendChild(content);

      // small stagger
      el.style.animationDelay = (idx * 30) + 'ms';
      alertsList.appendChild(el);
    });
  }

  // Add animate.css entry animations to major cards with slight stagger
  function animateEntrance() {
    const selectors = ['.stat-card', '.device-card', '.chart-card', '.alerts-section'];
    let delay = 0;
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.classList.add('animate__animated', 'animate__fadeInUp');
        el.style.setProperty('--animate-duration', '0.6s');
        el.style.animationDelay = (delay) + 'ms';
        delay += 80;
      });
    });
  }

  // time button handling
  function setupTimeButtons() {
    const map = { '1H': '1h', '24H': '24h', '7D': '7d', '30D': '30d' };
    document.querySelectorAll('.time-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const txt = btn.textContent.trim().toUpperCase();
        const f = map[txt] || '1h';
        currentFilter = f;
        fetchListAndPlot(f);
      });
    });
  }

  // Cargar listado de sensores desde el backend y poblar el select
  async function loadSensors() {
    try {
      const res = await fetch(`${origin}/api/sensors/info`);
      if (!res.ok) return;
      const list = await res.json();
      const sel = document.getElementById('sensor-select');
      if (!sel) return;
      sel.innerHTML = '';
      if (!Array.isArray(list) || list.length === 0) {
        sel.innerHTML = '<option value="">(no hay sensores)</option>';
        return;
      }
      list.forEach((s, idx) => {
        const opt = document.createElement('option');
        opt.value = s.sensor_id;
        opt.textContent = s.name || s.sensor_id;
        sel.appendChild(opt);
        if (idx === 0) {
          currentSensorId = s.sensor_id;
          currentSensorName = s.name || s.sensor_id;
        }
      });

      // construir mapa local de metadatos
      list.forEach(s => { sensorInfoMap[s.sensor_id] = s; });

      // seleccionar el primero y disparar carga inicial
      sel.value = currentSensorId;
      sensorSelectEl = sel;
      // mostrar nombre e id en la tarjeta grande
      if (statSensorNameEl) statSensorNameEl.textContent = currentSensorName || currentSensorId || '—';
      if (statSensorIdEl) {
        const loc = (sensorInfoMap[currentSensorId] && sensorInfoMap[currentSensorId].location) || '';
        statSensorIdEl.innerHTML = `${currentSensorId || ''}${loc ? `<div class="stat-location" style="margin-top:6px; font-size:0.85rem;">${loc}</div>` : ''}`;
      }
      sel.addEventListener('change', (e) => {
        currentSensorId = e.target.value;
        const selected = list.find(x=>x.sensor_id===currentSensorId);
        currentSensorName = selected ? (selected.name || selected.sensor_id) : currentSensorId;
        if (statSensorNameEl) statSensorNameEl.textContent = currentSensorName || currentSensorId || '—';
        if (statSensorIdEl) {
          const loc = (selected && selected.location) || (sensorInfoMap[currentSensorId] && sensorInfoMap[currentSensorId].location) || '';
          statSensorIdEl.innerHTML = `${currentSensorId || ''}${loc ? `<div class="stat-location" style="margin-top:6px; font-size:0.85rem;">${loc}</div>` : ''}`;
        }
        // refrescar la info manteniendo el filtro actual
        fetchLastAndUpdate();
        fetchListAndPlot(currentFilter || '1h');
      });

      // Inicializar primeras cargas
      fetchLastAndUpdate();
      fetchListAndPlot(currentFilter || '1h');
    } catch (e) {
      console.error('loadSensors error', e);
    }
  }

  // Inicialización
  document.addEventListener('DOMContentLoaded', () => {
  initChart();
  setupTimeButtons();
  // default 1h
  const defaultBtn = Array.from(document.querySelectorAll('.time-btn')).find(b => b.textContent.trim().toUpperCase() === '1H');
  if (defaultBtn) { document.querySelectorAll('.time-btn').forEach(b=>b.classList.remove('active')); defaultBtn.classList.add('active'); }
  // cargar sensores y luego inicializar el dashboard con el primero
  loadSensors();
  // run entrance animations
  animateEntrance();
  });

  // Envío de formulario para crear dispositivo
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('form-nuevo-dispositivo');
    const resultBox = document.getElementById('result-message');
    if (!form) return; // Evita errores si este script carga en otra vista

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      resultBox.classList.remove('success', 'error');
      resultBox.textContent = '';

      const payload = {
        id: document.getElementById('deviceId').value.trim(),
        nombre: document.getElementById('deviceName').value.trim(),
        tipo: document.getElementById('deviceType').value.trim(),
        ubicacion: document.getElementById('deviceLocation').value.trim(),
        estado: document.getElementById('deviceStatus').value
      };

      try {
        const res = await fetch('/api/dispositivos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok) {
          resultBox.textContent = data.message || '¡Dispositivo registrado!';
          resultBox.classList.add('success');
          resultBox.classList.remove('hidden');

          // Redirige después de unos segundos
          setTimeout(() => {
            window.location.href = '/dispositivos';
          }, 1500);
        } else {
          resultBox.textContent = data.error || 'Error al registrar.';
          resultBox.classList.add('error');
          resultBox.classList.remove('hidden');
        }
      } catch (err) {
        resultBox.textContent = 'Error al conectar con el servidor.';
        resultBox.classList.add('error');
        resultBox.classList.remove('hidden');
      }
    });


  });


})();
