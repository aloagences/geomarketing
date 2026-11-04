// ========================================
// STATIONNEMENT — où garer le véhicule quelques minutes, secteur par secteur
// Source : OpenStreetMap (Overpass). On y trouve les parkings de surface
// (accès, tarif, capacité, hauteur maxi) et les rues où un marquage de
// stationnement est cartographié. Limites : OSM est incomplet, ne dit rien de
// l'occupation en temps réel ni des zones bleues ou arrêts minute autorisés :
// c'est une aide au repérage, à confirmer sur place.
// ========================================

const PARKING_RAYON_M = 150;
/** Parkings écartés : souterrains / étagés (hauteur limitée) ou privés. */
const PARKINGS_EXCLUS = new Set(['underground', 'multi-storey', 'rooftop']);
const ACCES_EXCLUS = new Set(['private', 'permit', 'no', 'delivery', 'residents']);
const LANES_STATIONNEMENT = /^(parallel|diagonal|perpendicular|marked)$/;
const INTERDIT = /^(no_parking|no_stopping|no_standing|no)$/;

/** Éléments Overpass d'une requête (course entre serveurs), ou null. */
async function overpassElements(query, delaiMs = 25000) {
  if (overpassInjoignable()) return null;
  const body = 'data=' + encodeURIComponent(query);
  try {
    const elements = await Promise.any(OVERPASS_ENDPOINTS.map(async (endpoint) => {
      const ctrl = new AbortController();
      const minuteur = setTimeout(() => ctrl.abort(), delaiMs);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body, signal: ctrl.signal,
        });
        if (!res.ok) throw new Error('bad status');
        const data = JSON.parse(await res.text());
        if (!data.elements) throw new Error('no elements');
        return data.elements;
      } finally {
        clearTimeout(minuteur);
      }
    }));
    signalerOverpassOK();
    return elements;
  } catch {
    signalerOverpassEchec();
    return null;
  }
}

/** Parkings et rues à stationnement autour de chaque point (une seule requête). */
function requeteStationnement(points, rayonM = PARKING_RAYON_M) {
  const autour = points.map(p => `(around:${rayonM},${p.lat},${p.lng})`);
  return `[out:json][timeout:40];(`
    + autour.map(a => `nwr["amenity"="parking"]${a};`).join('')
    + autour.map(a => `way["highway"]["name"][~"^parking:lane:(both|left|right)$"~"^(parallel|diagonal|perpendicular|marked)$"]${a};`).join('')
    + `);out center tags 1500;`;
}

const _num = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const _centre = (e) => ({ lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon });

/** Un parking OSM convient-il à un véhicule de `hauteur` m pour un arrêt court ? */
function parkingUtilisable(tags, hauteur) {
  if (PARKINGS_EXCLUS.has(tags.parking)) return false;
  if (ACCES_EXCLUS.has(tags.access)) return false;
  const maxi = _num(tags.maxheight);
  return !(maxi !== null && maxi < hauteur + 0.05);
}

/** Stationnement longitudinal ou en épi autorisé le long d'une rue ? */
function rueAvecStationnement(tags) {
  const cotes = ['both', 'left', 'right'];
  const ok = cotes.some(c => LANES_STATIONNEMENT.test(tags[`parking:lane:${c}`] || ''));
  const interdit = cotes.some(c => INTERDIT.test(tags[`parking:condition:${c}`] || '')
    || INTERDIT.test(tags[`parking:lane:${c}`] || ''));
  return ok && !interdit;
}

/**
 * Meilleur endroit où garer le véhicule pour un arrêt : le plus proche de la
 * rue où le camion stationne, de préférence gratuit et de bonne capacité.
 * @returns {{type, nom, distM, lat, lng, gratuit, places} | {aucun: true}}
 */
function choisirStationnement(elements, stop, hauteur) {
  const ref = stop.stationnement?.lat ? stop.stationnement : stop;
  const rue = (stop.stationnement?.rue || '').toLowerCase();
  let meilleur = null, meilleurScore = Infinity;

  for (const e of elements) {
    const tags = e.tags || {};
    const c = _centre(e);
    if (!c.lat || !c.lng) continue;
    const distM = Math.round(kmPlan(ref, c) * 1000);

    if (tags.amenity === 'parking') {
      if (!parkingUtilisable(tags, hauteur) || distM > PARKING_RAYON_M) continue;
      const places = _num(tags.capacity);
      const score = distM + (tags.fee === 'yes' ? 40 : 0) + (tags.access === 'customers' ? 60 : 0)
        - (places && places >= 20 ? 20 : 0);
      if (score < meilleurScore) {
        meilleurScore = score;
        meilleur = {
          type: 'parking', nom: tags.name || 'Parking', distM, lat: c.lat, lng: c.lng,
          gratuit: tags.fee === 'yes' ? false : (tags.fee === 'no' ? true : null),
          places,
        };
      }
    } else if (tags.highway && rueAvecStationnement(tags)) {
      // Rue où le camion stationne déjà : le stationnement est « devant ».
      const memeRue = rue && (tags.name || '').toLowerCase() === rue;
      if (!memeRue && distM > PARKING_RAYON_M) continue;
      const score = (memeRue ? 0 : distM) + 25;                 // un vrai parking passe devant la voirie à égalité
      if (score < meilleurScore) {
        meilleurScore = score;
        meilleur = {
          type: 'voirie', nom: tags.name || '', distM: memeRue ? 0 : distM, lat: c.lat, lng: c.lng,
          gratuit: tags['parking:fee'] === 'yes' ? false : null, places: null,
        };
      }
    }
  }
  return meilleur || { aucun: true };
}

/**
 * Pose `stop.parking` sur chaque arrêt du plan (hors centres équestres).
 * @returns {Promise<{ok: boolean, avec: number, sans: number}>} ok=false si Overpass est injoignable
 */
async function trouverStationnements(dailyPlans, hauteur) {
  const arrets = dailyPlans.flatMap(d => (d.stops || []).filter(s => s.lat && s.lng && s.type !== 'equestrian'));
  const points = arrets.map(s => (s.stationnement?.lat ? s.stationnement : s));
  const elements = [];
  for (let i = 0; i < points.length; i += 10) {
    const lot = await overpassElements(requeteStationnement(points.slice(i, i + 10)));
    if (!lot) return { ok: false, avec: 0, sans: 0 };
    elements.push(...lot);
  }
  let avec = 0, sans = 0;
  arrets.forEach(s => {
    s.parking = choisirStationnement(elements, s, hauteur);
    if (s.parking.aucun) sans++; else avec++;
  });
  return { ok: true, avec, sans };
}
