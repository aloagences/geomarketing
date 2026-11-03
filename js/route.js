// ========================================
// TOURNÉE — unicité des lieux, couverture de zone, ordre de passage
// Fonctions pures (aucun accès DOM) : chargées avant app.js.
// ========================================

/** En deçà, deux arrêts sont le même emplacement pour le camion. */
const MEME_EMPLACEMENT_KM = 0.03;
/** Un lieu plus proche que ça d'un arrêt du jour n'étend pas la couverture. */
const ECART_SOUHAITE_KM = 0.15;
/** Au-delà, l'enchaînement avec l'arrêt précédent dépasse un trajet de ~15 min. */
const TRAJET_MAX_KM = 5;

const _cles = new Map();
/** Clé de comparaison d'un nom : sans accents, casse ni ponctuation. */
function cleLieu(nom) {
  let cle = _cles.get(nom);
  if (cle === undefined) {
    cle = (nom || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    _cles.set(nom, cle);
  }
  return cle;
}

const _nomDe = (x) => x?.locationName ?? x?.name ?? '';
const _aCoords = (x) => !!(x && x.lat && x.lng);

/** Distance en km, approximation plane (suffisante à l'échelle d'une campagne). */
function kmPlan(a, b) {
  const x = (b.lng - a.lng) * Math.cos((a.lat + b.lat) * Math.PI / 360);
  return Math.hypot(x, b.lat - a.lat) * 111.19;
}

/** Même lieu : même nom, ou même emplacement physique. */
function memeLieu(a, b) {
  const ka = cleLieu(_nomDe(a));
  if (ka && ka === cleLieu(_nomDe(b))) return true;
  return _aCoords(a) && _aCoords(b) && kmPlan(a, b) < MEME_EMPLACEMENT_KM;
}

/**
 * Meilleur lieu du pool pour compléter ou remplacer un arrêt.
 *
 * Exclusions dures : lieu déjà présent dans la journée (nom ou emplacement),
 * ou refusé par `accepte`. Le reste se joue au score, qui sert la consigne
 * « le camion couvre toute la zone » :
 *  - qualité du lieu (publicScore) ;
 *  - lieu encore jamais visité plutôt que repassé ;
 *  - éloigné des arrêts des AUTRES jours (étend la couverture) ;
 *  - proche du centre de gravité du jour (tournée compacte) et de l'arrêt
 *    précédent (trajet tenable entre deux secteurs).
 *
 * @param {Array}  pool
 * @param {Object} o
 * @param {Array}  o.dejaLa       arrêts déjà programmés ce jour
 * @param {Map}    o.utilisations nom → nombre de passages sur la campagne
 * @param {number} o.perimetre    rayon de campagne (km)
 * @param {Array}  o.visites      points des autres jours
 * @param {Object} [o.ref]        arrêt précédent
 * @param {Function} [o.accepte]  filtre métier (marché fermé, hors zone INSEE…)
 * @param {Function} [o.dispo]    quota de réutilisation ; absent = réutilisation permise
 */
function choisirLieu(pool, o) {
  const { dejaLa = [], utilisations = new Map(), visites = [], ref = null,
    accepte = null, dispo = null } = o;
  const P = Math.max(o.perimetre || 5, 1);
  const placees = dejaLa.filter(_aCoords);
  const centre = placees.length
    ? {
        lat: placees.reduce((t, s) => t + s.lat, 0) / placees.length,
        lng: placees.reduce((t, s) => t + s.lng, 0) / placees.length,
      }
    : (_aCoords(ref) ? ref : null);

  let meilleur = null, meilleurScore = -Infinity;
  for (const p of pool) {
    if (!_aCoords(p)) continue;
    if (dispo && !dispo(p)) continue;
    if (accepte && !accepte(p)) continue;
    if (dejaLa.some(s => memeLieu(s, p))) continue;

    let dVisites = Infinity;
    for (const v of visites) {
      const d = kmPlan(v, p);
      if (d < dVisites) dVisites = d;
    }
    if (dVisites === Infinity) dVisites = P;

    const usage = utilisations.get(p.name) || 0;
    const score = (p.publicScore || p.reliability || 1)
      - 6 * usage
      + 3 * Math.min(dVisites, P / 2) / (P / 2)
      - (centre ? 4 * Math.min(kmPlan(centre, p), P) / P : 0)
      - (placees.some(s => kmPlan(s, p) < ECART_SOUHAITE_KM) ? 2 : 0)
      - (_aCoords(ref) && kmPlan(ref, p) > TRAJET_MAX_KM ? 3 : 0);

    if (score > meilleurScore) { meilleurScore = score; meilleur = p; }
  }
  return meilleur;
}

/**
 * Supprime les doublons de lieu d'une journée : le premier passage est
 * conservé, les suivants sont remplacés (via `remplacer`) ou retirés s'il n'y
 * a vraiment aucun autre lieu à proposer. Les arrêts `fixe` (centres
 * équestres, écoles) ne bougent jamais : c'est l'autre exemplaire qui cède.
 *
 * @returns {{stops: Array, remplaces: number, retires: number}}
 */
function dedoublonnerJour(stops, { fixe = () => false, remplacer }) {
  const retenus = stops.filter(fixe);
  const retires = new Set();
  let remplaces = 0;

  for (const s of stops) {
    if (fixe(s)) continue;
    if (retenus.some(r => memeLieu(r, s))) {
      if (remplacer(s, retenus)) remplaces++;
      else { retires.add(s); continue; }
    }
    retenus.push(s);
  }
  return { stops: stops.filter(s => !retires.has(s)), remplaces, retires: retires.size };
}

/** Longueur du trajet depart → seq[0] → seq[1] → … (km). */
function _longueur(seq, depart) {
  let total = 0, prev = _aCoords(depart) ? depart : null;
  for (const s of seq) {
    if (!_aCoords(s)) continue;
    if (prev) total += kmPlan(prev, s);
    prev = s;
  }
  return total;
}

/**
 * Ordre de passage des arrêts mobiles d'une demi-journée.
 *
 * `fixes[i]` est l'arrêt imposé au secteur i (école à son horaire) ou null.
 * Les arrêts `libres` se répartissent dans les secteurs vides : ceux marqués
 * `_premier` (marché du matin, centre commercial du mercredi/samedi) passent
 * d'abord, les autres suivent le plus court chemin — plus proche voisin, puis
 * échanges tant que le trajet raccourcit. Renvoie les libres dans l'ordre des
 * secteurs vides.
 */
function ordonnerLibres(fixes, libres, depart = null) {
  const vides = [];
  fixes.forEach((s, i) => { if (!s) vides.push(i); });
  if (libres.length !== vides.length || libres.length < 2) return libres.slice();

  const seq = fixes.slice();
  const premiers = libres.filter(s => s._premier);
  const reste = libres.filter(s => !s._premier);
  premiers.forEach((s, k) => { seq[vides[k]] = s; });
  const mobiles = vides.slice(premiers.length);

  for (const i of mobiles) {
    const prev = i > 0 ? seq[i - 1] : depart;
    let choix = 0;
    if (_aCoords(prev)) {
      let dMin = Infinity;
      reste.forEach((s, j) => {
        const d = _aCoords(s) ? kmPlan(prev, s) : Infinity;
        if (d < dMin) { dMin = d; choix = j; }
      });
    }
    seq[i] = reste.splice(choix, 1)[0];
  }

  let courant = _longueur(seq, depart);
  for (let passe = 0, mieux = true; mieux && passe < 5; passe++) {
    mieux = false;
    for (let a = 0; a < mobiles.length; a++) {
      for (let b = a + 1; b < mobiles.length; b++) {
        const i = mobiles[a], j = mobiles[b];
        [seq[i], seq[j]] = [seq[j], seq[i]];
        const c = _longueur(seq, depart);
        if (c < courant - 1e-9) { courant = c; mieux = true; }
        else [seq[i], seq[j]] = [seq[j], seq[i]];
      }
    }
  }
  return vides.map(i => seq[i]);
}

/**
 * Bilan d'une tournée : kilomètres par jour, doublons restants dans une même
 * journée, et part de la zone parcourue (8 secteurs de 45° autour du départ).
 */
function bilanTournee(dailyPlans, origine) {
  const octants = new Set();
  let doublons = 0;
  const km = dailyPlans.map(day => {
    const stops = (day.stops || []).filter(_aCoords);
    stops.forEach((s, i) => {
      if (stops.slice(0, i).some(p => memeLieu(p, s))) doublons++;
      if (_aCoords(origine) && kmPlan(origine, s) > 0.3) {
        const angle = Math.atan2(s.lat - origine.lat,
          (s.lng - origine.lng) * Math.cos(origine.lat * Math.PI / 180));
        octants.add(Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 8) % 8);
      }
    });
    return +_longueur(stops, origine).toFixed(1);
  });
  return { km, doublons, octants: octants.size };
}
