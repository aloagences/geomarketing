// ========================================
// TRAINS — caler la présence du véhicule en gare sur les arrivées / départs
// API : SNCF (Navitia) — horaires théoriques et temps réel de toutes les gares.
// Jeton gratuit (https://numerique.sncf.com/startup/api/) à saisir dans le
// formulaire ; sans jeton, rien ne change : l'arrêt garde son créneau.
// ========================================

const NAVITIA_URL = 'https://api.sncf.com/v1/coverage/sncf';
const GARE_RAYON_M = 600;
/** Présence en gare : le véhicule arrive avant le train, pas pile à l'heure. */
const GARE_PRESENCE_MIN = 45;
const GARE_AVANCE_MIN = 10;
const GARE_TRAJET_MIN = 15;

const STORAGE_SNCF = 'sncf_api_key';

function jetonSNCF() {
  return (document.getElementById('sncfToken')?.value || '').trim();
}

/** Mémorise le jeton saisi et le restaure à l'ouverture. */
function initJetonSNCF() {
  const input = document.getElementById('sncfToken');
  if (!input) return;
  const saved = safeGetItem(STORAGE_SNCF);
  if (saved && !input.value) input.value = saved;
  input.addEventListener('change', () => safeSetItem(STORAGE_SNCF, input.value.trim()));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initJetonSNCF);
else initJetonSNCF();

/** Une gare (pas un arrêt de bus ni de tram) ? */
function estGare(stop) {
  if (stop.gare) return true;
  const nom = stop.locationName || '';
  return /\bgare\b/i.test(nom) && !/routi[eè]re|bus|tram/i.test(nom);
}

/**
 * Appel Navitia. `null` = service injoignable ; `{auth: true}` = jeton refusé.
 */
async function navitia(chemin, jeton) {
  try {
    const res = await fetch(NAVITIA_URL + chemin, {
      headers: { Authorization: 'Basic ' + btoa(jeton + ':') },
    });
    if (res.status === 401 || res.status === 403) return { auth: true };
    if (!res.ok) return res.status === 404 ? { introuvable: true } : null;
    return { json: await res.json() };
  } catch {
    return null;
  }
}

const _garesTrouvees = new Map();
/** Gare SNCF (stop_area) la plus proche d'un point, ou null. */
async function trouverGareSNCF(lat, lng, jeton) {
  const cle = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (_garesTrouvees.has(cle)) return _garesTrouvees.get(cle);
  const rep = await navitia(
    `/coords/${lng};${lat}/places_nearby?type[]=stop_area&distance=${GARE_RAYON_M}&count=5`, jeton);
  if (!rep?.json) return rep;                                   // erreur : on la remonte
  const gare = (rep.json.places_nearby || [])
    .find(p => p.embedded_type === 'stop_area' && /^stop_area:SNCF:/.test(p.id));
  const res = gare ? { id: gare.id, nom: gare.name } : { introuvable: true };
  _garesTrouvees.set(cle, res);
  return res;
}

/** « 20261105T101500 » → minutes depuis minuit, si c'est bien la date voulue. */
function _minutesNavitia(dt, dateISO) {
  if (!dt || dt.slice(0, 8) !== dateISO.replace(/-/g, '')) return null;
  return parseInt(dt.slice(9, 11), 10) * 60 + parseInt(dt.slice(11, 13), 10);
}

const _horaires = new Map();
/**
 * Arrivées et départs d'une gare pour un jour donné.
 * Horaires théoriques pour les jours à venir, temps réel pour aujourd'hui.
 * @returns {Promise<{arrivees: number[], departs: number[]} | object | null>}
 */
async function horairesGare(idGare, dateISO, jeton) {
  const cle = `${idGare}|${dateISO}`;
  if (_horaires.has(cle)) return _horaires.get(cle);

  const aujourdhui = new Date().toISOString().slice(0, 10) === dateISO;
  const q = `?from_datetime=${dateISO.replace(/-/g, '')}T000000&duration=86400&count=400`
    + `&data_freshness=${aujourdhui ? 'realtime' : 'base_schedule'}`;
  const [dep, arr] = await Promise.all([
    navitia(`/stop_areas/${idGare}/departures${q}`, jeton),
    navitia(`/stop_areas/${idGare}/arrivals${q}`, jeton),
  ]);
  for (const r of [dep, arr]) if (!r || r.auth) return r;

  const trier = (liste, champ) => [...new Set((liste || [])
    .map(x => _minutesNavitia(x.stop_date_time?.[champ], dateISO))
    .filter(m => m !== null))].sort((a, b) => a - b);
  const res = {
    arrivees: trier(arr.json?.arrivals, 'arrival_date_time'),
    departs: trier(dep.json?.departures, 'departure_date_time'),
  };
  _horaires.set(cle, res);
  return res;
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
 * On cherche (pas de 5 min) le créneau de `presence` minutes qui voit passer le
 * plus d'arrivées + départs, sans empiéter sur les créneaux déjà pris (école,
 * autre gare) ni sur le trajet qui les précède / suit. Le véhicule est ensuite
 * avancé pour arriver `avance` minutes avant le premier train du créneau.
 *
 * @param {{arrivees: number[], departs: number[]}} horaires  minutes depuis minuit
 * @param {{debut: number, fin: number}} fenetre
 * @param {Array<{debut: number, fin: number}>} occupes
 * @returns {null | {debut, fin, arrivees: number[], departs: number[]}}
 */
function meilleurCreneauGare(horaires, fenetre, occupes = [],
  { presence = GARE_PRESENCE_MIN, avance = GARE_AVANCE_MIN, trajet = GARE_TRAJET_MIN, libresRequis = 0 } = {}) {
  // Créneau valable : sans empiéter sur les autres, et en laissant assez de
  // créneaux entiers aux arrêts ordinaires de la demi-journée.
  const libre = (d, f) => !occupes.some(o => d < o.fin + trajet && f > o.debut - trajet)
    && creneauxLibres(fenetre.debut, fenetre.fin, [...occupes, { debut: d, fin: f }],
      { presence, trajet }).length >= libresRequis;
  const dans = (liste, d, f) => liste.filter(m => m >= d + 5 && m <= f);

  let meilleur = null;
  for (let d = fenetre.debut; d + 30 <= fenetre.fin; d += 5) {
    const f = Math.min(d + presence, fenetre.fin);
    if (!libre(d, f)) continue;
    const n = dans(horaires.arrivees, d, f).length + dans(horaires.departs, d, f).length;
    if (n > (meilleur?.n ?? 0)) meilleur = { d, f, n };
  }
  if (!meilleur) return null;

  // Arriver un peu avant le premier train, sans reculer la fin du créneau.
  const premier = Math.min(...[...dans(horaires.arrivees, meilleur.d, meilleur.f),
    ...dans(horaires.departs, meilleur.d, meilleur.f)]);
  let debut = Math.max(meilleur.d, premier - avance);
  let fin = Math.min(debut + presence, fenetre.fin);
  if (!libre(debut, fin)) { debut = meilleur.d; fin = meilleur.f; }

  return {
    debut, fin,
    arrivees: dans(horaires.arrivees, debut, fin),
    departs: dans(horaires.departs, debut, fin),
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
 * @returns {Promise<{etat: 'ok'|'sans-jeton'|'jeton-refuse'|'indisponible', calees: number, sansTrain: number}>}
 */
async function calerGares(dailyPlans, perDayTimes, datesISO, jeton) {
  const bilan = { etat: 'ok', calees: 0, sansTrain: 0 };
  if (!jeton) return { ...bilan, etat: 'sans-jeton' };

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
      const gare = await trouverGareSNCF(stop.lat, stop.lng, jeton);
      if (!gare) return { ...bilan, etat: 'indisponible' };
      if (gare.auth) return { ...bilan, etat: 'jeton-refuse' };
      if (gare.introuvable) continue;                         // arrêt qui n'est pas une gare SNCF
      if (garesDuJour.has(gare.id)) continue;                 // même gare deux fois : la 2e reste ordinaire
      garesDuJour.add(gare.id);

      const horaires = await horairesGare(gare.id, dateISO, jeton);
      if (!horaires) return { ...bilan, etat: 'indisponible' };
      if (horaires.auth) return { ...bilan, etat: 'jeton-refuse' };

      const occupes = (matin) => day.stops
        .filter(s => s !== stop && (toMin(s.time) < COUPURE) === matin)
        .map(s => s._gare ? s._gare : (s.type === 'school' ? { debut: toMin(s.time), fin: toMin(s.time) + 30 } : null))
        .filter(Boolean);

      const matinActuel = toMin(stop.time) < COUPURE;
      let creneau = null;
      for (const essai of [matinActuel, !matinActuel]) {
        const fen = fenetreDe(essai);
        if (!fen) continue;
        const libresRequis = day.stops.filter(s => s !== stop && !s._gare && s.type !== 'school'
          && (toMin(s.time) < COUPURE) === essai).length - (essai !== matinActuel ? 1 : 0);
        creneau = meilleurCreneauGare(horaires, fen, occupes(essai), { libresRequis });
        if (!creneau) continue;
        if (essai !== matinActuel) {
          // Échange de place avec un arrêt ordinaire de l'autre demi-journée.
          const autre = day.stops.find(s => s !== stop && !estGare(s) && s.type !== 'school'
            && s.type !== 'equestrian' && (toMin(s.time) < COUPURE) === essai);
          if (!autre) { creneau = null; continue; }
          [stop.time, autre.time] = [autre.time, stop.time];
        }
        break;
      }

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
        arriveeVehicule: _hhmm(creneau.debut),
      };
      bilan.calees++;
      console.log(`[Trains] ${day.day} : ${gare.nom} — véhicule ${_hhmm(creneau.debut)}-${_hhmm(creneau.fin)}, `
        + `${creneau.arrivees.length} arrivée(s), ${creneau.departs.length} départ(s).`);
    }
  }
  return bilan;
}
