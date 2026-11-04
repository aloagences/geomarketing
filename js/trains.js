// ========================================
// TRAINS — caler la présence du véhicule en gare sur les arrivées / départs
// Source : GTFS SNCF (open data, transport.data.gouv.fr), compacté dans
// data/gares-sncf.json par tools/build_gares_sncf.py. Aucune clé, aucun appel
// réseau externe : ce sont les horaires PRÉVUS, valables pour n'importe quelle
// date de la période couverte par le fichier.
// ========================================

const GARES_URL = 'data/gares-sncf.json';
const GARE_RAYON_M = 600;
/** Présence en gare : le véhicule arrive avant le train, pas pile à l'heure. */
const GARE_PRESENCE_MIN = 45;
const GARE_AVANCE_MIN = 10;
const GARE_TRAJET_MIN = 15;

/** Une gare (pas un arrêt de bus ni de tram) ? */
function estGare(stop) {
  if (stop.gare) return true;
  const nom = stop.locationName || '';
  return /\bgare\b/i.test(nom) && !/routi[eè]re|bus|tram/i.test(nom);
}

let _promesseGares = null;
/**
 * Charge le fichier des horaires (une seule fois, puis le cache du navigateur).
 * Renvoie la base décodée, ou null si le fichier est absent ou illisible.
 */
function chargerGares() {
  if (!_promesseGares) {
    _promesseGares = fetch(GARES_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => ({
        debut: d.debut, fin: d.fin,
        debutMs: Date.UTC(...d.debut.split('-').map((v, i) => i === 1 ? v - 1 : +v)),
        nbJours: Math.round((Date.parse(d.fin) - Date.parse(d.debut)) / 86400000) + 1,
        gares: d.gares, services: d.services, evenements: d.evenements,
      }))
      .catch((e) => { console.warn('[Trains] horaires indisponibles :', e.message); _promesseGares = null; return null; });
  }
  return _promesseGares;
}

/** Distance en mètres (haversine suffisante à cette échelle : approximation plane). */
function _distM(lat1, lng1, lat2, lng2) {
  const x = (lng2 - lng1) * Math.cos((lat1 + lat2) * Math.PI / 360);
  return Math.hypot(x, lat2 - lat1) * 111190;
}

/** Gare SNCF la plus proche d'un point, à moins de GARE_RAYON_M, ou null. */
function garePlusProche(base, lat, lng) {
  let meilleure = null, dMin = GARE_RAYON_M;
  base.gares.forEach((g, i) => {
    const d = _distM(lat, lng, g[2], g[3]);
    if (d < dMin) { dMin = d; meilleure = { idx: i, uic: g[0], nom: g[1] }; }
  });
  return meilleure;
}

/**
 * Arrivées et départs prévus d'une gare pour un jour (minutes depuis minuit).
 * `{horsPeriode: true}` si la date sort de la période couverte par le fichier.
 */
function horairesGare(base, gare, dateISO) {
  const i = Math.round((Date.parse(dateISO) - base.debutMs) / 86400000);
  if (!(i >= 0 && i < base.nbJours)) return { horsPeriode: true };
  const circule = (svc) => (parseInt(base.services[svc][i >> 2], 16) >> (3 - (i & 3))) & 1;
  const arrivees = new Set(), departs = new Set(), grandesLignes = new Set();
  let v = 0;
  for (const delta of base.evenements[gare.idx]) {
    v += delta;                                           // événements triés, stockés en différences
    if (!circule(Math.floor(v / 16384))) continue;
    const m = (v % 16384) >> 3, arrivee = (v & 3) === 1;
    (arrivee ? arrivees : departs).add(m);
    if ((v >> 2) & 1) grandesLignes.add(`${arrivee ? 'a' : 'd'}${m}`);
  }
  return {
    arrivees: [...arrivees].sort((x, y) => x - y),
    departs: [...departs].sort((x, y) => x - y),
    grandesLignes,                                        // « a720 » : une grande ligne arrive à 12:00
  };
}

/**
 * Poids d'un train pour toucher du monde : un voyageur qui descend traverse le
 * parvis (poids 1), celui qui part y arrive avant son train (0,5) ; un TGV ou un
 * Intercités charrie bien plus de monde qu'un TER (x2,5).
 */
const POIDS_DEPART = 0.5;
const POIDS_GRANDE_LIGNE = 2.5;
function poidsTrain(horaires, genre, m) {
  return (genre === 'a' ? 1 : POIDS_DEPART) * (horaires.grandesLignes?.has(`${genre}${m}`) ? POIDS_GRANDE_LIGNE : 1);
}

/**
 * Débuts des créneaux libres (45 min + 15 min de trajet) dans [debut, fin] une
 * fois posés les créneaux `imposes` (gares, écoles) et leur trajet autour.
 */
function creneauxLibres(debut, fin, imposes,
  { presence = GARE_PRESENCE_MIN, trajet = GARE_TRAJET_MIN } = {}) {
  const debuts = [];
  const remplir = (de, a) => { for (let d = de; d + presence <= a; d += presence + trajet) debuts.push(d); };
  let curseur = debut;
  [...imposes].sort((a, b) => a.debut - b.debut).forEach(p => {
    remplir(curseur, p.debut - trajet);
    curseur = Math.max(curseur, p.fin + trajet);
  });
  remplir(curseur, fin);
  return debuts;
}

/**
 * Meilleur créneau de présence en gare dans une fenêtre horaire.
 *
 * On cherche (pas de 5 min) le créneau de `presence` minutes où passent le plus
 * de voyageurs (arrivées et départs pondérés par `poidsTrain`), sans empiéter
 * sur les créneaux déjà pris (école, autre gare) ni sur leur trajet. Le véhicule
 * est ensuite avancé pour arriver `avance` minutes avant le premier train.
 *
 * @param {{arrivees: number[], departs: number[], grandesLignes?: Set<string>}} horaires
 * @param {{debut: number, fin: number}} fenetre
 * @param {Array<{debut: number, fin: number}>} occupes
 * @returns {null | {debut, fin, score, arrivees: number[], departs: number[], grandesLignes: number}}
 */
function meilleurCreneauGare(horaires, fenetre, occupes = [],
  { presence = GARE_PRESENCE_MIN, avance = GARE_AVANCE_MIN, trajet = GARE_TRAJET_MIN, libresRequis = 0 } = {}) {
  // Créneau valable : sans empiéter sur les autres, et en laissant assez de
  // créneaux entiers aux arrêts ordinaires de la demi-journée.
  const libre = (d, f) => !occupes.some(o => d < o.fin + trajet && f > o.debut - trajet)
    && creneauxLibres(fenetre.debut, fenetre.fin, [...occupes, { debut: d, fin: f }],
      { presence, trajet }).length >= libresRequis;
  const dans = (liste, d, f) => liste.filter(m => m >= d + 5 && m <= f);
  const score = (d, f) =>
    dans(horaires.arrivees, d, f).reduce((t, m) => t + poidsTrain(horaires, 'a', m), 0)
    + dans(horaires.departs, d, f).reduce((t, m) => t + poidsTrain(horaires, 'd', m), 0);

  let meilleur = null;
  for (let d = fenetre.debut; d + 30 <= fenetre.fin; d += 5) {
    const f = Math.min(d + presence, fenetre.fin);
    if (!libre(d, f)) continue;
    const sc = score(d, f);
    if (sc > (meilleur?.sc ?? 0)) meilleur = { d, f, sc };
  }
  if (!meilleur) return null;

  // Arriver un peu avant le premier train, sans reculer la fin du créneau.
  const premier = Math.min(...dans(horaires.arrivees, meilleur.d, meilleur.f),
    ...dans(horaires.departs, meilleur.d, meilleur.f));
  let debut = Math.max(meilleur.d, premier - avance);
  let fin = Math.min(debut + presence, fenetre.fin);
  if (!libre(debut, fin) || score(debut, fin) < meilleur.sc) { debut = meilleur.d; fin = meilleur.f; }

  const arrivees = dans(horaires.arrivees, debut, fin), departs = dans(horaires.departs, debut, fin);
  return {
    debut, fin, score: score(debut, fin), arrivees, departs,
    grandesLignes: arrivees.filter(m => horaires.grandesLignes?.has(`a${m}`)).length
      + departs.filter(m => horaires.grandesLignes?.has(`d${m}`)).length,
  };
}

const _hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Cale chaque arrêt « gare » sur les horaires de trains du jour : pose
 * `stop._gare = {debut, fin}` (minutes, repris par applySectorTimes) et
 * `stop.trains` (pour l'affichage). Si la gare n'a aucun train dans son
 * demi-journée mais en a dans l'autre, l'arrêt échange sa place avec un arrêt
 * ordinaire de l'autre demi-journée.
 *
 * @returns {Promise<{etat: 'ok'|'indisponible'|'hors-periode', calees: number, sansTrain: number, horsPeriode: Set<string>, periode?: {debut: string, fin: string}}>}
 */
async function calerGares(dailyPlans, perDayTimes, datesISO) {
  const bilan = { etat: 'ok', calees: 0, sansTrain: 0, horsPeriode: new Set() };
  const base = await chargerGares();
  if (!base) return { ...bilan, etat: 'indisponible' };
  bilan.periode = { debut: base.debut, fin: base.fin };

  const toMin = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
  const COUPURE = 14 * 60;

  for (let i = 0; i < dailyPlans.length; i++) {
    const day = dailyPlans[i], t = perDayTimes[i], dateISO = datesISO[i];
    if (!t || !dateISO || !day.stops?.length) continue;

    const fenetreDe = (matin) => matin
      ? (t.hasMorning ? { debut: toMin(t.mornStart), fin: toMin(t.mornEnd) } : null)
      : (t.hasAfternoon ? { debut: toMin(t.aftStart), fin: toMin(t.aftEnd) } : null);

    const garesDuJour = new Set();
    for (const stop of day.stops.filter(s => estGare(s) && s.lat && s.lng && s.type !== 'school')) {
      const gare = garePlusProche(base, stop.lat, stop.lng);
      if (!gare) continue;                                    // arrêt qui n'est pas une gare SNCF
      if (garesDuJour.has(gare.uic)) continue;                // même gare deux fois : la 2e reste ordinaire
      garesDuJour.add(gare.uic);

      const horaires = horairesGare(base, gare, dateISO);
      if (horaires.horsPeriode) { bilan.horsPeriode.add(dateISO); continue; }

      const occupes = (matin) => day.stops
        .filter(s => s !== stop && (toMin(s.time) < COUPURE) === matin)
        .map(s => s._gare ? s._gare : (s.type === 'school' ? { debut: toMin(s.time), fin: toMin(s.time) + 30 } : null))
        .filter(Boolean);

      // On compare le meilleur créneau du matin et celui de l'après-midi : le
      // véhicule va là où passe le plus de monde, même dans l'autre demi-journée
      // (échange de place avec un arrêt ordinaire) si le gain dépasse 10 %.
      const matinActuel = toMin(stop.time) < COUPURE;
      const candidats = [];
      for (const essai of [matinActuel, !matinActuel]) {
        const fen = fenetreDe(essai);
        if (!fen) continue;
        const libresRequis = day.stops.filter(s => s !== stop && !s._gare && s.type !== 'school'
          && (toMin(s.time) < COUPURE) === essai).length - (essai !== matinActuel ? 1 : 0);
        const c = meilleurCreneauGare(horaires, fen, occupes(essai), { libresRequis });
        if (!c) continue;
        const autre = essai === matinActuel ? null : day.stops.find(s => s !== stop && !estGare(s)
          && s.type !== 'school' && s.type !== 'equestrian' && (toMin(s.time) < COUPURE) === essai);
        if (essai !== matinActuel && !autre) continue;
        candidats.push({ essai, creneau: c, autre });
      }
      let choix = candidats.find(c => c.essai === matinActuel);
      const ailleurs = candidats.find(c => c.essai !== matinActuel);
      if (ailleurs && (!choix || ailleurs.creneau.score > choix.creneau.score * 1.1)) choix = ailleurs;
      if (choix?.autre) [stop.time, choix.autre.time] = [choix.autre.time, stop.time];
      const creneau = choix?.creneau || null;

      if (!creneau) {
        stop.trains = { gare: gare.nom, aucun: true };
        bilan.sansTrain++;
        continue;
      }
      stop._gare = { debut: creneau.debut, fin: creneau.fin };
      stop.trains = {
        gare: gare.nom,
        arrivees: creneau.arrivees.map(_hhmm),
        departs: creneau.departs.map(_hhmm),
        grandesLignes: creneau.grandesLignes,
        arriveeVehicule: _hhmm(creneau.debut),
      };
      bilan.calees++;
      console.log(`[Trains] ${day.day} : ${gare.nom} — véhicule ${_hhmm(creneau.debut)}-${_hhmm(creneau.fin)}, `
        + `${creneau.arrivees.length} arrivée(s), ${creneau.departs.length} départ(s).`);
    }
  }
  if (bilan.horsPeriode.size && !bilan.calees && !bilan.sansTrain) bilan.etat = 'hors-periode';
  return bilan;
}
