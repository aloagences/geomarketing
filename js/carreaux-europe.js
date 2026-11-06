/**
 * carreaux-europe.js — Population des pays voisins sur la carte du potentiel.
 *
 * Les carreaux INSEE s'arrêtent à la frontière. Au-delà (Allemagne, Suisse, Italie, Espagne,
 * Belgique, Luxembourg), on lit la grille européenne du recensement 2021 (Eurostat, carrés de
 * 1 km), compactée en tuiles dans data/carreaux-europe/ par tools/build_carreaux_europe.py.
 *
 * Les deux grilles sont la MÊME grille européenne (ETRS89-LAEA, EPSG:3035) : un carré de 1 km
 * contient exactement 25 carreaux INSEE de 200 m. On le découpe donc en 25 carreaux de 200 m
 * qui se partagent ses habitants. Ils portent le même type d'identifiant que les carreaux
 * INSEE (CRS3035RES200mN…E…) : pinceau, secteurs, contour et page PDF les traitent à
 * l'identique, sans couture à la frontière. Sur un carré à cheval sur la frontière, les
 * carreaux déjà couverts par l'INSEE sont laissés aux Français : la population du pays
 * voisin se répartit sur les autres, de son côté.
 *
 * Seule la population est connue (pas de ménages ni de revenus) : le nombre de ménages est
 * estimé avec la taille moyenne des ménages du pays.
 */

const EUROPE_BASE = 'data/carreaux-europe/';
let _europeIndex;          // undefined = pas encore lu, null = indisponible

// --- Projection ETRS89-LAEA (EPSG:3035), ellipsoïde GRS80 — formules de Snyder ---
const _LAEA = (() => {
  const a = 6378137, e2 = 0.00669438002290, e = Math.sqrt(e2);
  const lat0 = 52 * Math.PI / 180, lon0 = 10 * Math.PI / 180, FE = 4321000, FN = 3210000;
  const q = (phi) => {
    const s = Math.sin(phi);
    return (1 - e2) * (s / (1 - e2 * s * s) - (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s)));
  };
  const qp = q(Math.PI / 2);
  const b1 = Math.asin(q(lat0) / qp);
  const Rq = a * Math.sqrt(qp / 2);
  const D = a * Math.cos(lat0) / (Math.sqrt(1 - e2 * Math.sin(lat0) ** 2) * Rq * Math.cos(b1));
  return { e2, lat0, lon0, FE, FN, q, qp, b1, Rq, D };
})();

/** (N, E) en mètres EPSG:3035 → [lat, lng] en degrés. */
function laeaVersWgs(n, e) {
  const { e2, lon0, FE, FN, b1, Rq, D } = _LAEA;
  const x = e - FE, y = n - FN;
  const rho = Math.hypot(x / D, D * y);
  if (rho < 1e-9) return [52, 10];
  const C = 2 * Math.asin(rho / (2 * Rq));
  const bp = Math.asin(Math.cos(C) * Math.sin(b1) + (D * y * Math.sin(C) * Math.cos(b1)) / rho);
  const lon = lon0 + Math.atan2(x * Math.sin(C),
    D * rho * Math.cos(b1) * Math.cos(C) - D * D * y * Math.sin(b1) * Math.sin(C));
  const e4 = e2 * e2, e6 = e4 * e2;
  const lat = bp + (e2 / 3 + 31 * e4 / 180 + 517 * e6 / 5040) * Math.sin(2 * bp)
    + (23 * e4 / 360 + 251 * e6 / 3780) * Math.sin(4 * bp) + (761 * e6 / 45360) * Math.sin(6 * bp);
  return [lat * 180 / Math.PI, lon * 180 / Math.PI];
}

/** [lat, lng] en degrés → { n, e } en mètres EPSG:3035. */
function wgsVersLaea(lat, lng) {
  const { lon0, FE, FN, q, qp, b1, Rq, D } = _LAEA;
  const phi = lat * Math.PI / 180, dl = lng * Math.PI / 180 - lon0;
  const b = Math.asin(q(phi) / qp);
  const B = Rq * Math.sqrt(2 / (1 + Math.sin(b1) * Math.sin(b) + Math.cos(b1) * Math.cos(b) * Math.cos(dl)));
  return {
    e: FE + B * D * Math.cos(b) * Math.sin(dl),
    n: FN + (B / D) * (Math.cos(b1) * Math.sin(b) - Math.sin(b1) * Math.cos(b) * Math.cos(dl)),
  };
}

async function _lireIndexEurope() {
  if (_europeIndex !== undefined) return _europeIndex;
  try {
    const r = await fetch(`${EUROPE_BASE}index.json`);
    if (!r.ok) throw new Error(`index ${r.status}`);
    const idx = await r.json();
    idx._tuiles = new Set(idx.tuiles);
    _europeIndex = idx;
  } catch (e) {
    console.warn('[Europe] index des carreaux voisins illisible', e);
    _europeIndex = null;
  }
  return _europeIndex;
}

/**
 * Carreaux de 200 m des pays voisins dans le rayon, au même format que fetchCarreauxINSEE.
 * `clesFrance` : identifiants des carreaux INSEE déjà chargés (laissés aux Français).
 */
async function fetchCarreauxEurope(lat, lng, radiusKm, clesFrance = new Set()) {
  const idx = await _lireIndexEurope();
  if (!idx) return [];
  const T = idx.tuile, R = idx.resolution;          // 50 000 m, 1 000 m

  // Emprise du cercle dans la grille, avec une marge d'un carré.
  const dLat = radiusKm / 111, dLng = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  const coins = [[lat - dLat, lng - dLng], [lat - dLat, lng + dLng], [lat + dLat, lng - dLng], [lat + dLat, lng + dLng]]
    .map(([a, b]) => wgsVersLaea(a, b));
  const nMin = Math.min(...coins.map(c => c.n)) - R, nMax = Math.max(...coins.map(c => c.n)) + R;
  const eMin = Math.min(...coins.map(c => c.e)) - R, eMax = Math.max(...coins.map(c => c.e)) + R;

  const cles = [];
  for (let tn = Math.floor(nMin / T); tn <= Math.floor(nMax / T); tn++) {
    for (let te = Math.floor(eMin / T); te <= Math.floor(eMax / T); te++) {
      if (idx._tuiles.has(`${tn}_${te}`)) cles.push([tn, te]);
    }
  }
  if (!cles.length) return [];

  const tuiles = await Promise.allSettled(cles.map(async ([tn, te]) => {
    const r = await fetch(`${EUROPE_BASE}tuiles/${tn}_${te}.json`);
    if (!r.ok) throw new Error(`tuile ${tn}_${te} : ${r.status}`);
    return { tn, te, data: await r.json() };
  }));

  const carreaux = [];
  const PAS = 200, PAR_COTE = R / PAS;               // 5 × 5 carreaux de 200 m par carré
  for (const t of tuiles) {
    if (t.status !== 'fulfilled') { console.warn('[Europe]', t.reason); continue; }
    const { tn, te, data } = t.value;
    const c = data.c;
    const pasT = data.n ? 4 : 3;                     // [k, habitants, pays, nom] (nom absent des anciennes tuiles)
    for (let i = 0; i < c.length; i += pasT) {
      const k = c[i], hab = c[i + 1], code = data.p[c[i + 2]];
      const nomCarre = data.n && c[i + 3] >= 0 ? data.n[c[i + 3]] : '';
      const n0 = tn * T + Math.floor(k / 50) * R, e0 = te * T + (k % 50) * R;
      if (n0 < nMin || n0 > nMax || e0 < eMin || e0 > eMax) continue;
      const [cLat, cLng] = laeaVersWgs(n0 + R / 2, e0 + R / 2);
      if (calculateDistance(lat, lng, cLat, cLng) > radiusKm + 1) continue;

      // Les 25 carreaux de 200 m du carré, sauf ceux déjà couverts par l'INSEE.
      const sous = [];
      for (let a = 0; a < PAR_COTE; a++) {
        for (let b = 0; b < PAR_COTE; b++) {
          const n = n0 + a * PAS, e = e0 + b * PAS;
          const cle = `CRS3035RES200mN${n}E${e}`;
          if (!clesFrance.has(cle)) sous.push({ n, e, cle });
        }
      }
      if (!sous.length) continue;

      // Répartition entière : la somme des carreaux redonne exactement les habitants du carré.
      const base = Math.floor(hab / sous.length);
      const reste = hab - base * sous.length;
      const taille = idx.pays[code]?.tailleMenage || 2.2;
      sous.forEach((s, j) => {
        const ind = base + (j < reste ? 1 : 0);
        const [sLat, sLng] = laeaVersWgs(s.n + PAS / 2, s.e + PAS / 2);
        if (calculateDistance(lat, lng, sLat, sLng) > radiusKm) return;
        carreaux.push({
          cle: s.cle, n: s.n, e: s.e,
          ind, men: Math.round(ind / taille),
          commune: nomCarre, pays: code, paysNom: idx.pays[code]?.nom || code, etranger: true,
          carre1km: `${n0}/${e0}`,
          lat: sLat, lng: sLng,
          ring: [laeaVersWgs(s.n, s.e), laeaVersWgs(s.n, s.e + PAS), laeaVersWgs(s.n + PAS, s.e + PAS), laeaVersWgs(s.n + PAS, s.e)],
        });
      });
    }
  }
  return carreaux;
}
