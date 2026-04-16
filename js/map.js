/**
 * map.js - Gestion de la carte Leaflet + Heatmap
 */

let mapInstance = null;
let markersLayer = null;
let heatLayer = null;

function drawMap(data, origin, radiusKm) {
  if (!mapInstance) {
    mapInstance = L.map('leafletMap', { zoomControl: false })
      .setView([origin.lat, origin.lng], 13);

    L.control.zoom({ position: 'topleft' }).addTo(mapInstance);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapInstance);

    markersLayer = L.layerGroup().addTo(mapInstance);
  } else {
    markersLayer.clearLayers();
    if (heatLayer) mapInstance.removeLayer(heatLayer);
    mapInstance.setView([origin.lat, origin.lng], 13);
  }

  mapInstance.invalidateSize();

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

    (day.stops || []).forEach(s => {
      if (!isNaN(s.lat) && !isNaN(s.lng)) {
        L.marker([s.lat, s.lng], { icon })
          .addTo(markersLayer)
          .bindPopup(`<b>${sanitize(s.time)} - ${sanitize(s.locationName)}</b><br><span style="font-size:10px;color:gray">${sanitize(s.address)}</span>`);
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

  const group = new L.featureGroup(markersLayer.getLayers());
  if (group.getLayers().length > 0) {
    mapInstance.fitBounds(group.getBounds().pad(0.1));
  }
}
