// ========================================
// VÉHICULE — gabarit, voies piétonnes, itinéraires
// Flotte : fourgons (≤ 3,5 t) portant des affiches : 4 m de haut, largeur et
// longueur d'utilitaire. API : Valhalla (moteur de routage OSM, sans clé). Seul
// son profil "truck" accepte une hauteur, mais il applique aussi les
// interdictions aux poids lourds, qui ne concernent PAS un utilitaire. Un arrêt
// refusé en "truck" est donc retesté en "auto" : s'il passe, c'est une
// interdiction poids lourd (sans effet pour nous) ou un gabarit limite — l'arrêt
// est conservé et signalé « passage à vérifier » au lieu d'être remplacé. Si le service est injoignable, rien n'est bloqué : le plan est
// livré avec la mention « contraintes camion non vérifiées ».
// ========================================

const VALHALLA_URL = 'https://valhalla1.openstreetmap.de';
const VALHALLA_DELAI_MS = 15000;
/** Rayon de recherche d'une rue carrossable autour d'un lieu. */
const RAYON_VOIE_M = 150;
/** Distance maxi lieu → camion : au-delà, le chauffeur ne distribue plus « devant » le lieu. */
const A_PIED_MAX_M = 150;
/** Le camion ne se gare ni sur un trottoir, ni sur une voie piétonne, un chemin ou un parking. */
const USAGES_CARROSSABLES = new Set(['road', 'service_road', 'living_street', 'culdesac']);
/** Voies rapides : on les emprunte, on ne s'y arrête pas. */
const CLASSES_SANS_ARRET = new Set(['motorway', 'trunk']);

/** Gabarit saisi dans le formulaire (mètres, tonnes) : hauteur = fourgon + affiches. */
function lireCamion() {
  const lire = (id, defaut) => {
    const v = parseFloat(String(document.getElementById(id)?.value || '').replace(',', '.'));
    return v > 0 ? v : defaut;
  };
  return {
    height: lire('vehicleHeight', 4.0),
    width:  lire('vehicleWidth', 2.2),
    length: lire('vehicleLength', 6),
    weight: lire('vehicleWeight', 3.5),
  };
}

/** Appel Valhalla. Renvoie {ok, status, json} ; `null` si le service est injoignable. */
async function valhalla(chemin, corps) {
  const ctl = new AbortController();
  const minuteur = setTimeout(() => ctl.abort(), VALHALLA_DELAI_MS);
  try {
    const res = await fetch(VALHALLA_URL + chemin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
      signal: ctl.signal,
    });
    const json = await res.json().catch(() => null);
    if (res.status >= 500 || res.status === 429) return null;
    return { ok: res.ok, status: res.status, json };
  } catch {
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

const _costing = (camion, profil = 'truck') =>
  profil === 'auto' ? { costing: 'auto' } : { costing: 'truck', costing_options: { truck: camion } };
const _pt = (p) => ({ lat: p.lat, lon: p.lng });

/**
 * Rue carrossable la plus proche d'un lieu, parmi les arêtes renvoyées par
 * Valhalla. Les voies piétonnes, chemins, escaliers et allées de parking sont
 * écartés : le véhicule se gare sur une rue — éventuellement perpendiculaire à
 * la rue piétonne — et non sur la voie piétonne elle-même.
 */
function meilleureVoie(edges) {
  let meilleure = null, meilleurScore = Infinity;
  for (const e of edges || []) {
    const usage = e.edge?.classification?.use;
    if (!USAGES_CARROSSABLES.has(usage) || e.edge?.access?.car === false) continue;
    if (CLASSES_SANS_ARRET.has(e.edge?.classification?.classification)) continue;
    if (e.distance > A_PIED_MAX_M) continue;
    // Un axe classé (résidentiel, secondaire…) est plus visible qu'une desserte.
    const desserte = e.edge?.classification?.classification === 'service_other';
    const score = e.distance + (desserte ? 30 : 0);
    if (score < meilleurScore) {
      meilleurScore = score;
      meilleure = {
        lat: e.correlated_lat, lng: e.correlated_lon,
        rue: (e.edge_info?.names || [])[0] || '',
        aPiedM: Math.round(e.distance),
      };
    }
  }
  return meilleure;
}

/**
 * Pour chaque point, la voie de stationnement du camion (ou null si aucune
 * rue carrossable à moins de A_PIED_MAX_M). `null` global si le service est
 * injoignable. Lots de 10 pour ménager le serveur public.
 */
async function localiserVoies(points, camion) {
  const lots = [];
  for (let i = 0; i < points.length; i += 10) lots.push(points.slice(i, i + 10));
  const resultats = [];
  for (const lot of lots) {
    const rep = await valhalla('/locate', {
      locations: lot.map(p => ({ ..._pt(p), radius: RAYON_VOIE_M })),
      ..._costing(camion), verbose: true,
    });
    if (!rep?.ok || !Array.isArray(rep.json)) return null;
    rep.json.forEach(l => resultats.push(meilleureVoie(l.edges)));
  }
  return resultats;
}

/** Décode une polyligne Valhalla (précision 6) en [[lat, lng], …]. */
function decoderPolyligne(texte) {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  const lire = () => {
    let r = 0, d = 0, b;
    do { b = texte.charCodeAt(i++) - 63; r |= (b & 0x1f) << d; d += 5; } while (b >= 0x20);
    return (r & 1) ? ~(r >> 1) : (r >> 1);
  };
  while (i < texte.length) {
    lat += lire(); lng += lire();
    pts.push([lat / 1e6, lng / 1e6]);
  }
  return pts;
}

/**
 * Itinéraire véhicule à travers `points` (dans l'ordre).
 * @returns {null | {ok: boolean, km?, min?, shape?, erreur?}} null = service injoignable
 */
async function itineraireCamion(points, camion, profil = 'truck') {
  if (points.length < 2) return { ok: true, km: 0, min: 0, shape: [] };
  const rep = await valhalla('/route', {
    locations: points.map(_pt), ..._costing(camion, profil),
    directions_options: { units: 'km' },
  });
  if (!rep) return null;
  if (!rep.ok) return { ok: false, erreur: rep.json?.error || `HTTP ${rep.status}` };
  const trip = rep.json.trip;
  return {
    ok: true,
    km: +trip.summary.length.toFixed(1),
    min: Math.round(trip.summary.time / 60),
    shape: trip.legs.flatMap(l => decoderPolyligne(l.shape)),
  };
}

/**
 * Vérifie que chaque arrêt est accessible au camion, et fixe son point de
 * stationnement (`stop.stationnement = {lat, lng, rue, aPiedM}`).
 *
 *  1. rue carrossable à moins de A_PIED_MAX_M, sinon l'arrêt est refusé
 *     (voie piétonne sans rue perpendiculaire proche, zone fermée aux camions) ;
 *  2. itinéraire véhicule origine → arrêts : un arrêt inatteignable avec la
 *     hauteur / largeur / poids saisis (pont bas, tunnel, rue interdite) est
 *     refusé.
 * Un arrêt refusé est remplacé par `remplacer(stop, indexJour, refuses)` ;
 * à défaut — ou s'il est `fixe` (école, centre équestre) — il est conservé et
 * marqué `aVerifier`. Trois tours maximum.
 *
 * @returns {Promise<{verifie: boolean, remplaces: number, aVerifier: number}>}
 */
async function verifierAccesCamion(dailyPlans, { origine, camion, remplacer, fixe = () => false }) {
  const refuses = new Set();
  let remplaces = 0;

  const arrets = () => dailyPlans.flatMap((d, i) =>
    (d.stops || []).filter(s => s.lat && s.lng && s.type !== 'equestrian').map(s => ({ s, i })));

  for (let tour = 0; tour < 3; tour++) {
    const echecs = [];

    // 1. Rue carrossable
    const aLocaliser = arrets().filter(({ s }) => !s.stationnement);
    if (aLocaliser.length) {
      const voies = await localiserVoies(aLocaliser.map(({ s }) => s), camion);
      if (!voies) return { verifie: false, remplaces, aVerifier: 0 };
      aLocaliser.forEach(({ s, i }, k) => {
        if (voies[k]) s.stationnement = voies[k];
        else echecs.push({ s, i });
      });
    }

    // 2. Itinéraire véhicule, jour par jour (en parallèle)
    const jours = await Promise.all(dailyPlans.map(async (day, i) => {
      const stops = (day.stops || []).filter(s => s.stationnement?.lat && !s.stationnement.passageAVerifier
        && s.type !== 'equestrian');
      if (!stops.length) return [];
      const route = await itineraireCamion([origine, ...stops.map(s => s.stationnement)], camion);
      if (!route) return null;
      if (route.ok) return [];
      // Au moins un arrêt est inatteignable : on isole le ou les coupables.
      // Refusé en "truck" mais accepté en "auto" : interdiction poids lourd ou
      // gabarit limite → conservé, signalé « passage à vérifier ».
      const verdicts = await Promise.all(stops.map(async s => {
        const camionRoute = await itineraireCamion([origine, s.stationnement], camion);
        if (camionRoute === null) return null;
        if (camionRoute.ok) return 'ok';
        const autoRoute = await itineraireCamion([origine, s.stationnement], camion, 'auto');
        if (autoRoute === null) return null;
        return autoRoute.ok ? 'limite' : 'ko';
      }));
      if (verdicts.includes(null)) return null;
      stops.forEach((s, k) => { if (verdicts[k] === 'limite') s.stationnement.passageAVerifier = true; });
      return stops.filter((_, k) => verdicts[k] === 'ko').map(s => ({ s, i }));
    }));
    if (jours.includes(null)) return { verifie: false, remplaces, aVerifier: 0 };
    jours.flat().forEach(e => { delete e.s.stationnement; echecs.push(e); });

    if (!echecs.length) break;

    // 3. Remplacement (ou signalement) des arrêts refusés
    for (const { s, i } of echecs) {
      refuses.add(s.locationName);
      if (fixe(s)) { s.stationnement = { aVerifier: true }; continue; }
      const neuf = remplacer(s, i, refuses);
      if (neuf) {
        remplaces++;
        console.log(`[Véhicule] ${dailyPlans[i].day} : « ${s.locationName} » inaccessible au véhicule → « ${neuf.name} ».`);
        Object.assign(s, lieuDe(neuf, 'ACCÈS VÉHICULE'), { stationnement: undefined, landmarks: undefined });
      } else {
        s.stationnement = { aVerifier: true };
      }
    }
  }

  // Après le dernier tour, tout arrêt encore sans voie est signalé.
  let aVerifier = 0;
  arrets().forEach(({ s }) => {
    if (!s.stationnement) s.stationnement = { aVerifier: true };
    if (s.stationnement.aVerifier) aVerifier++;
  });
  return { verifie: true, remplaces, aVerifier };
}

/**
 * Itinéraire final de chaque jour, dans l'ordre de passage : origine → arrêts
 * (au point de stationnement du camion). Alimente la carte et les kilomètres.
 * Silencieux si le service est indisponible.
 */
async function tracerItineraires(dailyPlans, origine, camion) {
  await Promise.all(dailyPlans.map(async day => {
    const pts = (day.stops || [])
      .filter(s => s.type !== 'equestrian')
      .map(s => (s.stationnement?.lat ? s.stationnement : s))
      .filter(p => p.lat && p.lng);
    if (!pts.length) { day.itineraire = null; return; }
    const trajet = [origine, ...pts];
    let route = await itineraireCamion(trajet, camion);
    if (route && !route.ok) route = await itineraireCamion(trajet, camion, 'auto');
    day.itineraire = route?.ok ? { km: route.km, min: route.min, shape: route.shape } : null;
  }));
}
