// Driver's license / state ID barcode -> PT NOTES fields.
//
// US and Canadian licenses carry a PDF417 barcode on the back in the AAMVA
// format: lines of 3-letter element IDs followed by their value, e.g.
// "DCSSMITH" (last name), "DBB01151985" (date of birth). Decoding happens
// entirely on the phone -- no image or barcode text ever leaves it; only
// the fields below are filled in, for the medic to check before sending.
//
// Deliberately NOT extracted: license number, issue/expiration dates,
// height/weight/eye color and the like -- not needed for a patient handoff,
// and the less patient data collected the better.
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// Serve the decoder's WASM from our own bundle instead of the library's
// default CDN, so scanning doesn't depend on (or leak a request to) a third
// party.
prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
});

const READER_OPTIONS = {
  formats: ['PDF417'],
  tryHarder: true,
  tryRotate: true,
  maxNumberOfSymbols: 1,
};

// Returns the barcode's raw text, or null if no license barcode was found.
export async function decodeLicenseBarcode(input) {
  const results = await readBarcodes(input, READER_OPTIONS);
  const hit = results.find(r => r.isValid && r.text);
  return hit ? hit.text : null;
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase());
}

// "01151985" (US: MMDDCCYY) or "19850115" (Canada: CCYYMMDD) -> Date|null
function parseDob(raw) {
  const v = (raw || '').replace(/\D/g, '');
  if (v.length !== 8) return null;
  let y, m, d;
  if (Number(v.slice(0, 4)) > 1900) { y = +v.slice(0, 4); m = +v.slice(4, 6); d = +v.slice(6, 8); }
  else { m = +v.slice(0, 2); d = +v.slice(2, 4); y = +v.slice(4, 8); }
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

function ageOn(dob, today = new Date()) {
  let age = today.getFullYear() - dob.getFullYear();
  const beforeBirthday = today.getMonth() < dob.getMonth() ||
    (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate());
  return beforeBirthday ? age - 1 : age;
}

// Pulls the AAMVA elements out of the raw barcode text into { DCS: 'SMITH', ... }.
function elements(text) {
  const out = {};
  for (let line of text.split(/[\r\n\x1e]+/)) {
    line = line.trim();
    // The first element of a subfile is glued to its type: "DLDAQ…"/"IDDAQ…".
    const m = line.match(/(?:^|DL|ID)(D[A-Z]{2})(.*)$/);
    if (!m) continue;
    const [, code, value] = m;
    if (!(code in out)) out[code] = value.trim();
  }
  return out;
}

const NONE = new Set(['', 'NONE', 'UNAVL', 'UNAVAILABLE']);
const clean = v => (v && !NONE.has(v.toUpperCase()) ? v : '');

// Raw barcode text -> { name, dob, age, sex, address } (only what was found),
// or null if it doesn't look like a license barcode at all.
export function parseLicense(text) {
  if (!text || !/ANSI|AAMVA|\bDL|DCS|DAA/.test(text)) return null;
  const e = elements(text);

  // Name: AAMVA 2009+ splits it (DCS last, DAC first, DAD middle); older
  // versions use DAA "LAST,FIRST,MIDDLE" or DCT "FIRST MIDDLE".
  let last = clean(e.DCS) || clean(e.DAB);
  let first = clean(e.DAC) || clean(e.DCT);
  let middle = clean(e.DAD);
  if (!last && e.DAA) {
    const parts = e.DAA.split(/[,$]/).map(s => s.trim()).filter(Boolean);
    [last, first, middle] = [parts[0] || '', parts[1] || '', parts[2] || ''];
  }
  if (first && !middle && first.includes(' ') && !e.DAC) {
    const [f, ...rest] = first.split(/\s+/);
    first = f; middle = rest.join(' ');
  }

  const fields = {};
  const given = [first, middle].filter(Boolean).map(titleCase).join(' ');
  if (last || given) fields.name = [last && titleCase(last), given].filter(Boolean).join(', ');

  const dob = parseDob(e.DBB);
  if (dob) {
    fields.dob = `${String(dob.getMonth() + 1).padStart(2, '0')}/${String(dob.getDate()).padStart(2, '0')}/${dob.getFullYear()}`;
    fields.age = String(ageOn(dob));
  }

  const sex = (e.DBC || '').trim().toUpperCase();
  if (sex === '1' || sex === 'M') fields.sex = 'M';
  else if (sex === '2' || sex === 'F') fields.sex = 'F';
  else if (sex === '9' || sex === 'X') fields.sex = 'Other';

  const street = [clean(e.DAG), clean(e.DAH)].filter(Boolean).map(titleCase).join(' ');
  const city = clean(e.DAI) ? titleCase(clean(e.DAI)) : '';
  const state = clean(e.DAJ).toUpperCase();
  const zip = clean(e.DAK).replace(/\s/g, '').replace(/0000$/, '').replace(/^(\d{5})(\d{4})$/, '$1-$2');
  const cityLine = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const address = [street, cityLine].filter(Boolean).join(', ');
  if (address) fields.address = address;

  return Object.keys(fields).length ? fields : null;
}
