const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PDF_PATH =
  'C:/Users/Utente/.gemini/antigravity/brain/bec550bb-7d14-4ee9-b3a2-99f427e7640e/.user_uploaded/media_1795197487920_33b9ee91.pdf';
const DATA_FILE = path.join(__dirname, 'dati_clienti.json');
const KEY_FILE = path.join(__dirname, '.secret.key');
const OUT_FILE = path.join(__dirname, 'backup_completo.json');

function readExistingClients() {
  if (!fs.existsSync(DATA_FILE)) return [];
  let raw = fs.readFileSync(DATA_FILE, 'utf8').trim();
  if (raw.startsWith('ENC_V1:')) {
    const [, ivHex, tagHex, dataHex] = raw.split(':');
    const keyHex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    const key = Buffer.from(keyHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    raw = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  }
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.clienti) ? parsed.clienti : [];
}

function unescapePdfString(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const next = s[++i];
      if (next === 'n') out += '\n';
      else if (next === 'r') out += '\r';
      else if (next === 't') out += '\t';
      else if (next === 'b') out += '\b';
      else if (next === 'f') out += '\f';
      else if (next >= '0' && next <= '7') {
        let oct = next;
        if (i + 1 < s.length && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
        if (i + 1 < s.length && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
        out += String.fromCharCode(parseInt(oct, 8));
      } else {
        out += next;
      }
    } else {
      out += s[i];
    }
  }
  return out;
}

function decodeBtBlock(block) {
  let out = '';
  const litRe = /\((?:\\.|[^\\)])*\)/g;
  let m;
  while ((m = litRe.exec(block))) {
    const rawLit = m[0].slice(1, -1);
    const u = unescapePdfString(rawLit);
    for (let i = 0; i + 1 < u.length; i += 2) {
      const g = (u.charCodeAt(i) << 8) | u.charCodeAt(i + 1);
      if (g >= 0x03 && g <= 0x5f) {
        out += String.fromCharCode(g + 29);
      } else if (g === 0x65) {
        out += 'É';
      } else if (g === 0x6a) {
        out += 'à';
      } else if (g === 0xbc) {
        out += '€';
      } else if (g >= 0xc1 && g <= 0xca) {
        out += String.fromCharCode(g - 0x91);
      }
    }
  }
  return out.trim();
}

function normalizeName(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function toTitleCase(str) {
  return String(str || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

const SURNAME_PREFIXES = new Set(['DE', 'DI', 'DEL', 'DELLA', 'LO', 'LA', 'DAL', 'DA', 'VAN', 'VON']);

function splitCognomeNome(rawName) {
  const clean = String(rawName || '').trim().replace(/\s+/g, ' ');
  if (!clean) return { cognome: '', nome: '' };
  const parts = clean.split(' ');
  if (parts.length === 1) {
    return { cognome: toTitleCase(parts[0]), nome: '' };
  }
  if (parts.length >= 3 && SURNAME_PREFIXES.has(parts[0].toUpperCase())) {
    return {
      cognome: toTitleCase(parts.slice(0, 2).join(' ')),
      nome: toTitleCase(parts.slice(2).join(' '))
    };
  }
  return {
    cognome: toTitleCase(parts[0]),
    nome: toTitleCase(parts.slice(1).join(' '))
  };
}

const IT_MONTHS = {
  gennaio: '01', gen: '01',
  febbraio: '02', feb: '02',
  marzo: '03', mar: '03',
  aprile: '04', apr: '04',
  maggio: '05', mag: '05',
  giugno: '06', giu: '06',
  luglio: '07', lug: '07',
  agosto: '08', ago: '08',
  settembre: '09', set: '09',
  ottobre: '10', ott: '10',
  novembre: '11', nov: '11',
  dicembre: '12', dic: '12'
};

function parseItalianDate(raw) {
  const m = String(raw || '')
    .trim()
    .toLowerCase()
    .match(/(\d{1,2})\s+([a-zà]+)\s+(\d{2,4})/);
  if (!m) return '';
  const day = m[1].padStart(2, '0');
  const month = IT_MONTHS[m[2]];
  if (!month) return '';
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${month}-${day}`;
}

function parseEuro(raw) {
  const m = String(raw || '').match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const val = Number(m[1].replace(',', '.'));
  return Number.isNaN(val) ? null : val;
}

function formatTension(raw) {
  const clean = String(raw || '').trim();
  if (!clean) return '';
  if (/kg$/i.test(clean)) return `${clean.replace(/\s*kg$/i, '').trim()} Kg`;
  return `${clean} Kg`;
}

function main() {
  const existingClients = readExistingClients();
  const existingNames = new Set();
  existingClients.forEach(c => {
    const a = normalizeName(`${c.cognome || ''} ${c.nome || ''}`);
    const b = normalizeName(`${c.nome || ''} ${c.cognome || ''}`);
    if (a) existingNames.add(a);
    if (b) existingNames.add(b);
  });

  const pdfBuf = fs.readFileSync(PDF_PATH);
  const pdfStr = pdfBuf.toString('latin1');
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;

  const clientXSet = new Set();
  const subXSet = new Set();
  const items = [];
  const seenItems = new Set();
  const checkedV = [];
  const checkedO = [];

  let m;
  let pageCount = 0;
  while ((m = streamRe.exec(pdfStr)) && pageCount < 87) {
    let inf;
    try {
      inf = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    if (!inf.includes('BT')) continue;
    pageCount++;

    for (const lm of inf.matchAll(/([\d.]+)\s+45\.0\s+m\s+[\d.]+\s+132\.0\s+l/g)) {
      const x = Number(lm[1]);
      if (x >= 179) clientXSet.add(x);
    }

    for (const sm of inf.matchAll(/([\d.]+)\s+151\.0\s+m\s+[\d.]+\s+(?:800|679)\.0\s+l/g)) {
      const x = Number(sm[1]);
      if (x >= 179) subXSet.add(x);
    }

    for (const cv of inf.matchAll(/([\d.]+)\s+583\.825\s+m/g)) {
      checkedV.push(Number(cv[1]));
    }
    for (const co of inf.matchAll(/([\d.]+)\s+617\.825\s+m/g)) {
      checkedO.push(Number(co[1]));
    }

    const btre = /BT([\s\S]*?)ET/g;
    let bm;
    while ((bm = btre.exec(inf))) {
      const tm = bm[1].match(/1\.0\s+0\s+0\s+-1\.0\s+([\d.-]+)\s+([\d.-]+)\s+Tm/);
      if (!tm) continue;
      const x = Number(tm[1]);
      const y = Number(tm[2]);
      if (x < 180) continue;
      const txt = decodeBtBlock(bm[1]);
      if (!txt) continue;
      const k = `${Math.round(x)}_${Math.round(y)}_${txt}`;
      if (!seenItems.has(k)) {
        seenItems.add(k);
        items.push({ x, y, txt });
      }
    }
  }

  const clientXs = [...clientXSet].sort((a, b) => a - b);
  const subXs = [...subXSet].sort((a, b) => a - b);

  let skipped2026 = 0;
  let skippedDuplicate = 0;
  const importedClients = [];

  for (let i = 0; i < clientXs.length - 1; i++) {
    const x0 = clientXs[i];
    const x1 = clientXs[i + 1];
    const colItems = items.filter(it => it.x >= x0 && it.x < x1);

    const getText = (yMin, yMax, sx0 = x0, sx1 = x1) =>
      colItems
        .filter(it => it.x >= sx0 && it.x < sx1 && it.y >= yMin && it.y < yMax)
        .sort((a, b) => (Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x))
        .map(it => it.txt)
        .join(' ')
        .trim();

    const rawName = getText(43, 95);
    if (!rawName) continue;

    const ultimaRaw = getText(131, 152);
    const bottomText = getText(801, 3100);
    const has2026 = /\b20?26\b/.test(ultimaRaw) || /\b20?26\b/.test(bottomText) || getText(801, 841) !== '';
    if (has2026) {
      skipped2026++;
      continue;
    }

    const normFull = normalizeName(rawName);
    if (existingNames.has(normFull)) {
      skippedDuplicate++;
      continue;
    }
    existingNames.add(normFull);

    const { cognome, nome } = splitCognomeNome(rawName);
    const telefonoRaw = getText(95, 131);
    const telefono = telefonoRaw.replace(/\s+/g, ' ').trim();
    const noteVarie = getText(152, 180);
    const circolo = getText(207, 229);
    const annotazioni = getText(715, 801);
    const note = [noteVarie, circolo ? `Circolo: ${circolo}` : '', annotazioni].filter(Boolean).join(' — ');

    // Sub-columns for this client
    const innerSubs = subXs.filter(sx => sx > x0 + 20 && sx < x1 - 20);
    const bounds = [x0, ...innerSubs, x1];

    const racchette = [];
    let lastSetup = null;

    for (let j = 0; j < bounds.length - 1; j++) {
      const sx0 = bounds[j];
      const sx1 = bounds[j + 1];

      const modello = getText(229, 297, sx0, sx1);
      const pattern = getText(297, 320, sx0, sx1);
      const manico = getText(320, 340, sx0, sx1);

      let racketStr = '';
      if (modello) {
        racketStr = modello;
        if (pattern) racketStr += ` (${pattern})`;
        if (manico) racketStr += ` [${manico}]`;
        if (!racchette.includes(racketStr)) racchette.push(racketStr);
      }

      const cordeV = getText(340, 404, sx0, sx1);
      const cordeO = getText(404, 467, sx0, sx1);
      const tenV = formatTension(getText(467, 509, sx0, sx1));
      const tenO = formatTension(getText(509, 538, sx0, sx1));
      const metri = getText(538, 560, sx0, sx1);
      const metodo = getText(628, 656, sx0, sx1) || 'ATW';
      const prezzo = parseEuro(getText(656, 679, sx0, sx1));

      const hasCheckedV = checkedV.some(cx => cx >= sx0 && cx < sx1);
      const hasCheckedO = checkedO.some(cx => cx >= sx0 && cx < sx1);
      const cpV = hasCheckedV || cordeV.toUpperCase() === 'CORDA PROPRIA';
      const cpO = hasCheckedO || cordeO.toUpperCase() === 'CORDA PROPRIA';

      lastSetup = {
        racketStr,
        cordeV,
        cordeO,
        tenV,
        tenO,
        metri,
        metodo,
        prezzo,
        cpV,
        cpO
      };
    }

    const setup = lastSetup || {};
    const histDate = parseItalianDate(ultimaRaw);
    const incordature = [];
    if (histDate) {
      incordature.push({
        id: crypto.randomUUID(),
        data: histDate,
        racchetta: setup.racketStr || racchette[0] || '',
        cordeVerticali: setup.cordeV || '',
        cordeOrizzontali: setup.cordeO || '',
        coloreCorda: '',
        lunghezzaCorda: setup.metri || '',
        tensioneVerticali: setup.tenV || '',
        tensioneOrizzontali: setup.tenO || '',
        metodoLavoro: setup.metodo || 'ATW',
        prezzo: setup.prezzo ?? null,
        inConvenzione: false,
        cordaPropriaV: Boolean(setup.cpV),
        cordaPropriaO: Boolean(setup.cpO),
        note: ''
      });
    }

    importedClients.push({
      id: crypto.randomUUID(),
      nome,
      cognome,
      telefono,
      email: '',
      racchette,
      cordeVerticali: setup.cordeV || '',
      cordeOrizzontali: setup.cordeO || '',
      coloreCorda: '',
      lunghezzaCorda: setup.metri || '',
      tensioneVerticali: setup.tenV || '',
      tensioneOrizzontali: setup.tenO || '',
      metodoLavoro: setup.metodo || 'ATW',
      note,
      prezzoDefault: setup.prezzo ?? null,
      convenzioneAttiva: false,
      convenzioneCorda: '',
      convenzionePrezzo: null,
      cordaPropriaV: Boolean(setup.cpV),
      cordaPropriaO: Boolean(setup.cpO),
      createdAt: new Date().toISOString(),
      incordature
    });
  }

  const merged = [...existingClients, ...importedClients];
  fs.writeFileSync(OUT_FILE, JSON.stringify({ clienti: merged }, null, 2), 'utf8');

  console.log('Pages parsed:', pageCount);
  console.log('PDF client columns:', clientXs.length - 1);
  console.log('Skipped (strung in 2026):', skipped2026);
  console.log('Skipped (already in DB):', skippedDuplicate);
  console.log('Newly imported (inactive 2026):', importedClients.length);
  console.log('Total clients in backup_completo.json:', merged.length);
  console.log('Sample imported:', importedClients.slice(0, 5).map(c => ({
    cognome: c.cognome,
    nome: c.nome,
    telefono: c.telefono,
    racchette: c.racchette,
    cordeV: c.cordeVerticali,
    tenV: c.tensioneVerticali,
    prezzo: c.prezzoDefault,
    incData: c.incordature[0]?.data || null
  })));
}

main();
