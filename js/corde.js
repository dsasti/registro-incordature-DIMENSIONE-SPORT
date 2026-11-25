const toastEl = document.getElementById('toast');

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let allStringsCache = [];

async function loadStrings() {
  const res = await fetch('/api/strings');
  const data = await res.json();
  allStringsCache = data.corde || [];
  renderStrings();
}

function renderStrings() {
  const query = (document.getElementById('stringsSearchInput')?.value || '').trim().toLowerCase();
  const sortMode = document.getElementById('stringsSortSelect')?.value || 'name_asc';

  let list = allStringsCache.filter(item => {
    if (!query) return true;
    const nameMatch = (item.nome || '').toLowerCase().includes(query);
    const priceStr = item.prezzo !== null && item.prezzo !== undefined ? String(item.prezzo) : '';
    const priceMatch = priceStr.includes(query.replace(',', '.'));
    return nameMatch || priceMatch;
  });

  list.sort((a, b) => {
    if (sortMode === 'name_desc') return b.nome.localeCompare(a.nome, 'it');
    if (sortMode === 'price_asc') return (a.prezzo ?? 999999) - (b.prezzo ?? 999999);
    if (sortMode === 'price_desc') return (b.prezzo ?? -1) - (a.prezzo ?? -1);
    return a.nome.localeCompare(b.nome, 'it');
  });

  document.getElementById('stringsCount').textContent = list.length;

  const tbody = document.getElementById('stringsTableBody');
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">Nessuna corda trovata</td></tr>';
    return;
  }

  tbody.innerHTML = list
    .map(
      item => {
        const isConv = /convenzione/i.test(item.nome || '');
        return `
      <tr>
        <td>
          <input
            type="text"
            class="name-edit-input"
            data-old-name="${escapeHtml(item.nome)}"
            value="${escapeHtml(item.nome)}"
            style="width:100%; font-weight:700; padding:6px 8px; border:1px solid var(--border); border-radius:6px;"
          />
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:6px;">
            <span>€</span>
            <input
              type="number"
              step="0.01"
              min="0"
              class="price-edit-input"
              data-name="${escapeHtml(item.nome)}"
              value="${item.prezzo !== null && item.prezzo !== undefined ? item.prezzo : ''}"
              placeholder="-"
              style="width:90px; padding:6px 8px; border:1px solid var(--border); border-radius:6px;"
            />
          </div>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:6px;">
            <input
              type="number"
              step="${isConv ? '1' : '0.5'}"
              min="0"
              class="residuo-edit-input"
              data-name="${escapeHtml(item.nome)}"
              value="${item.residuo !== null && item.residuo !== undefined ? item.residuo : ''}"
              placeholder="-"
              style="width:76px; padding:6px 8px; border:1px solid var(--border); border-radius:6px; font-weight:700;"
            />
            <span style="font-size:0.78rem; color:var(--text-muted);">${isConv ? 'matasse' : 'corde'}</span>
          </div>
        </td>
        <td style="text-align:right;">
          <button class="btn btn-danger btn-sm" data-del="${escapeHtml(item.nome)}">✕</button>
        </td>
      </tr>
    `;
      }
    )
    .join('');

  tbody.querySelectorAll('.name-edit-input').forEach(inp => {
    inp.addEventListener('change', async () => {
      const oldName = inp.dataset.oldName;
      const newName = inp.value.trim();
      if (!newName) {
        inp.value = oldName;
        return;
      }
      const r = await fetch(`/api/strings/${encodeURIComponent(oldName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: newName })
      });
      if (r.ok) {
        showToast(`Nome aggiornato: ${newName.toUpperCase()}`);
        loadStrings();
      }
    });
  });

  tbody.querySelectorAll('.price-edit-input').forEach(inp => {
    inp.addEventListener('change', async () => {
      const name = inp.dataset.name;
      const r = await fetch(`/api/strings/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prezzo: inp.value })
      });
      if (r.ok) {
        showToast(`Prezzo aggiornato per ${name}`);
        loadStrings();
      }
    });
  });

  tbody.querySelectorAll('.residuo-edit-input').forEach(inp => {
    inp.addEventListener('change', async () => {
      const name = inp.dataset.name;
      const r = await fetch(`/api/strings/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residuo: inp.value })
      });
      if (r.ok) {
        showToast(`Residuo aggiornato per ${name}`);
        loadStrings();
      }
    });
  });

  tbody.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.del;
      if (!confirm(`Rimuovere "${name}" dall'elenco?`)) return;
      const r = await fetch(`/api/strings/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (r.ok) {
        showToast('Corda rimossa');
        loadStrings();
      }
    };
  });
}

document.getElementById('toggleCordeListHeader')?.addEventListener('click', () => {
  const body = document.getElementById('cordeListBody');
  const icon = document.getElementById('cordeListIcon');
  const hidden = body?.classList.toggle('hidden');
  if (icon) icon.textContent = hidden ? '▸' : '▾';
});

document.getElementById('stringsSearchInput')?.addEventListener('input', renderStrings);
document.getElementById('stringsSortSelect')?.addEventListener('change', renderStrings);

document.getElementById('addStringForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = document.getElementById('newStringName');
  const priceInput = document.getElementById('newStringPrice');
  const nome = input.value.trim();
  if (!nome) return;

  const res = await fetch('/api/strings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, prezzo: priceInput.value })
  });

  if (res.ok) {
    input.value = '';
    priceInput.value = '';
    showToast('Corda aggiunta!');
    loadStrings();
  }
});

loadStrings();
