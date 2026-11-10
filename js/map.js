/**
 * map.js - Gestion de la carte Leaflet + Heatmap
 */

let mapInstance = null;
let markersLayer = null;
let heatLayer = null;
let enseigneLayer = null;   // points rouges : hors du cadrage automatique sur le tracé

function drawMap(data, origin, radiusKm) {
  if (!mapInstance) {
    mapInstance = L.map('leafletMap', { zoomControl: false })
      .setView([origin.lat, origin.lng], 13);

    L.control.zoom({ position: 'topleft' }).addTo(mapInstance);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
      subdomains: 'abc',
    }).addTo(mapInstance);

    markersLayer = L.layerGroup().addTo(mapInstance);
  } else {
    markersLayer.clearLayers();
    if (heatLayer) mapInstance.removeLayer(heatLayer);
    mapInstance.setView([origin.lat, origin.lng], 13);
  }

  mapInstance.invalidateSize();

  // Pas de carreaux INSEE ici : le potentiel a sa propre page en tête de PDF.
  // Cette carte-ci montre le résultat du tracé, sur lequel sont calculés les
  // indicateurs ; les mélanger rendait les deux lectures confuses.

  // Marqueur QG
  const qgIcon = L.divIcon({
    className: 'custom-div-icon',
    html: '<div style="background:#0E2C59;width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 0 6px rgba(0,0,0,0.4)"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  L.marker([origin.lat, origin.lng], { icon: qgIcon })
    .addTo(markersLayer)
    .bindPopup(`<b>QG / Départ</b><br>${sanitize(origin.display_name)}`)
    .openPopup();

  const heatPoints = [];

  (data.dailyPlans || []).forEach(day => {
    const color = (day.role || '').toLowerCase().includes('piéton') ? '#f97316' : '#3b82f6';
    const icon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div style="background:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.3)"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });

    // Itinéraire poids lourd du jour (Valhalla), quand il a pu être calculé
    if (day.itineraire?.shape?.length) {
      L.polyline(day.itineraire.shape, { color, weight: 3, opacity: 0.55 }).addTo(markersLayer);
    }

    (day.stops || []).forEach(s => {
      if (!isNaN(s.lat) && !isNaN(s.lng)) {
        // Le marqueur se place là où le camion stationne (rue carrossable)
        const st = s.stationnement?.lat ? s.stationnement : null;
        const camion = st ? `<br><span style="font-size:10px;color:#0369a1">&#x1F69A; ${sanitize(st.rue || 'rue carrossable')}</span>` : '';
        L.marker([st ? st.lat : s.lat, st ? st.lng : s.lng], { icon })
          .addTo(markersLayer)
          .bindPopup(`<b>${sanitize(s.time)} - ${sanitize(s.locationName)}</b><br><span style="font-size:10px;color:gray">${sanitize(s.address)}</span>${camion}`);
        heatPoints.push([s.lat, s.lng, 1]);
      }
    });
  });

  if (heatPoints.length > 0 && typeof L.heatLayer !== 'undefined') {
    heatLayer = L.heatLayer(heatPoints, {
      radius: 40,
      blur: 30,
      maxZoom: 14,
      gradient: { 0.2: '#0E2C59', 0.4: '#3b82f6', 0.6: '#10b981', 0.8: '#f59e0b', 1.0: '#ef4444' },
    }).addTo(mapInstance);
  }

  // Magasins de la même enseigne : point rouge + légende. Ils entrent dans le cadrage pour
  // qu'on voie où passe la limite entre la zone du client et la leur.
  if (!enseigneLayer) enseigneLayer = L.layerGroup().addTo(mapInstance);
  enseigneLayer.clearLayers();
  const magasins = magasinsEnseigneAffiches(origin, radiusKm);
  poserMagasinsEnseigne(enseigneLayer, magasins);
  rendreLegendeEnseigne('mapLegendeEnseigne', magasins);

  const group = new L.featureGroup([...markersLayer.getLayers(), ...enseigneLayer.getLayers()]);
  if (group.getLayers().length > 0) {
    mapInstance.fitBounds(group.getBounds().pad(0.1));
  }
}

// ---------------------------------------------------------------------------
// Magasins de la même enseigne : point rouge sur les cartes + légende
// ---------------------------------------------------------------------------

/** Magasins voisins de l'enseigne utiles à l'affichage : ceux qui bordent la zone, du plus proche au plus loin. */
function magasinsEnseigneAffiches(origin, radiusKm) {
  return (window._autresMagasins || [])
    .map(m => ({ ...m, km: calculateDistance(origin.lat, origin.lng, m.lat, m.lng) }))
    .filter(m => m.km <= radiusKm * 1.5)
    .sort((a, b) => a.km - b.km);
}

function iconeMagasinEnseigne() {
  return L.divIcon({
    className: 'custom-div-icon',
    html: '<div style="background:#dc2626;width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 0 6px rgba(220,38,38,0.6)"></div>',
    iconSize: [16, 16], iconAnchor: [8, 8],
  });
}

/** Points rouges sur une carte Leaflet (dans le calque donné). */
function poserMagasinsEnseigne(calque, magasins) {
  for (const m of magasins) {
    L.marker([m.lat, m.lng], { icon: iconeMagasinEnseigne(), interactive: true })
      .addTo(calque)
      .bindTooltip(`<b>${sanitize(m.nom)}</b> — même enseigne<br>${sanitize(m.adresse || '')}<br><span style="color:#dc2626">Ne pas circuler sur sa zone</span>`);
  }
}

/** Légende : point rouge, note, adresses des magasins de la même enseigne. */
function rendreLegendeEnseigne(idBoite, magasins) {
  const boite = document.getElementById(idBoite);
  if (!boite) return;
  if (!magasins.length) { boite.classList.add('hidden'); boite.innerHTML = ''; return; }
  const max = 8;
  const lignes = magasins.slice(0, max).map(m =>
    `<span class="text-[11px] text-gray-700 leading-5">${sanitize(m.nom)} — ${sanitize(m.adresse || 'adresse non renseignée')} <span class="text-gray-400">(${m.km.toFixed(1).replace('.', ',')} km)</span></span>`).join('');
  const reste = magasins.length > max ? `<span class="text-[11px] text-gray-400 italic leading-5">+ ${magasins.length - max} autre(s)</span>` : '';
  boite.innerHTML = `
    <div class="flex items-start gap-2.5 border-t border-gray-200 pt-2">
      <span style="background:#dc2626;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 0 4px rgba(220,38,38,0.6)" class="inline-block flex-shrink-0 mt-1"></span>
      <div class="flex flex-col">
        <span class="text-[11px] font-extrabold text-red-700 uppercase tracking-wide leading-5">Même enseigne : ne pas circuler sur la zone</span>
        <div class="flex flex-col">${lignes}${reste}</div>
      </div>
    </div>`;
  boite.classList.remove('hidden');
}
