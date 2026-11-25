const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'dimsport1986';
const MONGO_URI = process.env.MONGO_URI || '';
const DATA_FILE = path.join(__dirname, 'dati_clienti.json');
const STRINGS_FILE = path.join(__dirname, 'dati_corde.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const KEY_FILE = path.join(__dirname, '.secret.key');

let memoryData = null;
let memoryStrings = null;
let AppStore = null;

function getEncryptionKey() {
  if (process.env.DATA_KEY) {
    return crypto.createHash('sha256').update(process.env.DATA_KEY).digest();
  }
  if (!fs.existsSync(KEY_FILE)) {
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(KEY_FILE, generated, 'utf8');
  }
  const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
  return Buffer.from(hex, 'hex');
}

function encryptText(plainText) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `ENC_V1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptText(payload) {
  if (!payload.startsWith('ENC_V1:')) {
    return payload; // backward-compatible with plain JSON
  }
  const [, ivHex, tagHex, dataHex] = payload.split(':');
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

function createAuthToken() {
  const hmac = crypto.createHmac('sha256', getEncryptionKey()).update(APP_PASSWORD).digest('hex');
  return hmac;
}

function isAuthenticated(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
  if (!match) return false;
  return match[1] === createAuthToken();
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function readData() {
  if (memoryData !== null) return memoryData;
  try {
    if (!fs.existsSync(DATA_FILE)) {
      writeData({ clienti: [] });
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8').trim();
    const plain = decryptText(raw);
    const parsed = JSON.parse(plain);
    return Array.isArray(parsed.clienti) ? parsed : { clienti: [] };
  } catch (err) {
    console.error('Errore lettura dati_clienti.json:', err);
    return { clienti: [] };
  }
}

function writeData(data) {
  if (memoryData !== null) memoryData = data;
  const json = JSON.stringify(data, null, 2);
  if (AppStore) {
    AppStore.updateOne({ key: 'clienti' }, { payload: json }, { upsert: true }).catch(err =>
      console.error('Errore salvataggio MongoDB clienti:', err.message)
    );
  }
  const encrypted = encryptText(json);
  fs.writeFileSync(DATA_FILE, encrypted, 'utf8');
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = path.join(BACKUP_DIR, `dati_clienti_${stamp}.json`);
    fs.writeFileSync(backupFile, encrypted, 'utf8');

    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('dati_clienti_') && f.endsWith('.json'))
      .sort();
    while (files.length > 10) {
      const oldest = files.shift();
      fs.unlinkSync(path.join(BACKUP_DIR, oldest));
    }
  } catch (err) {
    console.error('Errore creazione backup:', err);
  }
}

function readStrings() {
  if (memoryStrings !== null) return memoryStrings;
  try {
    if (!fs.existsSync(STRINGS_FILE)) {
      fs.writeFileSync(STRINGS_FILE, JSON.stringify({ corde: [] }, null, 2), 'utf8');
    }
    const raw = fs.readFileSync(STRINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed.corde) ? parsed.corde : [];
    return list.map(item =>
      typeof item === 'string'
        ? { nome: item, prezzo: null }
        : {
            nome: String(item.nome || '').trim(),
            prezzo: item.prezzo !== undefined && item.prezzo !== null && item.prezzo !== '' ? Number(item.prezzo) : null,
            residuo: item.residuo !== undefined && item.residuo !== null && item.residuo !== '' ? Number(item.residuo) : null
          }
    );
  } catch (err) {
    console.error('Errore lettura dati_corde.json:', err);
    return [];
  }
}

function writeStrings(corde) {
  if (memoryStrings !== null) memoryStrings = corde;
  if (AppStore) {
    AppStore.updateOne({ key: 'corde' }, { payload: JSON.stringify(corde) }, { upsert: true }).catch(err =>
      console.error('Errore salvataggio MongoDB corde:', err.message)
    );
  }
  fs.writeFileSync(STRINGS_FILE, JSON.stringify({ corde }, null, 2), 'utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Payload troppo grande'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('JSON non valido'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let safePath = urlPath === '/' ? '/index.html' : urlPath;
  safePath = path.normalize(safePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(__dirname, safePath);

  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end('Accesso negato');
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('File non trovato');
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Auth endpoints
  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      if (body.password === APP_PASSWORD) {
        const token = createAuthToken();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `auth_token=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`
        });
        return res.end(JSON.stringify({ ok: true }));
      }
      return sendJson(res, 401, { error: 'Password non corretta' });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'auth_token=; HttpOnly; Path=/; Max-Age=0'
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (pathname === '/api/ping' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, ts: Date.now() });
  }

  if (pathname === '/api/version' && req.method === 'GET') {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
      const parts = String(pkg.version || '1.18.0').split('.');
      return sendJson(res, 200, { version: `v${parts[0]}.${parts[1] || '0'}` });
    } catch (_) {
      return sendJson(res, 200, { version: 'v1.18' });
    }
  }

  // Public routes (no login required)
  const isPublicRoute =
    pathname === '/login.html' ||
    pathname === '/scheda.html' ||
    pathname === '/area-cliente.html' ||
    pathname === '/js/area-cliente.js' ||
    pathname === '/logo.jpg' ||
    pathname === '/manifest.json' ||
    pathname === '/manifest-clienti.json' ||
    pathname === '/api/ping' ||
    pathname === '/api/version' ||
    pathname.startsWith('/css/') ||
    pathname.startsWith('/api/public/client/') ||
    pathname.startsWith('/api/portal/');

  // Portal Clienti API (cookie separato portal_session)
  if (pathname.startsWith('/api/portal/')) {
    const getPortalClientId = () => {
      const cookieHeader = req.headers.cookie || '';
      const match = cookieHeader.match(/(?:^|;\s*)portal_session=([^;]+)/);
      const token = match ? decodeURIComponent(match[1]) : '';
      if (!token || !token.includes('.')) return null;
      const [cid, sig] = token.split('.');
      const expected = crypto.createHmac('sha256', getEncryptionKey()).update(`portal:${cid}`).digest('hex');
      return sig === expected ? cid : null;
    };
    const setPortalCookie = cid => {
      const sig = crypto.createHmac('sha256', getEncryptionKey()).update(`portal:${cid}`).digest('hex');
      return `portal_session=${cid}.${sig}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`;
    };
    const hashPortalPwd = pwd =>
      crypto.createHmac('sha256', getEncryptionKey()).update(`pwd:${String(pwd)}`).digest('hex');
    const normStr = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const normPhone = s => String(s || '').replace(/\D+/g, '');
    const findClientByName = (nome, cognome) => {
      const n = normStr(nome);
      const c = normStr(cognome);
      if (!n || !c) return null;
      const data = readData();
      return (data.clienti || []).find(
        cl =>
          !cl.deleted &&
          ((normStr(cl.nome) === n && normStr(cl.cognome) === c) ||
            (normStr(cl.nome) === c && normStr(cl.cognome) === n))
      );
    };

    if (pathname === '/api/portal/check' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const client = findClientByName(body.nome, body.cognome);
        if (!client) return sendJson(res, 200, { found: false });
        return sendJson(res, 200, {
          found: true,
          hasPhone: Boolean(normPhone(client.telefono)),
          alreadyRegistered: Boolean(client.portalPasswordHash)
        });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (pathname === '/api/portal/register' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const data = readData();
        const n = normStr(body.nome);
        const c = normStr(body.cognome);
        const client = (data.clienti || []).find(
          cl =>
            !cl.deleted &&
            ((normStr(cl.nome) === n && normStr(cl.cognome) === c) ||
              (normStr(cl.nome) === c && normStr(cl.cognome) === n))
        );
        if (!client) {
          return sendJson(res, 404, { error: 'Cliente non trovato nel registro. Chiedi in negozio!' });
        }
        if (client.portalPasswordHash) {
          return sendJson(res, 400, { error: 'Cliente già registrato. Usa la schermata Accedi.' });
        }
        const dob = String(body.dataNascita || '').trim();
        const pwd = String(body.password || '');
        if (!dob) return sendJson(res, 400, { error: 'Inserisci la data di nascita.' });
        if (pwd.length < 4) return sendJson(res, 400, { error: 'La password deve avere almeno 4 caratteri.' });
        if (!normPhone(client.telefono)) {
          const tel = String(body.telefono || '').trim();
          if (!normPhone(tel)) return sendJson(res, 400, { error: 'Inserisci il numero di telefono.' });
          client.telefono = tel;
        } else if (body.telefono && String(body.telefono).trim()) {
          client.telefono = String(body.telefono).trim();
        }
        client.dataNascita = dob;
        client.portalPasswordHash = hashPortalPwd(pwd);
        writeData(data);
        res.setHeader('Set-Cookie', setPortalCookie(client.id));
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (pathname === '/api/portal/login' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const client = findClientByName(body.nome, body.cognome);
        if (!client || !client.portalPasswordHash) {
          return sendJson(res, 401, { error: 'Credenziali non valide o cliente non ancora registrato.' });
        }
        const idVal = String(body.identifier || '').trim();
        const phoneMatch = normPhone(idVal) && normPhone(idVal) === normPhone(client.telefono);
        const dobMatch = idVal && idVal === String(client.dataNascita || '').trim();
        if (!phoneMatch && !dobMatch) {
          return sendJson(res, 401, { error: 'Telefono o data di nascita non corrispondenti.' });
        }
        if (hashPortalPwd(body.password || '') !== client.portalPasswordHash) {
          return sendJson(res, 401, { error: 'Password errata.' });
        }
        res.setHeader('Set-Cookie', setPortalCookie(client.id));
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (pathname === '/api/portal/me' && req.method === 'GET') {
      const previewId = url.searchParams.get('previewClientId');
      const cid = previewId && isAuthenticated(req) ? previewId : getPortalClientId();
      if (!cid) return sendJson(res, 401, { error: 'Non autenticato' });
      const data = readData();
      const c = (data.clienti || []).find(cl => cl.id === cid && !cl.deleted);
      if (!c) return sendJson(res, 401, { error: 'Cliente non trovato' });
      return sendJson(res, 200, {
        client: {
          nome: c.nome,
          cognome: c.cognome,
          telefono: c.telefono || '',
          dataNascita: c.dataNascita || '',
          prezzoDefault: c.prezzoDefault,
          metodo: c.metodo || '',
          cordeVerticali: c.cordeVerticali || '',
          cordeOrizzontali: c.cordeOrizzontali || '',
          tensioneVerticali: c.tensioneVerticali || '',
          tensioneOrizzontali: c.tensioneOrizzontali || '',
          racchette: c.racchette || [],
          convenzioneAttiva: Boolean(c.convenzioneAttiva),
          convenzioneCorda: c.convenzioneCorda || '',
          convenzionePrezzo: c.convenzionePrezzo,
          convenzioneUsate: Number(c.convenzioneUsate) || 0,
          incordature: (c.incordature || []).map(i => ({
            data: i.data || '',
            racchetta: i.racchetta || '',
            cordeVerticali: i.cordeVerticali || '',
            cordeOrizzontali: i.cordeOrizzontali || '',
            tensioneVerticali: i.tensioneVerticali || '',
            tensioneOrizzontali: i.tensioneOrizzontali || '',
            metodo: i.metodo || '',
            prezzo: i.prezzo,
            inConvenzione: Boolean(i.inConvenzione),
            gratuitaAcquisto: Boolean(i.gratuitaAcquisto)
          }))
        }
      });
    }

    if (pathname === '/api/portal/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', 'portal_session=; HttpOnly; Path=/; Max-Age=0');
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/portal/reset-password' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const data = readData();
        const n = normStr(body.nome);
        const c = normStr(body.cognome);
        const client = (data.clienti || []).find(
          cl =>
            !cl.deleted &&
            ((normStr(cl.nome) === n && normStr(cl.cognome) === c) ||
              (normStr(cl.nome) === c && normStr(cl.cognome) === n))
        );
        if (!client) {
          return sendJson(res, 404, { error: 'Cliente non trovato nel registro.' });
        }
        const phoneOk = normPhone(body.telefono) && normPhone(body.telefono) === normPhone(client.telefono);
        const dobOk = String(body.dataNascita || '').trim() && String(body.dataNascita || '').trim() === String(client.dataNascita || '').trim();
        if (!phoneOk || !dobOk) {
          return sendJson(res, 401, { error: 'Telefono o data di nascita non corrispondenti.' });
        }
        const newPwd = String(body.newPassword || '');
        if (newPwd.length < 4) {
          return sendJson(res, 400, { error: 'La nuova password deve avere almeno 4 caratteri.' });
        }
        client.portalPasswordHash = hashPortalPwd(newPwd);
        writeData(data);
        res.setHeader('Set-Cookie', setPortalCookie(client.id));
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }
  }

  if (!isPublicRoute && !isAuthenticated(req)) {
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 401, { error: 'Non autorizzato' });
    }
    res.writeHead(302, { Location: '/login.html' });
    return res.end();
  }

  // API Routes
  if (pathname === '/api/backups' && req.method === 'GET') {
    try {
      if (!fs.existsSync(BACKUP_DIR)) return sendJson(res, 200, { backups: [] });
      const files = fs
        .readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('dati_clienti_') && f.endsWith('.json'))
        .sort()
        .reverse()
        .map(f => {
          const st = fs.statSync(path.join(BACKUP_DIR, f));
          return { name: f, size: st.size, mtime: st.mtime };
        });
      return sendJson(res, 200, { backups: files });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/backups/restore' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      if (String(body.password || '') !== APP_PASSWORD) {
        return sendJson(res, 401, { error: 'Password errata.' });
      }
      const fileName = path.basename(String(body.fileName || ''));
      if (!fileName.startsWith('dati_clienti_') || !fileName.endsWith('.json')) {
        return sendJson(res, 400, { error: 'File di backup non valido.' });
      }
      const fullPath = path.join(BACKUP_DIR, fileName);
      if (!fs.existsSync(fullPath)) {
        return sendJson(res, 404, { error: 'File di backup non trovato.' });
      }
      const raw = fs.readFileSync(fullPath, 'utf8').trim();
      const plain = decryptText(raw);
      const parsed = JSON.parse(plain);
      if (!Array.isArray(parsed.clienti)) {
        return sendJson(res, 400, { error: 'Formato backup non valido.' });
      }
      writeData(parsed);
      return sendJson(res, 200, { ok: true, count: parsed.clienti.length });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/api/strings' && req.method === 'GET') {
    return sendJson(res, 200, { corde: readStrings() });
  }

  if (pathname === '/api/strings' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const nome = String(body.nome || '').trim().toUpperCase();
      if (!nome) return sendJson(res, 400, { error: 'Nome corda obbligatorio' });
      const prezzo = body.prezzo !== undefined && body.prezzo !== null && body.prezzo !== '' ? Number(body.prezzo) : null;
      const corde = readStrings();
      const existing = corde.find(s => s.nome.toUpperCase() === nome);
      if (existing) {
        if (prezzo !== null) existing.prezzo = prezzo;
      } else {
        corde.push({ nome, prezzo });
        corde.sort((a, b) => a.nome.localeCompare(b.nome));
      }
      writeStrings(corde);
      return sendJson(res, 201, { corde });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  const strItemMatch = pathname.match(/^\/api\/strings\/(.+)$/);
  if (strItemMatch && req.method === 'PUT') {
    try {
      const target = decodeURIComponent(strItemMatch[1]).trim().toUpperCase();
      const body = await parseBody(req);
      const corde = readStrings();
      const item = corde.find(s => s.nome.toUpperCase() === target);
      if (!item) return sendJson(res, 404, { error: 'Corda non trovata' });
      if (body.nome !== undefined && String(body.nome).trim() !== '') {
        item.nome = String(body.nome).trim().toUpperCase();
      }
      if (body.prezzo !== undefined) {
        item.prezzo = body.prezzo !== null && body.prezzo !== '' ? Number(body.prezzo) : null;
      }
      if (body.residuo !== undefined) {
        item.residuo = body.residuo !== null && body.residuo !== '' ? Math.max(0, Number(body.residuo)) : null;
      }
      corde.sort((a, b) => a.nome.localeCompare(b.nome));
      writeStrings(corde);
      return sendJson(res, 200, { corde });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  const delStringMatch = pathname.match(/^\/api\/strings\/(.+)$/);
  if (delStringMatch && req.method === 'DELETE') {
    const target = decodeURIComponent(delStringMatch[1]).trim().toUpperCase();
    const corde = readStrings().filter(s => s.nome.toUpperCase() !== target);
    writeStrings(corde);
    return sendJson(res, 200, { corde });
  }
  if (pathname === '/api/clients' && req.method === 'GET') {
    const data = readData();
    const includeDeleted = url.searchParams.get('includeDeleted') === '1';
    const baseList = includeDeleted ? data.clienti : data.clienti.filter(c => !c.eliminato);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    if (!q) {
      return sendJson(res, 200, { clienti: baseList });
    }
    const filtered = baseList.filter(c => {
      const searchable = [
        c.nome,
        c.cognome,
        `${c.nome} ${c.cognome}`,
        `${c.cognome} ${c.nome}`,
        c.telefono,
        c.email,
        c.cordeVerticali,
        c.cordeOrizzontali,
        c.tensioneVerticali,
        c.tensioneOrizzontali,
        c.metodoLavoro,
        c.note,
        ...(Array.isArray(c.racchette) ? c.racchette : []),
        ...(Array.isArray(c.incordature)
          ? c.incordature.flatMap(i => [i.racchetta, i.cordeVerticali, i.cordeOrizzontali, i.note, i.data])
          : [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(q);
    });
    return sendJson(res, 200, { clienti: filtered });
  }

  if (pathname === '/api/clients' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const data = readData();
      const newClient = {
        id: crypto.randomUUID(),
        nome: String(body.nome || '').trim(),
        cognome: String(body.cognome || '').trim(),
        telefono: String(body.telefono || '').trim(),
        email: String(body.email || '').trim(),
        racchette: Array.isArray(body.racchette)
          ? body.racchette.map(r => String(r).trim()).filter(Boolean)
          : [],
        cordeVerticali: String(body.cordeVerticali || '').trim(),
        cordeOrizzontali: String(body.cordeOrizzontali || '').trim(),
        coloreCorda: String(body.coloreCorda || '').trim(),
        lunghezzaCorda: String(body.lunghezzaCorda || '').trim(),
        tensioneVerticali: String(body.tensioneVerticali || '').trim(),
        tensioneOrizzontali: String(body.tensioneOrizzontali || '').trim(),
        metodoLavoro: String(body.metodoLavoro || '').trim(),
        note: String(body.note || '').trim(),
        prezzoDefault: body.prezzoDefault !== '' && body.prezzoDefault !== undefined ? Number(body.prezzoDefault) : null,
        convenzioneAttiva: Boolean(body.convenzioneAttiva),
        convenzioneCorda: String(body.convenzioneCorda || '').trim(),
        convenzionePrezzo:
          body.convenzionePrezzo !== '' && body.convenzionePrezzo !== undefined && body.convenzionePrezzo !== null
            ? Number(body.convenzionePrezzo)
            : null,
        convenzioneUsate: Math.max(0, Math.min(17, Number(body.convenzioneUsate) || 0)),
        cordaPropriaV: Boolean(body.cordaPropriaV),
        cordaPropriaO: Boolean(body.cordaPropriaO),
        createdAt: new Date().toISOString(),
        incordature: []
      };

      if (body.primaIncordatura && body.primaIncordatura.data) {
        newClient.incordature.push({
          id: crypto.randomUUID(),
          data: body.primaIncordatura.data,
          racchetta: String(body.primaIncordatura.racchetta || newClient.racchette[0] || '').trim(),
          cordeVerticali: String(body.primaIncordatura.cordeVerticali ?? newClient.cordeVerticali).trim(),
          cordeOrizzontali: String(body.primaIncordatura.cordeOrizzontali ?? newClient.cordeOrizzontali).trim(),
          tensioneVerticali: String(body.primaIncordatura.tensioneVerticali ?? newClient.tensioneVerticali).trim(),
          tensioneOrizzontali: String(body.primaIncordatura.tensioneOrizzontali ?? newClient.tensioneOrizzontali).trim(),
          metodoLavoro: String(body.primaIncordatura.metodoLavoro ?? newClient.metodoLavoro).trim(),
          prezzo:
            body.primaIncordatura.prezzo !== '' && body.primaIncordatura.prezzo !== undefined && body.primaIncordatura.prezzo !== null
              ? Number(body.primaIncordatura.prezzo)
              : newClient.prezzoDefault,
          inConvenzione: Boolean(body.primaIncordatura.inConvenzione),
          note: String(body.primaIncordatura.note || '').trim()
        });
      }

      data.clienti.push(newClient);
      writeData(data);
      return sendJson(res, 201, { client: newClient });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  const publicMatch = pathname.match(/^\/api\/public\/client\/([^\/]+)$/);
  if (publicMatch && req.method === 'GET') {
    const clientId = publicMatch[1];
    const data = readData();
    const c = data.clienti.find(x => x.id === clientId);
    if (!c) return sendJson(res, 404, { error: 'Scheda non trovata' });
    return sendJson(res, 200, {
      client: {
        id: c.id,
        nome: c.nome,
        cognome: c.cognome,
        racchette: c.racchette || [],
        cordeVerticali: c.cordeVerticali || '',
        cordeOrizzontali: c.cordeOrizzontali || '',
        tensioneVerticali: c.tensioneVerticali || '',
        tensioneOrizzontali: c.tensioneOrizzontali || '',
        prezzoDefault: c.prezzoDefault,
        convenzioneAttiva: Boolean(c.convenzioneAttiva),
        convenzioneCorda: c.convenzioneCorda || '',
        convenzionePrezzo: c.convenzionePrezzo ?? null,
        incordature: c.incordature || []
      }
    });
  }

  const resetPortalMatch = pathname.match(/^\/api\/clients\/([^/]+)\/reset-portal$/);
  if (resetPortalMatch && req.method === 'POST') {
    const id = decodeURIComponent(resetPortalMatch[1]);
    const data = readData();
    const client = (data.clienti || []).find(c => c.id === id);
    if (!client) return sendJson(res, 404, { error: 'Cliente non trovato' });
    delete client.portalPasswordHash;
    writeData(data);
    return sendJson(res, 200, { ok: true, client });
  }

  const clientMatch = pathname.match(/^\/api\/clients\/([^\/]+)$/);
  if (clientMatch) {
    const clientId = clientMatch[1];
    const data = readData();
    const idx = data.clienti.findIndex(c => c.id === clientId);

    if (req.method === 'GET') {
      if (idx === -1) return sendJson(res, 404, { error: 'Cliente non trovato' });
      return sendJson(res, 200, { client: data.clienti[idx] });
    }

    if (req.method === 'PUT') {
      if (idx === -1) return sendJson(res, 404, { error: 'Cliente non trovato' });
      try {
        const body = await parseBody(req);
        const existing = data.clienti[idx];
        data.clienti[idx] = {
          ...existing,
          nome: body.nome !== undefined ? String(body.nome).trim() : existing.nome,
          cognome: body.cognome !== undefined ? String(body.cognome).trim() : existing.cognome,
          telefono: body.telefono !== undefined ? String(body.telefono).trim() : existing.telefono,
          email: body.email !== undefined ? String(body.email).trim() : existing.email,
          racchette: Array.isArray(body.racchette)
            ? body.racchette.map(r => String(r).trim()).filter(Boolean)
            : existing.racchette,
          cordeVerticali: body.cordeVerticali !== undefined ? String(body.cordeVerticali).trim() : existing.cordeVerticali,
          cordeOrizzontali: body.cordeOrizzontali !== undefined ? String(body.cordeOrizzontali).trim() : existing.cordeOrizzontali,
          coloreCorda: body.coloreCorda !== undefined ? String(body.coloreCorda).trim() : (existing.coloreCorda || ''),
          lunghezzaCorda: body.lunghezzaCorda !== undefined ? String(body.lunghezzaCorda).trim() : (existing.lunghezzaCorda || ''),
          tensioneVerticali: body.tensioneVerticali !== undefined ? String(body.tensioneVerticali).trim() : existing.tensioneVerticali,
          tensioneOrizzontali: body.tensioneOrizzontali !== undefined ? String(body.tensioneOrizzontali).trim() : existing.tensioneOrizzontali,
          metodoLavoro: body.metodoLavoro !== undefined ? String(body.metodoLavoro).trim() : existing.metodoLavoro,
          note: body.note !== undefined ? String(body.note).trim() : existing.note,
          prezzoDefault:
            body.prezzoDefault !== undefined
              ? body.prezzoDefault === '' || body.prezzoDefault === null
                ? null
                : Number(body.prezzoDefault)
              : existing.prezzoDefault,
          convenzioneAttiva:
            body.convenzioneAttiva !== undefined ? Boolean(body.convenzioneAttiva) : Boolean(existing.convenzioneAttiva),
          convenzioneCorda:
            body.convenzioneCorda !== undefined ? String(body.convenzioneCorda).trim() : (existing.convenzioneCorda || ''),
          convenzionePrezzo:
            body.convenzionePrezzo !== undefined
              ? body.convenzionePrezzo === '' || body.convenzionePrezzo === null
                ? null
                : Number(body.convenzionePrezzo)
              : (existing.convenzionePrezzo ?? null),
          convenzioneUsate:
            body.convenzioneUsate !== undefined
              ? Math.max(0, Math.min(17, Number(body.convenzioneUsate) || 0))
              : (Number(existing.convenzioneUsate) || 0),
          cordaPropriaV:
            body.cordaPropriaV !== undefined ? Boolean(body.cordaPropriaV) : Boolean(existing.cordaPropriaV),
          cordaPropriaO:
            body.cordaPropriaO !== undefined ? Boolean(body.cordaPropriaO) : Boolean(existing.cordaPropriaO),
          dataNascita:
            body.dataNascita !== undefined ? String(body.dataNascita).trim() : (existing.dataNascita || '')
        };
        writeData(data);
        return sendJson(res, 200, { client: data.clienti[idx] });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (req.method === 'DELETE') {
      if (idx === -1) return sendJson(res, 404, { error: 'Cliente non trovato' });
      const keepInc = url.searchParams.get('keepIncordature') === '1';
      if (keepInc && Array.isArray(data.clienti[idx].incordature) && data.clienti[idx].incordature.length > 0) {
        data.clienti[idx].eliminato = true;
        data.clienti[idx].telefono = '';
        data.clienti[idx].email = '';
        data.clienti[idx].note = '';
      } else {
        data.clienti.splice(idx, 1);
      }
      writeData(data);
      return sendJson(res, 200, { ok: true });
    }
  }

  const incMatch = pathname.match(/^\/api\/clients\/([^\/]+)\/incordature$/);
  if (incMatch && req.method === 'POST') {
    const clientId = incMatch[1];
    const data = readData();
    const client = data.clienti.find(c => c.id === clientId);
    if (!client) return sendJson(res, 404, { error: 'Cliente non trovato' });

    try {
      const body = await parseBody(req);
      if (!body.data) {
        return sendJson(res, 400, { error: 'La data dell\'incordatura è obbligatoria' });
      }
      const quantita = Math.max(1, parseInt(body.quantita, 10) || 1);
      client.incordature = Array.isArray(client.incordature) ? client.incordature : [];
      const created = [];
      for (let i = 0; i < quantita; i++) {
        const newInc = {
          id: crypto.randomUUID(),
          data: body.data || '',
          racchetta: String(body.racchetta || '').trim(),
          cordeVerticali: String(body.cordeVerticali ?? client.cordeVerticali).trim(),
          cordeOrizzontali: String(body.cordeOrizzontali ?? client.cordeOrizzontali).trim(),
          coloreCorda: String(body.coloreCorda ?? client.coloreCorda ?? '').trim(),
          lunghezzaCorda: String(body.lunghezzaCorda ?? client.lunghezzaCorda ?? '').trim(),
          tensioneVerticali: String(body.tensioneVerticali ?? client.tensioneVerticali).trim(),
          tensioneOrizzontali: String(body.tensioneOrizzontali ?? client.tensioneOrizzontali).trim(),
          metodoLavoro: String(body.metodoLavoro ?? client.metodoLavoro).trim(),
          prezzo:
            body.gratuitaAcquisto
              ? 0
              : body.prezzo !== '' && body.prezzo !== undefined && body.prezzo !== null
              ? Number(body.prezzo)
              : client.prezzoDefault,
          inConvenzione: Boolean(body.inConvenzione),
          gratuitaAcquisto: Boolean(body.gratuitaAcquisto),
          cordaPropriaV: Boolean(body.cordaPropriaV),
          cordaPropriaO: Boolean(body.cordaPropriaO),
          note: String(body.note || '').trim()
        };
        client.incordature.push(newInc);
        created.push(newInc);
        if (newInc.inConvenzione && !newInc.gratuitaAcquisto) {
          client.convenzioneUsate = Math.min(17, (Number(client.convenzioneUsate) || 0) + 1);
        }
        // Aggiorna inventario corde (0.5 verticali + 0.5 orizzontali), escludendo corda propria e corde Convenzione
        const decString = (strName, isPropria) => {
          if (isPropria) return false;
          const clean = String(strName || '').trim().toUpperCase();
          if (!clean || /CONVENZIONE/i.test(clean)) return false;
          const cordeList = readStrings();
          const found = cordeList.find(s => s.nome.toUpperCase() === clean);
          if (found && found.residuo !== null && found.residuo !== undefined) {
            found.residuo = Math.max(0, Number((Number(found.residuo) - 0.5).toFixed(2)));
            writeStrings(cordeList);
            return true;
          }
          return false;
        };
        decString(newInc.cordeVerticali, newInc.cordaPropriaV);
        decString(newInc.cordeOrizzontali, newInc.cordaPropriaO);
      }
      const latest = created[created.length - 1];
      if (latest) {
        if (latest.cordeVerticali) client.cordeVerticali = latest.cordeVerticali;
        if (latest.cordeOrizzontali) client.cordeOrizzontali = latest.cordeOrizzontali;
        if (latest.tensioneVerticali) client.tensioneVerticali = latest.tensioneVerticali;
        if (latest.tensioneOrizzontali) client.tensioneOrizzontali = latest.tensioneOrizzontali;
        if (latest.metodoLavoro) client.metodoLavoro = latest.metodoLavoro;
        if (latest.lunghezzaCorda) client.lunghezzaCorda = latest.lunghezzaCorda;
        if (latest.coloreCorda) client.coloreCorda = latest.coloreCorda;
        if (latest.prezzo !== null && latest.prezzo !== undefined && latest.prezzo !== '') {
          client.prezzoDefault = latest.prezzo;
        }
        client.cordaPropriaV = Boolean(latest.cordaPropriaV);
        client.cordaPropriaO = Boolean(latest.cordaPropriaO);
        if (latest.racchetta) {
          client.racchette = Array.isArray(client.racchette) ? client.racchette : [];
          if (!client.racchette.includes(latest.racchetta)) {
            client.racchette.push(latest.racchetta);
          }
        }
      }
      writeData(data);
      return sendJson(res, 201, { incordatura: created[0], count: created.length, client });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  const incItemMatch = pathname.match(/^\/api\/clients\/([^\/]+)\/incordature\/([^\/]+)$/);
  if (incItemMatch && req.method === 'PUT') {
    const [, clientId, incId] = incItemMatch;
    const data = readData();
    const client = data.clienti.find(c => c.id === clientId);
    if (!client) return sendJson(res, 404, { error: 'Cliente non trovato' });
    const incIdx = (client.incordature || []).findIndex(i => i.id === incId);
    if (incIdx === -1) return sendJson(res, 404, { error: 'Incordatura non trovata' });

    try {
      const body = await parseBody(req);
      const existing = client.incordature[incIdx];
      client.incordature[incIdx] = {
        ...existing,
        data: body.data !== undefined ? body.data : existing.data,
        racchetta: body.racchetta !== undefined ? String(body.racchetta).trim() : existing.racchetta,
        cordeVerticali: body.cordeVerticali !== undefined ? String(body.cordeVerticali).trim() : existing.cordeVerticali,
        cordeOrizzontali: body.cordeOrizzontali !== undefined ? String(body.cordeOrizzontali).trim() : existing.cordeOrizzontali,
        coloreCorda: body.coloreCorda !== undefined ? String(body.coloreCorda).trim() : (existing.coloreCorda || ''),
        lunghezzaCorda: body.lunghezzaCorda !== undefined ? String(body.lunghezzaCorda).trim() : (existing.lunghezzaCorda || ''),
        tensioneVerticali: body.tensioneVerticali !== undefined ? String(body.tensioneVerticali).trim() : existing.tensioneVerticali,
        tensioneOrizzontali: body.tensioneOrizzontali !== undefined ? String(body.tensioneOrizzontali).trim() : existing.tensioneOrizzontali,
        metodoLavoro: body.metodoLavoro !== undefined ? String(body.metodoLavoro).trim() : existing.metodoLavoro,
        prezzo:
          body.prezzo !== undefined
            ? body.prezzo === '' || body.prezzo === null
              ? client.prezzoDefault
              : Number(body.prezzo)
            : existing.prezzo,
        inConvenzione: body.inConvenzione !== undefined ? Boolean(body.inConvenzione) : Boolean(existing.inConvenzione),
        cordaPropriaV: body.cordaPropriaV !== undefined ? Boolean(body.cordaPropriaV) : Boolean(existing.cordaPropriaV),
        cordaPropriaO: body.cordaPropriaO !== undefined ? Boolean(body.cordaPropriaO) : Boolean(existing.cordaPropriaO),
        note: body.note !== undefined ? String(body.note).trim() : existing.note
      };
      writeData(data);
      return sendJson(res, 200, { incordatura: client.incordature[incIdx], client });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  const delIncMatch = pathname.match(/^\/api\/clients\/([^\/]+)\/incordature\/([^\/]+)$/);
  if (delIncMatch && req.method === 'DELETE') {
    const [, clientId, incId] = delIncMatch;
    const data = readData();
    const client = data.clienti.find(c => c.id === clientId);
    if (!client) return sendJson(res, 404, { error: 'Cliente non trovato' });
    client.incordature = (client.incordature || []).filter(i => i.id !== incId);
    writeData(data);
    return sendJson(res, 200, { client });
  }

  // Static files
  return serveStatic(req, res, pathname);
});

// Keep-Alive automatico su Render (o quando ENABLE_KEEP_ALIVE=true)
const keepAliveBaseUrl =
  process.env.RENDER_EXTERNAL_URL ||
  process.env.APP_URL ||
  (process.env.RENDER ? 'https://registro-incordature-dimensione-sport.onrender.com' : '');

if (keepAliveBaseUrl || process.env.ENABLE_KEEP_ALIVE === 'true') {
  const targetUrl = (keepAliveBaseUrl || `http://localhost:${PORT}`).replace(/\/+$/, '') + '/api/ping';
  setInterval(() => {
    try {
      const client = targetUrl.startsWith('https') ? https : http;
      client
        .get(targetUrl, res => {
          console.log(`[Keep-Alive] Ping ${targetUrl} -> ${res.statusCode}`);
        })
        .on('error', err => {
          console.warn('[Keep-Alive] Errore ping:', err.message);
        });
    } catch (e) {
      console.warn('[Keep-Alive] Eccezione:', e.message);
    }
  }, 10 * 60 * 1000);
  console.log(`⏰ Keep-Alive attivo ogni 10 minuti su ${targetUrl}`);
}

async function startServer() {
  if (MONGO_URI) {
    try {
      const mongoose = require('mongoose');
      await mongoose.connect(MONGO_URI);
      const schema = new mongoose.Schema({
        key: { type: String, unique: true, required: true },
        payload: { type: String, required: true }
      });
      AppStore = mongoose.models.AppStore || mongoose.model('AppStore', schema);

      const docClienti = await AppStore.findOne({ key: 'clienti' }).lean();
      if (docClienti && docClienti.payload) {
        memoryData = JSON.parse(docClienti.payload);
        console.log(`✅ MongoDB: caricati ${(memoryData.clienti || []).length} clienti`);
      } else {
        const localData = readData();
        memoryData = localData;
        await AppStore.updateOne({ key: 'clienti' }, { payload: JSON.stringify(localData) }, { upsert: true });
        console.log(`✅ MongoDB: migrati ${(localData.clienti || []).length} clienti dal file locale`);
      }

      const docCorde = await AppStore.findOne({ key: 'corde' }).lean();
      if (docCorde && docCorde.payload) {
        memoryStrings = JSON.parse(docCorde.payload);
        console.log(`✅ MongoDB: caricate ${memoryStrings.length} corde`);
      } else {
        const localStrings = readStrings();
        memoryStrings = localStrings;
        await AppStore.updateOne({ key: 'corde' }, { payload: JSON.stringify(localStrings) }, { upsert: true });
        console.log(`✅ MongoDB: migrate ${localStrings.length} corde dal file locale`);
      }
    } catch (err) {
      console.error('❌ Errore connessione MongoDB:', err.message);
    }
  }

  server.listen(PORT, () => {
    console.log(`Registro Incordature attivo su http://localhost:${PORT}`);
  });
}

startServer();
