/**
 * insee.js — Carte du potentiel de population (carreaux INSEE 200 m).
 *
 * Source : INSEE Filosofi « carreaux 200 m », servis en WFS par la
 * Géoplateforme IGN (data.geopf.fr). Gratuit, sans clé, CORS ouvert.
 * Chaque carreau de 200 × 200 m porte le nombre d'habitants (`ind`) et de
 * ménages (`men`) : c'est la mesure directe du potentiel, là où un nom de
 * quartier saisi à la main ne disait rien de la population réellement
 * atteignable depuis le point de départ.
 */

const INSEE_WFS   = 'https://data.geopf.fr/wfs/ows';
const INSEE_LAYER = 'INSEE.FILOSOFI.INDICATORS:carreaux_200m';

// Palette séquentielle : du bleu pâle (peu d'habitants) au bleu nuit de la
// charte àlo (forte densité). Six classes, calées sur les quantiles réels du
// secteur — des seuils fixes seraient illisibles en rase campagne.
const INSEE_PALETTE = ['#e0ecfb', '#b7d4f7', '#7eb3f0', '#4a90e2', '#1d4ed8', '#0E2C59'];

/** Sélection courante, partagée avec app.js. null = aucune sélection. */
let inseeSelection = null;

// État interne de la modale.
let _inseeMap = null;
let _inseeCarreaux = [];      // tous les carreaux chargés
let _inseeSeuils = [];
let _inseeChoisis = new Set(); // clés des carreaux sélectionnés
let _inseeCouches = new Map(); // clé → L.Polygon
let _inseePinceau = false;
let _inseeResolve = null;
let _inseeOrigine = null;
let _inseeRayon = 0;

// ---------------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------------

/**
 * Récupère les carreaux INSEE dans le rayon de campagne.
 * Le WFS ne filtre que par rectangle : on recoupe ensuite au cercle pour que
 * la carte montre exactement la zone que le plan pourra exploiter.
 */
async function fetchCarreauxINSEE(lat, lng, radiusKm) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat]
    .map(n => n.toFixed(5)).join(',');

  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: INSEE_LAYER,
    COUNT: '20000',
    OUTPUTFORMAT: 'application/json',
    SRSNAME: 'EPSG:4326',
    PROPERTYNAME: 'id_inspire,ind,men,nom_com,geom',
    BBOX: `${bbox},CRS:84`,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let data;
  try {
    const res = await fetch(`${INSEE_WFS}?${params}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`WFS ${res.status}`);
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const carreaux = [];
  for (const f of (data.features || [])) {
    const g = f.geometry;
    if (!g) continue;
    // Le WFS renvoie du MultiPolygon même pour un carré simple.
    const coords = g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.coordinates[0];
    if (!coords?.length) continue;

    const ring = coords.map(([x, y]) => [y, x]); // [lat, lng]
    let sLat = 0, sLng = 0;
    for (const [a, b] of ring) { sLat += a; sLng += b; }
    const cLat = sLat / ring.length;
    const cLng = sLng / ring.length;

    if (calculateDistance(lat, lng, cLat, cLng) > radiusKm) continue;

    const p = f.properties || {};
    // id_inspire = CRS3035RES200mN2799000E3417800 : la position exacte dans la
    // grille européenne. Elle sert à regrouper les carreaux voisins en secteurs.
    const m = /N(\d+)E(\d+)/.exec(p.id_inspire || '');
    carreaux.push({
      cle: p.id_inspire || `${cLat},${cLng}`,
      n: m ? parseInt(m[1], 10) : null,
      e: m ? parseInt(m[2], 10) : null,
      ind: Math.round(p.ind || 0),
      men: Math.round(p.men || 0),
      commune: p.nom_com || '',
      lat: cLat,
      lng: cLng,
      ring,
    });
  }
  carreaux.sort((a, b) => b.ind - a.ind);
  return carreaux;
}

/** Seuils de couleur par quantiles : un secteur rural et un centre-ville
 *  n'ont pas la même échelle, des seuils fixes rendraient l'un des deux plat. */
function seuilsPotentiel(carreaux) {
  const v = carreaux.map(c => c.ind).filter(x => x > 0).sort((a, b) => a - b);
  if (!v.length) return [1, 2, 3, 4, 5];
  const q = p => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return [q(0.2), q(0.4), q(0.6), q(0.8), q(0.95)];
}

function couleurCarreau(ind, seuils) {
  for (let i = 0; i < seuils.length; i++) {
    if (ind <= seuils[i]) return INSEE_PALETTE[i];
  }
  return INSEE_PALETTE[INSEE_PALETTE.length - 1];
}

// Index spatial : le pinceau doit retrouver le carreau sous le curseur à
// chaque mousemove. Un balayage linéaire des 2 000+ carreaux à 60 images par
// seconde saccaderait ; on range les carreaux dans des cases d'environ 200 m.
const INSEE_PAS_INDEX = 500; // 1/500 de degré ≈ 200 m
let _inseeIndex = new Map();

function _cleIndex(lat, lng) {
  return `${Math.round(lat * INSEE_PAS_INDEX)}_${Math.round(lng * INSEE_PAS_INDEX)}`;
}

function _construireIndex(carreaux) {
  _inseeIndex = new Map();
  for (const c of carreaux) {
    const k = _cleIndex(c.lat, c.lng);
    if (!_inseeIndex.has(k)) _inseeIndex.set(k, []);
    _inseeIndex.get(k).push(c);
  }
}

/** Largeur du pinceau, en nombre de carreaux (1 = un seul carreau). */
let _inseeTaille = 1;

/**
 * Carreaux couverts par le pinceau. À la taille 1 on exige que le curseur
 * soit réellement dans le carreau ; au-delà, on prend tout ce qui tombe dans
 * le disque du pinceau — c'est ce qui permet de peindre un quartier d'un geste.
 */
function _carreauxSousPinceau(lat, lng) {
  if (_inseeTaille <= 1) {
    const c = _carreauSous(lat, lng);
    return c ? [c] : [];
  }
  const rayonKm = (_inseeTaille * 0.2) / 2;
  // Les cases d'index font ~200 m en latitude mais ~140 m en longitude :
  // on élargit la portée sur la plus petite pour ne rien manquer.
  const portee = Math.ceil(rayonKm / 0.14) + 1;
  const bLat = Math.round(lat * INSEE_PAS_INDEX);
  const bLng = Math.round(lng * INSEE_PAS_INDEX);
  const res = [];
  for (let dy = -portee; dy <= portee; dy++) {
    for (let dx = -portee; dx <= portee; dx++) {
      for (const c of (_inseeIndex.get(`${bLat + dy}_${bLng + dx}`) || [])) {
        if (calculateDistance(lat, lng, c.lat, c.lng) <= rayonKm) res.push(c);
      }
    }
  }
  return res;
}

/** Carreau situé sous un point de la carte, ou null. */
function _carreauSous(lat, lng) {
  const bLat = Math.round(lat * INSEE_PAS_INDEX);
  const bLng = Math.round(lng * INSEE_PAS_INDEX);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const c of (_inseeIndex.get(`${bLat + dy}_${bLng + dx}`) || [])) {
        if (carreauContient(c, lat, lng)) return c;
      }
    }
  }
  return null;
}

/** Test d'appartenance d'un point à un carreau (lancer de rayon). */
function carreauContient(c, lat, lng) {
  const r = c.ring;
  let dedans = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [yi, xi] = r[i], [yj, xj] = r[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      dedans = !dedans;
    }
  }
  return dedans;
}

/** Un POI tombe-t-il dans la sélection ? Utilisé pour prioriser les arrêts. */
function dansSelectionINSEE(lat, lng) {
  if (!inseeSelection?.carreaux?.length) return false;
  return inseeSelection.carreaux.some(c => carreauContient(c, lat, lng));
}

/**
 * Regroupe les carreaux sélectionnés en secteurs contigus.
 * Deux carreaux se touchent si leurs coordonnées de grille diffèrent de 200 m.
 * Sans ce regroupement, une sélection de 40 carreaux donnerait 40 « zones »
 * à l'IA au lieu de 3 quartiers nommés.
 */
function clustersINSEE(carreaux) {
  const parGrille = new Map();
  for (const c of carreaux) {
    if (c.n !== null) parGrille.set(`${c.n}/${c.e}`, c);
  }
  const vus = new Set();
  const groupes = [];

  for (const c of carreaux) {
    if (vus.has(c.cle)) continue;
    const file = [c];
    vus.add(c.cle);
    const membres = [];

    while (file.length) {
      const cur = file.pop();
      membres.push(cur);
      if (cur.n === null) continue;
      for (const [dn, de] of [[200, 0], [-200, 0], [0, 200], [0, -200],
                              [200, 200], [200, -200], [-200, 200], [-200, -200]]) {
        const v = parGrille.get(`${cur.n + dn}/${cur.e + de}`);
        if (v && !vus.has(v.cle)) { vus.add(v.cle); file.push(v); }
      }
    }

    const ind = membres.reduce((s, m) => s + m.ind, 0);
    const men = membres.reduce((s, m) => s + m.men, 0);
    const lat = membres.reduce((s, m) => s + m.lat, 0) / membres.length;
    const lng = membres.reduce((s, m) => s + m.lng, 0) / membres.length;

    // Commune dominante du groupe : c'est le nom qui parlera au chauffeur.
    const comptes = {};
    membres.forEach(m => { if (m.commune) comptes[m.commune] = (comptes[m.commune] || 0) + m.ind; });
    const commune = Object.entries(comptes).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    groupes.push({ commune, ind, men, lat, lng, nbCarreaux: membres.length, membres });
  }

  groupes.sort((a, b) => b.ind - a.ind);
  return groupes;
}

// ---------------------------------------------------------------------------
// Modale de sélection
// ---------------------------------------------------------------------------

function _inseeEl(id) { return document.getElementById(id); }

function _majStatsINSEE() {
  const choisis = _inseeCarreaux.filter(c => _inseeChoisis.has(c.cle));
  const ind = choisis.reduce((s, c) => s + c.ind, 0);
  const men = choisis.reduce((s, c) => s + c.men, 0);
  const total = _inseeCarreaux.reduce((s, c) => s + c.ind, 0);
  const part = total > 0 ? Math.round((ind / total) * 100) : 0;

  _inseeEl('inseeStatCarreaux').textContent = choisis.length;
  _inseeEl('inseeStatHab').textContent = ind.toLocaleString('fr-FR');
  _inseeEl('inseeStatMen').textContent = men.toLocaleString('fr-FR');
  _inseeEl('inseeStatPart').textContent = `${part} %`;
  _inseeEl('inseeValiderBtn').disabled = choisis.length === 0;
}

function _styleCarreau(c) {
  const choisi = _inseeChoisis.has(c.cle);
  return choisi
    ? { color: '#047857', weight: 1.5, opacity: 1, fillColor: '#10b981', fillOpacity: 0.75 }
    : { color: '#94a3b8', weight: 0.4, opacity: 0.5, fillColor: couleurCarreau(c.ind, _inseeSeuils), fillOpacity: 0.6 };
}

function _basculerCarreau(c) {
  if (_inseeChoisis.has(c.cle)) _inseeChoisis.delete(c.cle);
  else _inseeChoisis.add(c.cle);
  _inseeCouches.get(c.cle)?.setStyle(_styleCarreau(c));
  _majStatsINSEE();
}

// Ne met pas à jour le compteur : avec un gros pinceau, ce sont des centaines
// de carreaux par déplacement de souris. L'appelant rafraîchit une seule fois.
function _peindreCarreau(c, actif) {
  const deja = _inseeChoisis.has(c.cle);
  if (actif === deja) return;
  if (actif) _inseeChoisis.add(c.cle); else _inseeChoisis.delete(c.cle);
  _inseeCouches.get(c.cle)?.setStyle(_styleCarreau(c));
}

function _rendreLegendeINSEE() {
  const bornes = [0, ..._inseeSeuils];
  const cases = INSEE_PALETTE.map((couleur, i) => {
    const bas = bornes[i];
    const haut = _inseeSeuils[i];
    const label = haut === undefined ? `${bas}+` : (bas === haut ? `${haut}` : `${bas}–${haut}`);
    return `<div class="flex items-center gap-1.5">
      <span style="background:${couleur}" class="inline-block w-4 h-3 rounded-sm border border-white/60"></span>
      <span class="text-[11px] text-gray-600">${label}</span>
    </div>`;
  }).join('');
  _inseeEl('inseeLegende').innerHTML = cases;
}

/**
 * Ouvre la carte de potentiel et résout avec la sélection validée,
 * ou avec null si l'utilisateur annule.
 */
async function openInseeMap(origin, radiusKm) {
  _inseeOrigine = origin;
  _inseeRayon = radiusKm;

  const modal = _inseeEl('inseeModal');
  modal.classList.remove('hidden');
  _inseeEl('inseeChargement').classList.remove('hidden');
  _inseeEl('inseeErreur').classList.add('hidden');
  _inseeEl('inseeAdresse').textContent = origin.display_name || '';

  // Reprise d'une sélection précédente : on ne fait pas recommencer à zéro.
  _inseeChoisis = new Set(inseeSelection?.carreaux?.map(c => c.cle) || []);

  try {
    _inseeCarreaux = await fetchCarreauxINSEE(origin.lat, origin.lng, radiusKm);
  } catch (e) {
    console.error('[INSEE] chargement impossible', e);
    _inseeEl('inseeChargement').classList.add('hidden');
    _inseeEl('inseeErreur').classList.remove('hidden');
    _inseeEl('inseeErreurTexte').textContent =
      "Les serveurs de la Géoplateforme IGN n'ont pas répondu. Réessayez dans un instant, ou saisissez les quartiers à la main.";
    return new Promise(r => { _inseeResolve = r; });
  }

  _inseeEl('inseeChargement').classList.add('hidden');

  if (!_inseeCarreaux.length) {
    _inseeEl('inseeErreur').classList.remove('hidden');
    _inseeEl('inseeErreurTexte').textContent =
      "Aucune donnée INSEE sur ce secteur. Les carreaux Filosofi ne couvrent que la France métropolitaine et la Réunion.";
    return new Promise(r => { _inseeResolve = r; });
  }

  _inseeSeuils = seuilsPotentiel(_inseeCarreaux);
  _rendreLegendeINSEE();

  // Canvas obligatoire : en SVG, 3 000 polygones figent la carte au zoom.
  if (!_inseeMap) {
    _inseeMap = L.map('inseeMap', { preferCanvas: true, zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap · Carreaux INSEE Filosofi / IGN',
      maxZoom: 19, subdomains: 'abc',
    }).addTo(_inseeMap);
  } else {
    _inseeMap.eachLayer(l => { if (l instanceof L.Polygon || l instanceof L.Circle) _inseeMap.removeLayer(l); });
  }
  _inseeMap.setView([origin.lat, origin.lng], 13);
  setTimeout(() => _inseeMap.invalidateSize(), 60);

  _inseeCouches = new Map();
  for (const c of _inseeCarreaux) {
    const poly = L.polygon(c.ring, { ..._styleCarreau(c), interactive: true }).addTo(_inseeMap);
    poly.bindTooltip(
      `<b>${c.ind} habitant${c.ind > 1 ? 's' : ''}</b><br>${c.men} ménage${c.men > 1 ? 's' : ''}<br><span style="color:#64748b">${sanitize(c.commune)}</span>`,
      { sticky: true }
    );
    // Le pinceau est géré au niveau de la carte, pas du polygone : pendant un
    // glisser, le navigateur n'envoie plus de mouseover aux formes survolées.
      poly.on('click', () => { if (!_inseePinceau) _basculerCarreau(c); });
    _inseeCouches.set(c.cle, poly);
  }
  _construireIndex(_inseeCarreaux);

  _inseeMap.off('mousedown', _pinceauDebut).on('mousedown', _pinceauDebut);
  _inseeMap.off('mousemove', _pinceauDeplace).on('mousemove', _pinceauDeplace);

  L.circle([origin.lat, origin.lng], {
    radius: radiusKm * 1000, color: '#0E2C59', weight: 2, dashArray: '6 6', fill: false,
  }).addTo(_inseeMap);

  _majStatsINSEE();
  return new Promise(r => { _inseeResolve = r; });
}

let _inseePeintEn = true;
let _inseePeintActif = false;

/** Début du tracé : le premier carreau décide si l'on ajoute ou retire,
 *  comme un pinceau qui bascule selon ce qu'il touche en premier. */
function _pinceauDebut(e) {
  if (!_inseePinceau) return;
  const lot = _carreauxSousPinceau(e.latlng.lat, e.latlng.lng);
  if (!lot.length) return;
  // Le carreau sous le centre du pinceau décide du sens : s'il est déjà
  // retenu on gomme, sinon on ajoute. Tout le lot suit ce même sens.
  const pivot = _carreauSous(e.latlng.lat, e.latlng.lng) || lot[0];
  _inseePeintEn = !_inseeChoisis.has(pivot.cle);
  _inseePeintActif = true;
  lot.forEach(c => _peindreCarreau(c, _inseePeintEn));
  _majStatsINSEE();
}

function _pinceauDeplace(e) {
  if (!_inseePinceau || !_inseePeintActif) return;
  _carreauxSousPinceau(e.latlng.lat, e.latlng.lng)
    .forEach(c => _peindreCarreau(c, _inseePeintEn));
  _majStatsINSEE();
}

function _fermerInsee(resultat) {
  _inseeEl('inseeModal').classList.add('hidden');
  const r = _inseeResolve;
  _inseeResolve = null;
  if (r) r(resultat);
}

/** Sélectionne les carreaux les plus denses jusqu'à couvrir `part` de la
 *  population du rayon : le réflexe métier, en un clic. */
function _selectionAutoINSEE(part = 0.6) {
  const total = _inseeCarreaux.reduce((s, c) => s + c.ind, 0);
  let cumul = 0;
  _inseeChoisis = new Set();
  for (const c of _inseeCarreaux) { // déjà triés par densité décroissante
    if (cumul >= total * part || c.ind === 0) break;
    _inseeChoisis.add(c.cle);
    cumul += c.ind;
  }
  _inseeCarreaux.forEach(c => _inseeCouches.get(c.cle)?.setStyle(_styleCarreau(c)));
  _majStatsINSEE();
}

function initInseeUI() {
  _inseeEl('inseeAnnulerBtn')?.addEventListener('click', () => _fermerInsee(null));
  _inseeEl('inseeAnnulerBtn2')?.addEventListener('click', () => _fermerInsee(null));
  _inseeEl('inseeModalBackdrop')?.addEventListener('click', () => _fermerInsee(null));

  _inseeEl('inseeEffacerBtn')?.addEventListener('click', () => {
    _inseeChoisis = new Set();
    _inseeCarreaux.forEach(c => _inseeCouches.get(c.cle)?.setStyle(_styleCarreau(c)));
    _majStatsINSEE();
  });

  _inseeEl('inseeAutoBtn')?.addEventListener('click', () => _selectionAutoINSEE(0.6));

  // Taille du pinceau : 1, 3, 5 ou 9 carreaux de large.
  document.querySelectorAll('.insee-taille').forEach(b => {
    b.addEventListener('click', () => {
      _inseeTaille = parseInt(b.dataset.taille, 10) || 1;
      document.querySelectorAll('.insee-taille').forEach(o => {
        const actif = o === b;
        o.classList.toggle('bg-emerald-600', actif);
        o.classList.toggle('text-white', actif);
        o.classList.toggle('bg-gray-100', !actif);
        o.classList.toggle('text-gray-700', !actif);
      });
      _inseeEl('inseeTailleMetres').textContent = `${_inseeTaille * 200} m`;
    });
  });

  _inseeEl('inseePinceauBtn')?.addEventListener('click', (ev) => {
    _inseePinceau = !_inseePinceau;
    const b = ev.currentTarget;
    b.classList.toggle('bg-emerald-600', _inseePinceau);
    b.classList.toggle('text-white', _inseePinceau);
    b.classList.toggle('bg-gray-100', !_inseePinceau);
    b.classList.toggle('text-gray-700', !_inseePinceau);
    // Le réglage de taille ne sert à rien hors mode pinceau.
    _inseeEl('inseeTailleGroupe')?.classList.toggle('hidden', !_inseePinceau);
    _inseeEl('inseeTailleGroupe')?.classList.toggle('flex', _inseePinceau);
    // Le pinceau et le déplacement de la carte se disputent le glisser :
    // on coupe le drag tant que le pinceau est actif.
    if (_inseeMap) {
      if (_inseePinceau) _inseeMap.dragging.disable();
      else _inseeMap.dragging.enable();
    }
  });

  document.addEventListener('mouseup', () => { _inseePeintActif = false; });

  _inseeEl('inseeValiderBtn')?.addEventListener('click', () => {
    const choisis = _inseeCarreaux.filter(c => _inseeChoisis.has(c.cle));
    if (!choisis.length) return;
    inseeSelection = {
      carreaux: choisis,
      secteurs: clustersINSEE(choisis),
      totalInd: choisis.reduce((s, c) => s + c.ind, 0),
      totalMen: choisis.reduce((s, c) => s + c.men, 0),
      origin: _inseeOrigine,
      radiusKm: _inseeRayon,
    };
    _fermerInsee(inseeSelection);
  });
}

/** Résumé affiché dans le formulaire une fois la sélection validée. */
function renderInseeSummary() {
  const box = _inseeEl('inseeSummary');
  if (!box) return;
  if (!inseeSelection?.carreaux?.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const s = inseeSelection;
  const lignes = s.secteurs.slice(0, 5).map(g => `
    <div class="flex items-center justify-between gap-2 text-xs py-0.5">
      <span class="font-semibold text-emerald-900 truncate">${sanitize(g.commune || 'Secteur')} · ${g.nbCarreaux} carreau${g.nbCarreaux > 1 ? 'x' : ''}</span>
      <span class="font-mono font-bold text-emerald-700 flex-shrink-0">${g.ind.toLocaleString('fr-FR')} hab.</span>
    </div>`).join('');
  const reste = s.secteurs.length > 5
    ? `<p class="text-[11px] text-emerald-700/70 italic mt-1">+ ${s.secteurs.length - 5} autre(s) secteur(s)</p>` : '';

  box.innerHTML = `
    <div class="flex items-center justify-between mb-1.5">
      <span class="text-xs font-extrabold uppercase tracking-wider text-emerald-800">Sélection INSEE active</span>
      <span class="text-sm font-extrabold text-emerald-700">${s.totalInd.toLocaleString('fr-FR')} hab. · ${s.totalMen.toLocaleString('fr-FR')} ménages</span>
    </div>
    ${lignes}${reste}`;
  box.classList.remove('hidden');
}

/** Les 4 coins d'un carreau, repérés par leur position vis-à-vis du centre. */
function _coinsCarreau(c) {
  const coins = {};
  for (const [lat, lng] of c.ring.slice(0, 4)) {
    coins[(lat > c.lat ? 'N' : 'S') + (lng > c.lng ? 'E' : 'O')] = [lat, lng];
  }
  return coins;
}

/**
 * Contour extérieur de la sélection : on ne garde que les côtés qui donnent
 * sur un carreau non retenu. 463 carrés pleins écrasaient la heatmap du plan ;
 * un liseré autour de chaque secteur situe la zone sans masquer la chaleur.
 */
function perimetreSelection(carreaux) {
  const grille = new Map();
  carreaux.forEach(c => { if (c.n !== null) grille.set(`${c.n}/${c.e}`, true); });

  const segments = [];
  for (const c of carreaux) {
    if (c.n === null) continue;
    const k = _coinsCarreau(c);
    if (!k.NE || !k.NO || !k.SE || !k.SO) continue;
    if (!grille.has(`${c.n + 200}/${c.e}`)) segments.push([k.NO, k.NE]);
    if (!grille.has(`${c.n - 200}/${c.e}`)) segments.push([k.SO, k.SE]);
    if (!grille.has(`${c.n}/${c.e + 200}`)) segments.push([k.NE, k.SE]);
    if (!grille.has(`${c.n}/${c.e - 200}`)) segments.push([k.NO, k.SO]);
  }
  return segments;
}

/** Dessine la sélection sur la carte du plan généré, en fond discret. */
function dessinerSelectionINSEE(map) {
  if (!inseeSelection?.carreaux?.length || !map) return null;
  const couche = L.layerGroup();

  // Voile très léger : il suffit à teinter la zone, la heatmap passe au-dessus.
  for (const c of inseeSelection.carreaux) {
    L.polygon(c.ring, {
      stroke: false, fillColor: '#10b981', fillOpacity: 0.10, interactive: false,
    }).addTo(couche);
  }

  L.polyline(perimetreSelection(inseeSelection.carreaux), {
    color: '#047857', weight: 1.8, opacity: 0.85, interactive: false,
  }).addTo(couche);

  couche.addTo(map);
  return couche;
}
