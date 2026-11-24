const authSection = document.getElementById('authSection');
const clientSection = document.getElementById('clientSection');
const registerForm = document.getElementById('registerForm');
const loginForm = document.getElementById('loginForm');
const forgotForm = document.getElementById('forgotForm');
const tabRegister = document.getElementById('tabRegister');
const tabLogin = document.getElementById('tabLogin');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatEuro(val) {
  if (val === null || val === undefined || val === '') return '-';
  const num = Number(val);
  if (Number.isNaN(num)) return '-';
  return num.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

function formatDateIT(iso) {
  if (!iso) return '-';
  const p = String(iso).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

tabRegister.addEventListener('click', () => {
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  registerForm.classList.remove('hidden');
  loginForm.classList.add('hidden');
  forgotForm.classList.add('hidden');
});

tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  loginForm.classList.remove('hidden');
  registerForm.classList.add('hidden');
  forgotForm.classList.add('hidden');
});

document.getElementById('btnShowForgot')?.addEventListener('click', () => {
  loginForm.classList.add('hidden');
  forgotForm.classList.remove('hidden');
});

document.getElementById('btnBackToLogin')?.addEventListener('click', () => {
  forgotForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
});

let checkTimer = null;
async function checkExistingClient() {
  const nome = document.getElementById('regNome').value.trim();
  const cognome = document.getElementById('regCognome').value.trim();
  const banner = document.getElementById('regCheckBanner');
  const phoneReq = document.getElementById('regPhoneReq');
  const phoneInput = document.getElementById('regTelefono');

  if (!nome || !cognome) {
    banner.classList.add('hidden');
    return;
  }

  try {
    const res = await fetch('/api/portal/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, cognome })
    });
    const data = await res.json();
    banner.classList.remove('hidden', 'ok', 'warn', 'err');
    if (data.found) {
      if (data.alreadyRegistered) {
        banner.classList.add('warn');
        banner.textContent = '✓ Cliente già presente e già registrato! Usa la scheda "Accedi".';
      } else {
        banner.classList.add('ok');
        banner.textContent = '✓ Scheda cliente già presente nel registro!';
      }
      if (data.hasPhone) {
        phoneReq.textContent = '(già salvato, opzionale)';
        phoneInput.required = false;
      } else {
        phoneReq.textContent = '* (richiesto)';
        phoneInput.required = true;
      }
    } else {
      banner.classList.add('warn');
      banner.textContent = 'Scheda non trovata: verifica Nome e Cognome o chiedi in negozio.';
    }
  } catch (_) {
    banner.classList.add('hidden');
  }
}

['regNome', 'regCognome'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(checkExistingClient, 250);
  });
  el.addEventListener('blur', checkExistingClient);
});

document.querySelectorAll('.toggle-pwd-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const inp = document.getElementById(btn.dataset.target);
    if (!inp) return;
    const isPwd = inp.type === 'password';
    inp.type = isPwd ? 'text' : 'password';
    btn.textContent = isPwd ? '🙈' : '👁️';
  });
});

registerForm.addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('regError');
  errEl.classList.add('hidden');

  const payload = {
    nome: document.getElementById('regNome').value.trim(),
    cognome: document.getElementById('regCognome').value.trim(),
    telefono: document.getElementById('regTelefono').value.trim(),
    dataNascita: document.getElementById('regDob').value,
    password: document.getElementById('regPassword').value
  };

  const res = await fetch('/api/portal/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error || 'Errore durante la registrazione.';
    errEl.classList.remove('hidden');
    return;
  }
  loadPortalClient();
});

forgotForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('forError');
  errEl.classList.add('hidden');

  const res = await fetch('/api/portal/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome: document.getElementById('forNome').value.trim(),
      cognome: document.getElementById('forCognome').value.trim(),
      telefono: document.getElementById('forTelefono').value.trim(),
      dataNascita: document.getElementById('forDob').value,
      newPassword: document.getElementById('forNewPassword').value
    })
  });
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error || 'Errore durante il reset della password.';
    errEl.classList.remove('hidden');
    return;
  }
  loadPortalClient();
});

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('logError');
  errEl.classList.add('hidden');

  let identifier = document.getElementById('logIdentifier').value.trim();
  // Se l'utente scrive gg/mm/aaaa, convertiamo in aaaa-mm-gg per il confronto
  const itDate = identifier.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (itDate) {
    identifier = `${itDate[3]}-${itDate[2]}-${itDate[1]}`;
  }

  const res = await fetch('/api/portal/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome: document.getElementById('logNome').value.trim(),
      cognome: document.getElementById('logCognome').value.trim(),
      identifier,
      password: document.getElementById('logPassword').value
    })
  });
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error || 'Credenziali non valide.';
    errEl.classList.remove('hidden');
    return;
  }
  loadPortalClient();
});

forgotForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('forError');
  errEl.classList.add('hidden');

  const res = await fetch('/api/portal/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome: document.getElementById('forNome').value.trim(),
      cognome: document.getElementById('forCognome').value.trim(),
      telefono: document.getElementById('forTelefono').value.trim(),
      dataNascita: document.getElementById('forDob').value,
      newPassword: document.getElementById('forNewPassword').value
    })
  });
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error || 'Errore durante il reset della password.';
    errEl.classList.remove('hidden');
    return;
  }
  loadPortalClient();
});

document.getElementById('btnPortalLogout').addEventListener('click', async () => {
  await fetch('/api/portal/logout', { method: 'POST' });
  clientSection.classList.add('hidden');
  authSection.classList.remove('hidden');
});

async function loadPortalClient() {
  const previewId = new URLSearchParams(window.location.search).get('previewClientId');
  const apiUrl = previewId ? `/api/portal/me?previewClientId=${encodeURIComponent(previewId)}` : '/api/portal/me';
  const res = await fetch(apiUrl);
  if (!res.ok) {
    authSection.classList.remove('hidden');
    clientSection.classList.add('hidden');
    return;
  }
  const { client: c } = await res.json();
  authSection.classList.add('hidden');
  clientSection.classList.remove('hidden');

  document.getElementById('portalClientName').textContent = `${c.nome} ${c.cognome}`.trim();

  const rimaste = 17 - Math.max(0, Math.min(17, Number(c.convenzioneUsate) || 0));
  const convHtml = c.convenzioneAttiva
    ? `<span class="badge">Attiva</span> ${escapeHtml(c.convenzioneCorda || '')} — <span class="badge">🧵 Matassa: ${rimaste}/17 rimaste</span>`
    : '';

  const racchetteHtml = (c.racchette || []).length
    ? c.racchette
        .map(r => {
          const label = typeof r === 'string' ? r : `${r.modello || ''} ${r.pattern ? `(${r.pattern})` : ''}`.trim();
          return `<span class="badge">${escapeHtml(label)}</span>`;
        })
        .join(' ')
    : '-';

  document.getElementById('portalClientInfo').innerHTML = `
    <div class="form-group"><label>Telefono</label><div><strong>${escapeHtml(c.telefono || '-')}</strong></div></div>
    <div class="form-group"><label>Data di Nascita</label><div><strong>${formatDateIT(c.dataNascita)}</strong></div></div>
    <div class="form-group"><label>Prezzo Incordatura</label><div><strong style="color:var(--primary);">${formatEuro(c.prezzoDefault)}</strong></div></div>
    <div class="form-group"><label>Metodo di Lavoro</label><div><strong>${escapeHtml(c.metodo || '-')}</strong></div></div>
    <div class="form-group"><label>Corde Verticali / Orizzontali</label><div><strong>${escapeHtml(c.cordeVerticali || '-')} / ${escapeHtml(c.cordeOrizzontali || '-')}</strong></div></div>
    <div class="form-group"><label>Tensione Verticali / Orizzontali</label><div><strong>${escapeHtml(c.tensioneVerticali || '-')} / ${escapeHtml(c.tensioneOrizzontali || '-')}</strong></div></div>
    <div class="form-group full"><label>Racchette Preferite</label><div>${racchetteHtml}</div></div>
    ${c.convenzioneAttiva ? `<div class="form-group full"><label>Convenzione (17 incordature)</label><div>${convHtml}</div></div>` : ''}
  `;

  const incs = [...(c.incordature || [])].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const tbody = document.getElementById('portalIncTableBody');
  if (incs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">Nessuna incordatura registrata</td></tr>';
  } else {
    tbody.innerHTML = incs
      .map(
        i => `
      <tr>
        <td>${formatDateIT(i.data)}</td>
        <td>${escapeHtml(i.racchetta || '-')}</td>
        <td>${escapeHtml(i.cordeVerticali || '-')} / ${escapeHtml(i.cordeOrizzontali || '-')}</td>
        <td>${escapeHtml(i.tensioneVerticali || '-')} / ${escapeHtml(i.tensioneOrizzontali || '-')}</td>
        <td>${escapeHtml(i.metodo || '-')}</td>
        <td><strong>${i.gratuitaAcquisto ? '🎁 Gratis (Acquisto)' : formatEuro(i.prezzo)}</strong></td>
      </tr>
    `
      )
      .join('');
  }
}

loadPortalClient();
