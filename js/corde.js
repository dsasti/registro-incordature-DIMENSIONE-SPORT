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

async function loadStrings() {
  const res = await fetch('/api/strings');
  const data = await res.json();
  const corde = data.corde || [];
  document.getElementById('stringsCount').textContent = corde.length;

  const tbody = document.getElementById('stringsTableBody');
  if (corde.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);">Nessuna corda presente</td></tr>';
    return;
  }

  tbody.innerHTML = corde
    .map(
      item => `
      <tr>
        <td><strong>${escapeHtml(item.nome)}</strong></td>
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
              style="width:100px; padding:6px 8px; border:1px solid var(--border); border-radius:6px;"
            />
          </div>
        </td>
        <td style="text-align:right;">
          <button class="btn btn-danger btn-sm" data-del="${escapeHtml(item.nome)}">✕</button>
        </td>
      </tr>
    `
    )
    .join('');

  tbody.querySelectorAll('.price-edit-input').forEach(inp => {
    inp.addEventListener('change', async () => {
      const name = inp.dataset.name;
      const r = await fetch(`/api/strings/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prezzo: inp.value })
      });
      if (r.ok) showToast(`Prezzo aggiornato per ${name}`);
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
