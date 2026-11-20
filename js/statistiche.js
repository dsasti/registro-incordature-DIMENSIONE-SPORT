let allRecords = [];
let currentFilter = 'last12';
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
        note: inc.note || ''
      });
    });
  });

  // Sort newest first
  allRecords.sort((a, b) => b.data.localeCompare(a.data));

  // Populate yearSelect
  const yearSelect = document.getElementById('yearSelect');
  const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);
  yearSelect.innerHTML = sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
  yearSelect.value = String(selectedYear);

  render();
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
  const totalRevenue = filtered.reduce((sum, r) => sum + (Number.isNaN(r.prezzo) ? 0 : r.prezzo), 0);
  const uniqueClients = new Set(filtered.map(r => r.clientId)).size;
  const cordaPropriaCount = filtered.filter(r => r.cordaPropriaV || r.cordaPropriaO).length;
  document.getElementById('kpiCount').textContent = filtered.length;
  document.getElementById('kpiRevenue').textContent = formatEuro(totalRevenue);
  document.getElementById('kpiClients').textContent = uniqueClients;
  document.getElementById('kpiCordaPropria').textContent = cordaPropriaCount;

  // Bar Chart
  const countsByMonth = {};
  months.forEach(m => (countsByMonth[m.key] = 0));
  filtered.forEach(r => {
    const ym = (r.data || '').slice(0, 7);
    if (countsByMonth[ym] !== undefined) countsByMonth[ym] += 1;
  });

  const maxVal = Math.max(1, ...Object.values(countsByMonth));
  const chartEl = document.getElementById('monthlyBarChart');
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

  // Top Strings (0.5 per verticali, 0.5 per orizzontali)
  const stringCounts = {};
  filtered.forEach(r => {
    const addStr = (raw, isPropria) => {
      const clean = (raw || '').trim();
      if (!clean) return;
      let key = clean.toUpperCase();
      if (isPropria && !key.includes('CORDA DEL CLIENTE')) {
        key = `${key} (Corda del cliente)`;
      }
      stringCounts[key] = (stringCounts[key] || 0) + 0.5;
    };
    addStr(r.cordeVerticali, r.cordaPropriaV);
    addStr(r.cordeOrizzontali, r.cordaPropriaO);
  });

  const sortedStrings = Object.entries(stringCounts).sort((a, b) => b[1] - a[1]);
  const topStringsBody = document.getElementById('topStringsBody');
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

init();
