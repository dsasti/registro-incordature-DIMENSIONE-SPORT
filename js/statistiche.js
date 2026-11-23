let allRecords = [];
let currentFilter = 'currentYear';
let selectedYear = new Date().getFullYear();
let sortCol = 'data';
let sortDir = 'desc';

const MONTH_NAMES = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

function formatDateIT(isoDate) {
  if (!isoDate) return '-';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatEuro(val) {
  if (val === null || val === undefined || val === '') return '-';
  const num = Number(val);
  if (Number.isNaN(num)) return '-';
  return num.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

function formatTensionDisplay(val) {
  const clean = String(val ?? '').trim();
  if (!clean) return '-';
  return `${clean.replace(/\s*kg$/i, '')} Kg`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function init() {
  const res = await fetch('/api/clients?includeDeleted=1');
  const data = await res.json();
  const clienti = data.clienti || [];

  allRecords = [];
  const yearsSet = new Set([new Date().getFullYear(), new Date().getFullYear() - 1]);

  clienti.forEach(c => {
    const clientName = `${c.cognome} ${c.nome}`.trim();
    (c.incordature || []).forEach(inc => {
      if (inc.data && inc.data.length >= 4) {
        yearsSet.add(Number(inc.data.slice(0, 4)));
      }
      allRecords.push({
        clientId: c.id,
        clientName,
        data: inc.data || '',
        racchetta: inc.racchetta || '',
        cordeVerticali: inc.cordeVerticali || '',
        cordeOrizzontali: inc.cordeOrizzontali || '',
        tensioneVerticali: inc.tensioneVerticali || '',
        tensioneOrizzontali: inc.tensioneOrizzontali || '',
        prezzo: inc.prezzo !== null && inc.prezzo !== undefined && inc.prezzo !== '' ? Number(inc.prezzo) : Number(c.prezzoDefault || 0),
        cordaPropriaV: Boolean(inc.cordaPropriaV),
        cordaPropriaO: Boolean(inc.cordaPropriaO),
        inConvenzione:
          Boolean(inc.inConvenzione) ||
          /convenzione/i.test(inc.cordeVerticali || '') ||
          /convenzione/i.test(inc.cordeOrizzontali || ''),
        note: inc.note || ''
      });
    });
  });

  // Sort newest first
  allRecords.sort((a, b) => b.data.localeCompare(a.data));

  // Populate yearSelect & compare years
  const yearSelect = document.getElementById('yearSelect');
  const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);
  const yearOpts = sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
  yearSelect.innerHTML = yearOpts;
  yearSelect.value = String(selectedYear);

  const curY = new Date().getFullYear();
  const cmpA = document.getElementById('compareYearA');
  const cmpB = document.getElementById('compareYearB');
  if (cmpA && cmpB) {
    cmpA.innerHTML = yearOpts;
    cmpB.innerHTML = yearOpts;
    cmpA.value = String(curY);
    cmpB.value = String(sortedYears.includes(curY - 1) ? curY - 1 : sortedYears[0]);
  }
  const sA = document.getElementById('compareStartA');
  const eA = document.getElementById('compareEndA');
  const sB = document.getElementById('compareStartB');
  const eB = document.getElementById('compareEndB');
  if (sA && eA && sB && eB) {
    sA.value = `${curY}-01-01`;
    eA.value = `${curY}-12-31`;
    sB.value = `${curY - 1}-01-01`;
    eB.value = `${curY - 1}-12-31`;
  }

  render();
  renderComparison();
}

function getFilteredRecordsAndMonths() {
  const now = new Date();
  const currentYear = now.getFullYear();

  if (currentFilter === 'last12') {
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ key: ym, label: `${MONTH_NAMES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` });
    }
    const minKey = months[0].key;
    const maxKey = months[months.length - 1].key;
    const filtered = allRecords.filter(r => {
      const ym = (r.data || '').slice(0, 7);
      return ym >= minKey && ym <= maxKey;
    });
    return { filtered, months };
  }

  const targetYear =
    currentFilter === 'currentYear'
      ? currentYear
      : currentFilter === 'lastCalendarYear'
      ? currentYear - 1
      : Number(selectedYear);

  const months = MONTH_NAMES.map((m, idx) => ({
    key: `${targetYear}-${String(idx + 1).padStart(2, '0')}`,
    label: m
  }));

  const filtered = allRecords.filter(r => (r.data || '').startsWith(String(targetYear)));
  return { filtered, months };
}

function render() {
  const { filtered, months } = getFilteredRecordsAndMonths();

  // KPIs
  const metrics = computeMetrics(filtered);
  document.getElementById('kpiCount').textContent = metrics.count;
  document.getElementById('kpiRevenue').textContent = formatEuro(metrics.totalRevenue);
  document.getElementById('kpiAvgPrice').textContent = formatEuro(metrics.avgPrice);
  document.getElementById('kpiClients').textContent = metrics.uniqueClients;
  document.getElementById('kpiCordaPropria').textContent = metrics.cordaPropriaCount;
  document.getElementById('kpiConvenzioniCount').textContent = metrics.convenzioniCount;
  document.getElementById('kpiCordaPropriaRevenue').textContent = formatEuro(metrics.cordaPropriaRevenue);
  document.getElementById('kpiConvenzioniRevenue').textContent = formatEuro(metrics.convenzioniRevenue);

  // Bar Chart
  const cmp = getComparisonData();
  const chartEl = document.getElementById('monthlyBarChart');
  let legendEl = document.getElementById('monthlyCompareLegend');
  if (!legendEl && chartEl?.parentElement) {
    legendEl = document.createElement('div');
    legendEl.id = 'monthlyCompareLegend';
    legendEl.style.cssText = 'display:flex; gap:16px; font-size:0.85rem; margin-bottom:10px;';
    chartEl.parentElement.insertBefore(legendEl, chartEl);
  }

  if (cmp.active) {
    if (legendEl) {
      legendEl.classList.remove('hidden');
      legendEl.innerHTML = `
        <span style="color:var(--primary); font-weight:700;">■ ${escapeHtml(cmp.labelA)}</span>
        <span style="color:#2563eb; font-weight:700;">■ ${escapeHtml(cmp.labelB)}</span>
      `;
    }
    const countsA = Array(12).fill(0);
    const countsB = Array(12).fill(0);
    cmp.recA.forEach(r => {
      const m = Number((r.data || '').slice(5, 7));
      if (m >= 1 && m <= 12) countsA[m - 1] += 1;
    });
    cmp.recB.forEach(r => {
      const m = Number((r.data || '').slice(5, 7));
      if (m >= 1 && m <= 12) countsB[m - 1] += 1;
    });
    const maxVal = Math.max(1, ...countsA, ...countsB);
    chartEl.innerHTML = MONTH_NAMES.map((label, idx) => {
      const vA = countsA[idx];
      const vB = countsB[idx];
      const pA = Math.round((vA / maxVal) * 100);
      const pB = Math.round((vB / maxVal) * 100);
      return `
        <div class="bar-col">
          <div class="bar-value" style="font-size:0.72rem;">${vA}/${vB}</div>
          <div style="display:flex; align-items:flex-end; justify-content:center; gap:3px; width:100%; height:100%;">
            <div class="bar-fill" style="width:45%; height:${Math.max(3, pA)}%;" title="${escapeHtml(cmp.labelA)} - ${label}: ${vA}"></div>
            <div class="bar-fill" style="width:45%; height:${Math.max(3, pB)}%; background:#2563eb;" title="${escapeHtml(cmp.labelB)} - ${label}: ${vB}"></div>
          </div>
          <div class="bar-label">${label}</div>
        </div>
      `;
    }).join('');
  } else {
    if (legendEl) legendEl.classList.add('hidden');
    const countsByMonth = {};
    months.forEach(m => (countsByMonth[m.key] = 0));
    filtered.forEach(r => {
      const ym = (r.data || '').slice(0, 7);
      if (countsByMonth[ym] !== undefined) countsByMonth[ym] += 1;
    });

    const maxVal = Math.max(1, ...Object.values(countsByMonth));
    chartEl.innerHTML = months
      .map(m => {
        const val = countsByMonth[m.key] || 0;
        const pct = Math.round((val / maxVal) * 100);
        return `
          <div class="bar-col">
            <div class="bar-value">${val}</div>
            <div class="bar-fill" style="height: ${Math.max(3, pct)}%;" title="${m.label}: ${val} incordature"></div>
            <div class="bar-label">${m.label}</div>
          </div>
        `;
      })
      .join('');
  }

  // Top Strings (0.5 per verticali, 0.5 per orizzontali)
  const buildStringMap = recs => {
    const map = {};
    recs.forEach(r => {
      const addStr = (raw, isPropria) => {
        const clean = (raw || '').trim();
        if (!clean) return;
        let key = clean.toUpperCase();
        if (isPropria && !key.includes('CORDA DEL CLIENTE')) {
          key = `${key} (Corda del cliente)`;
        }
        map[key] = (map[key] || 0) + 0.5;
      };
      addStr(r.cordeVerticali, r.cordaPropriaV);
      addStr(r.cordeOrizzontali, r.cordaPropriaO);
    });
    return map;
  };

  const topStringsBody = document.getElementById('topStringsBody');
  if (cmp.active) {
    const mapA = buildStringMap(cmp.recA);
    const mapB = buildStringMap(cmp.recB);
    const allKeys = Array.from(new Set([...Object.keys(mapA), ...Object.keys(mapB)]));
    allKeys.sort((a, b) => (mapA[b] || 0) + (mapB[b] || 0) - ((mapA[a] || 0) + (mapB[a] || 0)));
    if (allKeys.length === 0) {
      topStringsBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">Nessun dato sulle corde nei periodi selezionati</td></tr>';
    } else {
      const maxStr = Math.max(1, ...allKeys.map(k => Math.max(mapA[k] || 0, mapB[k] || 0)));
      topStringsBody.innerHTML = allKeys
        .map((name, idx) => {
          const cA = mapA[name] || 0;
          const cB = mapB[name] || 0;
          const pA = Math.round((cA / maxStr) * 100);
          const pB = Math.round((cB / maxStr) * 100);
          return `
            <tr>
              <td><strong>${idx + 1}</strong></td>
              <td>${escapeHtml(name)}</td>
              <td><strong style="color:var(--primary);">${cA}</strong> / <strong style="color:#2563eb;">${cB}</strong></td>
              <td>
                <div class="strings-bar-bg" style="margin-bottom:4px;">
                  <div class="strings-bar-fill" style="width:${pA}%"></div>
                </div>
                <div class="strings-bar-bg">
                  <div class="strings-bar-fill" style="width:${pB}%; background:#2563eb;"></div>
                </div>
              </td>
            </tr>
          `;
        })
        .join('');
    }
  } else {
    const stringCounts = buildStringMap(filtered);
    const sortedStrings = Object.entries(stringCounts).sort((a, b) => b[1] - a[1]);
    if (sortedStrings.length === 0) {
      topStringsBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">Nessun dato sulle corde nel periodo selezionato</td></tr>';
    } else {
      const maxStr = sortedStrings[0][1];
      topStringsBody.innerHTML = sortedStrings
        .map(([name, count], idx) => {
          const pct = Math.round((count / maxStr) * 100);
          return `
            <tr>
              <td><strong>${idx + 1}</strong></td>
              <td>${escapeHtml(name)}</td>
              <td><strong>${count}</strong></td>
              <td>
                <div class="strings-bar-bg">
                  <div class="strings-bar-fill" style="width:${pct}%"></div>
                </div>
              </td>
            </tr>
          `;
        })
        .join('');
    }
  }

  // All Incordature Table (sorted)
  const sortedRows = [...filtered].sort((a, b) => {
    let va, vb;
    if (sortCol === 'prezzo') {
      va = Number(a.prezzo || 0);
      vb = Number(b.prezzo || 0);
      return sortDir === 'asc' ? va - vb : vb - va;
    }
    if (sortCol === 'corde') {
      va = `${a.cordeVerticali} / ${a.cordeOrizzontali}`;
      vb = `${b.cordeVerticali} / ${b.cordeOrizzontali}`;
    } else if (sortCol === 'tensione') {
      va = `${a.tensioneVerticali} / ${a.tensioneOrizzontali}`;
      vb = `${b.tensioneVerticali} / ${b.tensioneOrizzontali}`;
    } else {
      va = String(a[sortCol] || '');
      vb = String(b[sortCol] || '');
    }
    const cmp = va.localeCompare(vb, 'it', { sensitivity: 'base' });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const tbody = document.getElementById('allIncordatureBody');
  if (sortedRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">Nessuna incordatura trovata nel periodo selezionato</td></tr>';
  } else {
    tbody.innerHTML = sortedRows
      .map(
        r => `
        <tr>
          <td>${formatDateIT(r.data)}</td>
          <td><strong>${escapeHtml(r.clientName)}</strong></td>
          <td>${escapeHtml(r.racchetta || '-')}</td>
          <td>${escapeHtml(r.cordeVerticali || '-')} / ${escapeHtml(r.cordeOrizzontali || '-')}</td>
          <td>${escapeHtml(formatTensionDisplay(r.tensioneVerticali))} / ${escapeHtml(formatTensionDisplay(r.tensioneOrizzontali))}</td>
          <td>${formatEuro(r.prezzo)}</td>
          <td>${escapeHtml(r.note || '-')}</td>
        </tr>
      `
      )
      .join('');
  }
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

document.getElementById('yearSelect').addEventListener('change', e => {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  currentFilter = 'specificYear';
  selectedYear = Number(e.target.value);
  render();
});

[
  ['toggleMonthlyHeader', 'monthlyBody', 'monthlyToggleIcon'],
  ['toggleStringsHeader', 'stringsBody', 'stringsToggleIcon'],
  ['toggleListHeader', 'listBody', 'listToggleIcon']
].forEach(([headerId, bodyId, iconId]) => {
  document.getElementById(headerId).addEventListener('click', () => {
    const isHidden = document.getElementById(bodyId).classList.toggle('hidden');
    document.getElementById(iconId).textContent = isHidden ? '▸' : '▾';
  });
});

document.querySelectorAll('#allIncordatureTable th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = col === 'data' || col === 'prezzo' ? 'desc' : 'asc';
    }
    document.querySelectorAll('#allIncordatureTable th[data-sort] .sort-ind').forEach(sp => (sp.textContent = ''));
    th.querySelector('.sort-ind').textContent = sortDir === 'asc' ? '▲' : '▼';
    render();
  });
});

function computeMetrics(records) {
  const count = records.length;
  const totalRevenue = records.reduce((sum, r) => sum + (Number.isNaN(r.prezzo) ? 0 : r.prezzo), 0);
  const avgPrice = count > 0 ? totalRevenue / count : 0;
  const uniqueClients = new Set(records.map(r => r.clientId)).size;
  const cordaPropriaRecs = records.filter(r => r.cordaPropriaV || r.cordaPropriaO);
  const cordaPropriaCount = cordaPropriaRecs.length;
  const cordaPropriaRevenue = cordaPropriaRecs.reduce((sum, r) => sum + (Number.isNaN(r.prezzo) ? 0 : r.prezzo), 0);
  const convenzioniRecs = records.filter(r => r.inConvenzione);
  const convenzioniCount = convenzioniRecs.length;
  const convenzioniRevenue = convenzioniRecs.reduce((sum, r) => sum + (Number.isNaN(r.prezzo) ? 0 : r.prezzo), 0);
  return {
    count,
    totalRevenue,
    avgPrice,
    uniqueClients,
    cordaPropriaCount,
    cordaPropriaRevenue,
    convenzioniCount,
    convenzioniRevenue
  };
}

function getComparisonData() {
  const card = document.getElementById('compareCard');
  const active = Boolean(card && !card.classList.contains('hidden'));
  const mode = document.getElementById('compareModeSelect')?.value || 'years';
  let recA = [];
  let recB = [];
  let labelA = 'Periodo A';
  let labelB = 'Periodo B';

  if (mode === 'years') {
    const yA = document.getElementById('compareYearA')?.value || '';
    const yB = document.getElementById('compareYearB')?.value || '';
    labelA = `Anno ${yA}`;
    labelB = `Anno ${yB}`;
    recA = allRecords.filter(r => (r.data || '').startsWith(yA));
    recB = allRecords.filter(r => (r.data || '').startsWith(yB));
  } else {
    const sA = document.getElementById('compareStartA')?.value || '';
    const eA = document.getElementById('compareEndA')?.value || '';
    const sB = document.getElementById('compareStartB')?.value || '';
    const eB = document.getElementById('compareEndB')?.value || '';
    labelA = `${formatDateIT(sA)} → ${formatDateIT(eA)}`;
    labelB = `${formatDateIT(sB)} → ${formatDateIT(eB)}`;
    recA = allRecords.filter(r => (!sA || r.data >= sA) && (!eA || r.data <= eA));
    recB = allRecords.filter(r => (!sB || r.data >= sB) && (!eB || r.data <= eB));
  }
  return { active, recA, recB, labelA, labelB };
}

function renderComparison() {
  const tbody = document.getElementById('compareTableBody');
  if (!tbody) return;
  const { recA, recB, labelA, labelB } = getComparisonData();

  document.getElementById('compareHeaderA').textContent = labelA;
  document.getElementById('compareHeaderB').textContent = labelB;

  const mA = computeMetrics(recA);
  const mB = computeMetrics(recB);

  const fmtDiff = (a, b, isEuro) => {
    const d = a - b;
    const sign = d > 0 ? '+' : '';
    const pct = b !== 0 ? ` (${sign}${((d / b) * 100).toFixed(1)}%)` : '';
    const valStr = isEuro ? `${sign}${formatEuro(d)}` : `${sign}${d}`;
    const color = d > 0 ? 'color:#15803d;' : d < 0 ? 'color:#b91c1c;' : '';
    return `<span style="font-weight:700; ${color}">${valStr}${pct}</span>`;
  };

  const rows = [
    { label: 'Incordature totali', a: mA.count, b: mB.count, euro: false },
    { label: 'Incasso totale', a: mA.totalRevenue, b: mB.totalRevenue, euro: true },
    { label: 'Spesa media per incordatura', a: mA.avgPrice, b: mB.avgPrice, euro: true },
    { label: 'Clienti attivi', a: mA.uniqueClients, b: mB.uniqueClients, euro: false },
    { label: 'Incordature con corda propria', a: mA.cordaPropriaCount, b: mB.cordaPropriaCount, euro: false },
    { label: 'Incasso con corda propria', a: mA.cordaPropriaRevenue, b: mB.cordaPropriaRevenue, euro: true },
    { label: 'Incordature da convenzioni', a: mA.convenzioniCount, b: mB.convenzioniCount, euro: false },
    { label: 'Incasso da convenzioni', a: mA.convenzioniRevenue, b: mB.convenzioniRevenue, euro: true }
  ];

  tbody.innerHTML = rows
    .map(
      row => `
      <tr>
        <td><strong>${row.label}</strong></td>
        <td>${row.euro ? formatEuro(row.a) : row.a}</td>
        <td>${row.euro ? formatEuro(row.b) : row.b}</td>
        <td>${fmtDiff(row.a, row.b, row.euro)}</td>
      </tr>
    `
    )
    .join('');
}

document.getElementById('btnToggleCompare')?.addEventListener('click', () => {
  const card = document.getElementById('compareCard');
  card?.classList.toggle('hidden');
  renderComparison();
  render();
});

document.getElementById('compareModeSelect')?.addEventListener('change', e => {
  const isYears = e.target.value === 'years';
  document.getElementById('compareYearsWrap')?.classList.toggle('hidden', !isYears);
  document.getElementById('compareDatesWrap')?.classList.toggle('hidden', isYears);
  renderComparison();
  render();
});

['compareYearA', 'compareYearB', 'compareStartA', 'compareEndA', 'compareStartB', 'compareEndB'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => {
    renderComparison();
    render();
  });
});

document.getElementById('kpiCountBox')?.addEventListener('click', () => {
  const det = document.getElementById('kpiCountDetails');
  const arr = document.getElementById('kpiCountArrow');
  const hidden = det?.classList.toggle('hidden');
  if (arr) arr.textContent = hidden ? '▾' : '▴';
});

document.getElementById('kpiRevenueBox')?.addEventListener('click', () => {
  const det = document.getElementById('kpiRevenueDetails');
  const arr = document.getElementById('kpiRevenueArrow');
  const hidden = det?.classList.toggle('hidden');
  if (arr) arr.textContent = hidden ? '▾' : '▴';
});

init();
