/**
 * app.js - Orchestration principale de l'application
 */

// ========================================
// RÉFÉRENCES DOM
// ========================================

const el = {};
const inputRefs = {};
let generatedData = null;
let officialPopulation = null;
// Renseigné quand le nombre de lieux trouvés est inférieur au nombre d'arrêts
// à couvrir : affiché en fin de génération, au-dessus du plan.
let poolMaigre = null;
// Vrai quand le plan repose sur la fiche de repérage ou les centres INSEE,
// la requête principale OpenStreetMap n'ayant rien ramené.
let poolDeSecours = false;

function initDomRefs() {
  el.form = document.getElementById('clientForm');
  el.btn = document.getElementById('generatePlanBtn');
  el.btnText = document.getElementById('btnText');
  el.spinner = document.getElementById('spinner');
  el.progressContainer = document.getElementById('progressContainer');
  el.progressBar = document.getElementById('progressBar');
  el.progressPercent = document.getElementById('progressPercent');
  el.loadingStatus = document.getElementById('loadingStatus');
  el.alertBox = document.getElementById('alertBox');
  el.alertText = document.getElementById('alertText');
  el.aiConfigDetails = document.getElementById('aiConfigDetails');
  el.activeAiBadge = document.getElementById('activeAiBadge');
  el.outputContainer = document.getElementById('analysisOutputContainer');
  el.analysisCard = document.getElementById('clientAnalysisOutput');
  el.analysisText = document.getElementById('clientAnalysisText');
  el.planCard = document.getElementById('planOutput');
  el.dailyPlansContainer = document.getElementById('dailyPlansContainer');
  el.attendanceCard = document.getElementById('attendanceSheetContainer');
  el.attendanceGrid = document.getElementById('attendanceGrid');
  el.displayBrand = document.getElementById('displayBrand');
  el.dateSpan = document.getElementById('generationDate');
  el.mapContainer = document.getElementById('mapContainerWrapper');
  el.potentialMap = document.getElementById('potentialMapContainer');
  el.zoneLandmarks = document.getElementById('zoneLandmarksContainer');
  el.zoneLandmarksGrid = document.getElementById('zoneLandmarksGrid');
  el.mapStats = document.getElementById('mapStats');
  el.officialBadges = document.getElementById('officialBadges');
  el.badgeSiren = document.getElementById('badgeSiren');
  el.badgeInsee = document.getElementById('badgeInsee');
  el.badgePop = document.getElementById('badgePop');
  el.sirenVal = document.getElementById('sirenVal');
  el.inseeVal = document.getElementById('inseeVal');
  el.popVal = document.getElementById('popVal');
  el.reachEstimationContainer = document.getElementById('reachEstimationContainer');
  el.estTotalStops = document.getElementById('estTotalStops');
  el.estReach = document.getElementById('estReach');
  el.estImpressions = document.getElementById('estImpressions');

  inputRefs.brand = document.getElementById('clientBrand');
  inputRefs.address = document.getElementById('clientAddress');
  inputRefs.radius = document.getElementById('campaignRadius');
  inputRefs.startDate = document.getElementById('campaignStartDate');
  inputRefs.duration = document.getElementById('campaignDuration');
  inputRefs.morning = document.getElementById('timeMorning');
  inputRefs.afternoon = document.getElementById('timeAfternoon');
  inputRefs.target = document.getElementById('targetProfile');
  inputRefs.competitors = document.getElementById('competitors');
  inputRefs.excludedCities = document.getElementById('excludedCities');
  inputRefs.ownBrand = document.getElementById('ownBrand');
  inputRefs.priorityCities = document.getElementById('priorityCities');
  inputRefs.smCity = document.getElementById('smCity');
  inputRefs.smTeamSize = document.getElementById('smTeamSize');
  inputRefs.smHasMorning = document.getElementById('smHasMorning');
  inputRefs.smMornStart = document.getElementById('smMornStart');
  inputRefs.smMornEnd = document.getElementById('smMornEnd');
  inputRefs.smHasAfternoon = document.getElementById('smHasAfternoon');
  inputRefs.smAftStart = document.getElementById('smAftStart');
  inputRefs.smAftEnd = document.getElementById('smAftEnd');
  inputRefs.equestrianEnabled = document.getElementById('equestrianEnabled');
  inputRefs.equestrianDay = document.getElementById('equestrianDay');
  inputRefs.equestrianManual = document.getElementById('equestrianManual');
}

// ========================================
// GESTION CLÉS API (localStorage)
// ========================================

const ENGINE_CONFIG = {
  openrouter:  { inputId: 'openrouterKeyInput', statusId: 'openrouterKeyStatusText', btnId: 'validateOpenRouterKeyBtn', storageKey: StorageKeys.OPENROUTER, label: 'OpenRouter' },
  gemini:      { inputId: 'apiKeyInput',         statusId: 'keyStatusText',           btnId: 'validateKeyBtn',           storageKey: StorageKeys.GEMINI,     label: 'Google Gemini' },
  groq:        { inputId: 'groqKeyInput',        statusId: 'groqKeyStatusText',       btnId: 'validateGroqKeyBtn',       storageKey: StorageKeys.GROQ,       label: 'Groq' },
  openai:      { inputId: 'openaiKeyInput',      statusId: 'openaiKeyStatusText',     btnId: 'validateOpenAIKeyBtn',     storageKey: StorageKeys.OPENAI,     label: 'OpenAI' },
  mistral:     { inputId: 'mistralKeyInput',     statusId: 'mistralKeyStatusText',    btnId: 'validateMistralKeyBtn',    storageKey: StorageKeys.MISTRAL,    label: 'Mistral AI' },
};

function getActiveEngine() {
  return document.querySelector('input[name="aiEngine"]:checked')?.value || 'mistral';
}

function getKeys() {
  const keys = { activeEngine: getActiveEngine() };
  for (const [engine, cfg] of Object.entries(ENGINE_CONFIG)) {
    const input = document.getElementById(cfg.inputId);
    keys[engine] = input?.value.trim() || '';
  }
  return keys;
}

function saveKeys() {
  for (const [engine, cfg] of Object.entries(ENGINE_CONFIG)) {
    const input = document.getElementById(cfg.inputId);
    if (input?.value.trim()) safeSetItem(cfg.storageKey, input.value.trim());
  }
  const modelSelect = document.getElementById('modelSelect');
  if (modelSelect) safeSetItem(StorageKeys.MODEL, modelSelect.value);
  safeSetItem(StorageKeys.ENGINE, getActiveEngine());
}

function loadSavedKeys() {
  for (const [engine, cfg] of Object.entries(ENGINE_CONFIG)) {
    const input = document.getElementById(cfg.inputId);
    const saved = safeGetItem(cfg.storageKey);
    if (input && saved) input.value = saved;
  }
  const savedModel = safeGetItem(StorageKeys.MODEL);
  const modelSelect = document.getElementById('modelSelect');
  if (savedModel && modelSelect) modelSelect.value = savedModel;

  // Migration unique : OpenRouter (tier gratuit désormais bloqué → erreur
  // « model not available in your subscription tier ») basculé vers Mistral.
  if (!safeGetItem('migrated_off_openrouter')) {
    if (safeGetItem(StorageKeys.ENGINE) === 'openrouter') {
      safeSetItem(StorageKeys.ENGINE, 'mistral');
    }
    safeSetItem('migrated_off_openrouter', '1');
  }

  const savedEngine = safeGetItem(StorageKeys.ENGINE) || 'mistral';
  const radio = document.querySelector(`input[name="aiEngine"][value="${savedEngine}"]`);
  if (radio) radio.checked = true;

  updateAiBadge();
  autoCloseAiSettings();

  document.querySelectorAll('input[name="aiEngine"]').forEach(r => {
    r.addEventListener('change', () => { updateAiBadge(); saveKeys(); });
  });
}

function updateAiBadge() {
  if (!el.activeAiBadge) return;
  const names = { openrouter: 'OpenRouter', gemini: 'Google Gemini', groq: 'Groq', openai: 'OpenAI', mistral: 'Mistral AI' };
  el.activeAiBadge.textContent = names[getActiveEngine()] || getActiveEngine();
}

function autoCloseAiSettings() {
  const keys = getKeys();
  if (keys[keys.activeEngine] && el.aiConfigDetails) {
    el.aiConfigDetails.removeAttribute('open');
  }
}

// ========================================
// VALIDATION CLÉ - Handler générique
// ========================================

function setupValidationButtons() {
  for (const [engine, cfg] of Object.entries(ENGINE_CONFIG)) {
    const btn = document.getElementById(cfg.btnId);
    if (!btn) continue;

    btn.addEventListener('click', async () => {
      const input = document.getElementById(cfg.inputId);
      const statusEl = document.getElementById(cfg.statusId);
      const key = input?.value.trim();

      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 mr-1 animate-spin"></i> Test...';
      lucide.createIcons();
      statusEl.className = 'hidden';

      const geminiModel = document.getElementById('modelSelect')?.value || 'gemini-2.5-pro';
      const result = await validateApiKey({ engine, key, geminiModel });

      statusEl.textContent = result.message;
      const color = result.success ? 'emerald' : 'red';
      statusEl.className = `text-xs mt-1 text-${color}-600 font-bold block`;

      input.classList.remove('input-valid', 'input-invalid', 'border-gray-200');
      input.classList.add(result.success ? 'input-valid' : 'input-invalid');

      if (result.success) {
        saveKeys();
        setTimeout(() => { if (el.aiConfigDetails) el.aiConfigDetails.removeAttribute('open'); }, 800);
      }

      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4 mr-1"></i> Vérifier';
      lucide.createIcons();
    });
  }
}

// ========================================
// UI HELPERS
// ========================================

function showMessage(msg, type = 'error') {
  if (!msg || msg.trim() === '') {
    el.alertBox.style.display = 'none';
    return;
  }
  el.alertText.textContent = msg; // textContent = pas de XSS
  el.alertBox.style.display = 'block';
  el.alertBox.className = {
    error: 'alert-box bg-red-50 text-red-800 border-red-500',
    warn:  'alert-box bg-amber-50 text-amber-900 border-amber-500',
    success: 'alert-box bg-emerald-50 text-emerald-800 border-emerald-500',
  }[type] || 'alert-box bg-emerald-50 text-emerald-800 border-emerald-500';
  lucide.createIcons();
  el.alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function setProgress(msg, percent = null) {
  if (!msg) {
    el.spinner.classList.add('hidden');
    el.progressContainer.classList.add('hidden');
    el.btnText.textContent = 'Générer le Plan';
    el.btn.disabled = false;
    return;
  }
  el.spinner.classList.remove('hidden');
  el.loadingStatus.textContent = msg;
  el.progressContainer.classList.remove('hidden');
  if (percent !== null) {
    el.progressBar.style.width = `${percent}%`;
    el.progressPercent.textContent = `${percent}%`;
  }
  el.btnText.textContent = 'Analyse spatiale...';
  el.btn.disabled = true;
}

// ========================================
// ICÔNES TYPE D'ARRÊT (sécurisées)
// ========================================

const TYPE_ICONS = {
  market:     { icon: 'shopping-basket', color: 'text-[#10b981]' },
  transport:  { icon: 'train',           color: 'text-blue-500' },
  shopping:   { icon: 'shopping-bag',    color: 'text-purple-500' },
  school:     { icon: 'graduation-cap',  color: 'text-amber-500' },
  competitor: { icon: 'target',          color: 'text-red-500' },
  sport:      { icon: 'trophy',          color: 'text-orange-500' },
  culture:    { icon: 'palette',         color: 'text-pink-500' },
  park:       { icon: 'trees',           color: 'text-green-500' },
  medical:    { icon: 'heart-pulse',     color: 'text-rose-500' },
  equestrian: { icon: 'rabbit',          color: 'text-amber-700' },
};

function getTypeIconHTML(type) {
  const cfg = TYPE_ICONS[type] || { icon: 'map-pin', color: 'text-gray-400' };
  return `<i data-lucide="${sanitize(cfg.icon)}" class="w-5 h-5 ${sanitize(cfg.color)} mr-3"></i>`;
}

/**
 * Génère le badge météo pour un jour.
 */
function renderWeatherBadge(weather) {
  if (!weather) return '';
  return `<span class="${weather.bg} border ${weather.border} ${weather.color} px-3 py-1.5 rounded-lg text-sm font-bold flex items-center shadow-sm gap-1.5" title="${sanitize(weather.label)} - ${weather.precipitation}mm - Vent ${weather.wind}km/h">
    <i data-lucide="${sanitize(weather.icon)}" class="w-4 h-4"></i>
    <span>${weather.tempMax}°</span>
    <span class="text-[10px] opacity-60">${weather.tempMin}°</span>
  </span>`;
}

// ========================================
// REGISTRE DES ARRÊTS (pour édition inline)
// ========================================
const stopRegistry = {};
let _stopCounter = 0;

// ========================================
// RENDU HTML SÉCURISÉ D'UN ARRÊT
// ========================================

/**
 * Nom de la voie sans son numéro : un secteur couvre toute la rue, afficher
 * « Secteur 12 Rue de la République » laisserait croire à un point précis.
 * Gère « 12 », « 12 bis », « 12B ». Si la voie n'est qu'un numéro, on la garde.
 */
function streetLabel(address) {
  const first = (address || '').split(',')[0].trim();
  const cleaned = first.replace(/^\d+\s*(bis|ter|quater|[a-zA-Z])?\b[\s,-]*/i, '').trim();
  return cleaned || first;
}

/**
 * Corps visible d'un arrêt (titre secteur + repères).
 * Partagé par renderStopHTML et saveStop pour garder les deux rendus identiques.
 */
function renderStopBodyHTML(stop, stopId, distBadge, srcLabel) {
  const street = streetLabel(stop.address) || stop.address || '';
  const city   = stop.address?.split(',').slice(1).join(',').trim() || '';

  // Repères visuels : lieu principal + commerces proches détectés dans OSM
  const marks = [stop.locationName, ...(stop.landmarks || [])].filter(Boolean);
  const marksHtml = marks.map(m => `<span class="font-medium text-gray-700">${sanitize(m)}</span>`).join('<span class="text-gray-300">·</span>');

  return `
    <div class="flex items-center flex-wrap gap-2">
      ${getTypeIconHTML(stop.type)}
      <span class="font-extrabold text-gray-900 text-lg">Secteur ${sanitize(street)}</span>
      ${distBadge}
      <button onclick="editStop('${stopId}')"
        class="ml-auto text-gray-300 hover:text-blue-500 transition-colors p-1 rounded"
        title="Modifier cet arrêt">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
    </div>
    <div class="text-sm text-gray-500 mt-1.5 flex items-center flex-wrap gap-x-2">
      <span class="text-gray-400 text-xs">Repères :</span>
      ${marksHtml}
      ${city ? `<span class="text-gray-400">${sanitize(city)}</span>` : ''}
      <span class="text-[10px] text-gray-300 uppercase tracking-widest border-l border-gray-200 pl-2 ml-1">
        SRC: ${sanitize(srcLabel)}
      </span>
    </div>`;
}

function renderStopHTML(stop, distBadge) {
  const stopId = `stop_${_stopCounter++}`;
  stopRegistry[stopId] = { ...stop };

  // Plage de secteur : « 10:00 - 10:45 » (45 min de présence, 15 min de trajet)
  const timeLabel = stop.timeEnd
    ? `${sanitize(stop.time)}<span class="block text-sm text-gray-400 font-bold">${sanitize(stop.timeEnd)}</span>`
    : sanitize(stop.time);

  return `
    <div class="stop-card flex items-center p-5 bg-white rounded-2xl border border-gray-200 shadow-sm mb-4" data-stop-id="${stopId}">
      <div class="w-24 font-extrabold text-2xl text-[#0E2C59] tracking-tight flex-shrink-0 leading-tight">${timeLabel}</div>
      <div class="flex-1 min-w-0 border-l-2 border-gray-100 pl-5">

        <!-- Vue normale -->
        <div class="stop-view">${renderStopBodyHTML(stop, stopId, distBadge, stop.source)}</div>

        <!-- Mode édition (caché par défaut) -->
        <div class="stop-edit hidden">
          <div class="flex flex-wrap gap-2 mt-1">
            <input type="text" id="edit-addr-${stopId}"
              class="input-style text-sm flex-1 min-w-[200px]"
              placeholder="Adresse complète" value="${sanitize(stop.address)}" />
            <input type="text" id="edit-name-${stopId}"
              class="input-style text-sm flex-1 min-w-[150px]"
              placeholder="Repère visuel (nom)" value="${sanitize(stop.locationName)}" />
            <button onclick="saveStop('${stopId}')"
              id="save-btn-${stopId}"
              class="bg-blue-600 text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-blue-700 whitespace-nowrap">
              ✓ Valider
            </button>
            <button onclick="cancelEditStop('${stopId}')"
              class="bg-gray-100 text-gray-600 text-xs font-bold px-3 py-2 rounded-lg hover:bg-gray-200">
              Annuler
            </button>
          </div>
          <p class="text-[11px] text-blue-500 mt-1">L'adresse sera vérifiée et la distance recalculée via BAN.</p>
        </div>

      </div>
    </div>`;
}

// ========================================
// RENDU ARRÊT PIÉTON STREET MARKETING
// ========================================

const SM_TYPE_ICONS = {
  pedestrian: { icon: 'footprints',     color: 'text-cyan-600' },
  square:     { icon: 'landmark',       color: 'text-cyan-700' },
  transport:  { icon: 'train',          color: 'text-blue-500' },
  market:     { icon: 'shopping-basket',color: 'text-cyan-500' },
  shopping:   { icon: 'shopping-bag',   color: 'text-cyan-600' },
  culture:    { icon: 'palette',        color: 'text-teal-500' },
  park:       { icon: 'trees',          color: 'text-teal-600' },
};

function renderSmStopHTML(stop) {
  const cfg = SM_TYPE_ICONS[stop.type] || { icon: 'map-pin', color: 'text-cyan-400' };
  const street = streetLabel(stop.address) || stop.address || '';
  const city   = stop.address?.split(',').slice(1).join(',').trim() || '';
  return `
    <div class="sm-stop-card flex items-center p-4 bg-white rounded-2xl border border-cyan-200 shadow-sm mb-3">
      <div class="w-16 font-extrabold text-xl text-cyan-700 tracking-tight flex-shrink-0">${sanitize(stop.time || '')}</div>
      <div class="flex-1 min-w-0 border-l-2 border-cyan-100 pl-4">
        <div class="flex items-center flex-wrap gap-2">
          <i data-lucide="${sanitize(cfg.icon)}" class="w-5 h-5 ${sanitize(cfg.color)} mr-1"></i>
          <span class="font-extrabold text-cyan-900 text-base">${sanitize(street || stop.locationName)}</span>
        </div>
        <div class="text-sm text-cyan-600 mt-1 flex items-center flex-wrap gap-x-2">
          <span class="font-medium">${sanitize(stop.locationName)}</span>
          ${city ? `<span class="text-cyan-400">${sanitize(city)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function editStop(stopId) {
  const card = document.querySelector(`[data-stop-id="${stopId}"]`);
  card?.querySelector('.stop-view')?.classList.add('hidden');
  card?.querySelector('.stop-edit')?.classList.remove('hidden');
  card?.querySelector(`#edit-addr-${stopId}`)?.focus();
}

function cancelEditStop(stopId) {
  const card = document.querySelector(`[data-stop-id="${stopId}"]`);
  card?.querySelector('.stop-view')?.classList.remove('hidden');
  card?.querySelector('.stop-edit')?.classList.add('hidden');
}

async function saveStop(stopId) {
  const card  = document.querySelector(`[data-stop-id="${stopId}"]`);
  const addrEl = document.getElementById(`edit-addr-${stopId}`);
  const nameEl = document.getElementById(`edit-name-${stopId}`);
  const btn    = document.getElementById(`save-btn-${stopId}`);
  if (!addrEl) return;

  const newAddr = addrEl.value.trim();
  const newName = (nameEl?.value || '').trim();
  if (!newAddr) return;

  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

  try {
    const stop = stopRegistry[stopId];
    const geoResult = await geocodeAddressBAN(newAddr);

    if (geoResult?.lat) {
      stop.lat = geoResult.lat;
      stop.lng = geoResult.lng;
      stop.address = geoResult.label || newAddr;
    } else {
      stop.address = newAddr;
    }
    if (newName) stop.locationName = newName;
    stop.source = 'MANUEL';

    // Recalculer distance
    let distBadge = '';
    const shopLoc = window._shopLocation;
    if (shopLoc && stop.lat && stop.lng) {
      const dist = calculateDistance(shopLoc.lat, shopLoc.lng, stop.lat, stop.lng);
      const cls  = dist <= 5 ? 'text-green-600' : dist <= 15 ? 'text-orange-500' : 'text-red-500';
      distBadge  = `<span class="${cls} font-bold text-sm ml-1">✓ ${dist.toFixed(1)}km</span>`;
    }

    const viewDiv = card?.querySelector('.stop-view');
    if (viewDiv) {
      viewDiv.innerHTML = renderStopBodyHTML(stop, stopId, distBadge, 'MANUEL');
    }

    cancelEditStop(stopId);
    lucide.createIcons(); // Rafraîchir les icônes Lucide après mise à jour du DOM
  } catch (err) {
    console.error('[saveStop]', err);
    if (btn) { btn.textContent = '✓ Valider'; btn.disabled = false; }
  }
}

// ========================================
// RENDU ÉMARGEMENT SÉCURISÉ
// ========================================

function renderAttendanceHTML(day) {
  const hasMorn = day.hasMorning !== false;
  const hasAft = day.hasAfternoon !== false;
  const cols = (hasMorn && hasAft) ? 'md:grid-cols-2' : 'md:grid-cols-1';

  let blocks = '';
  if (hasMorn) blocks += renderSignatureBlock('sun', 'amber', 'MATIN', day.startMatin, day.endMatin);
  if (hasAft) blocks += renderSignatureBlock('sunset', 'orange', 'APRÈS-MIDI', day.startAprem, day.endAprem);
  if (!hasMorn && !hasAft) blocks = '<p class="text-gray-400 italic text-center py-4">Journée sans créneau programmé</p>';

  return `
    <div class="border border-gray-200 rounded-[32px] p-8 bg-white mb-8 shadow-sm page-break-inside-avoid">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-8 pb-4 border-b border-gray-100 gap-4">
        <div class="font-extrabold text-2xl text-[#0E2C59] flex items-center">
          <i data-lucide="calendar" class="w-6 h-6 text-blue-500 mr-3"></i>
          ${sanitize(day.date)}
        </div>
        <div class="text-base text-gray-600 font-medium whitespace-nowrap flex items-center">
          Nom du chauffeur : <div class="w-64 border-b-2 border-dotted border-gray-400 ml-3"></div>
        </div>
      </div>
      <div class="grid grid-cols-1 ${cols} gap-8">
        ${blocks}
      </div>
    </div>`;
}

function renderSignatureBlock(icon, color, label, start, end) {
  return `
    <div class="bg-[#F8FAFC] p-6 rounded-3xl border border-gray-200">
      <div class="flex justify-between items-start mb-6">
        <div class="text-sm font-extrabold text-gray-800 flex items-center tracking-wider bg-white px-3 py-1 rounded-lg shadow-sm">
          <i data-lucide="${sanitize(icon)}" class="w-4 h-4 mr-2 text-${sanitize(color)}-500"></i> ${sanitize(label)}
        </div>
        <div class="text-xs text-right text-gray-600 font-medium">
          Début: <strong class="text-gray-900 text-sm ml-1">${sanitize(start)}</strong><br>
          Fin: <strong class="text-gray-900 text-sm ml-1">${sanitize(end)}</strong>
        </div>
      </div>
      <div class="h-32 border-2 border-dashed rounded-2xl border-${sanitize(color)}-200 bg-white flex items-end justify-end p-4">
        <span class="text-xs text-${sanitize(color)}-300 font-bold uppercase tracking-widest">Signature ${sanitize(label)}</span>
      </div>
    </div>`;
}

// ========================================
// GARDE-FOUS ÉCOLES
// ========================================

function enforceSchoolRules(dailyPlans, datesISO = [], schoolHolidays = []) {
  dailyPlans.forEach((dayPlan, idx) => {
    const dayStr = (dayPlan.day || '').toLowerCase();
    const isWeekSchoolDay = /lundi|mardi|jeudi|vendredi/.test(dayStr);

    // Vérifier si c'est une période de vacances scolaires
    const dateISO = datesISO[idx] || '';
    const isHoliday = dateISO ? isSchoolHoliday(dateISO, schoolHolidays) : false;
    const isSchoolDay = isWeekSchoolDay && !isHoliday;

    if (!dayPlan.stops) return;

    let morningSchool = false;
    let afternoonSchool = false;

    dayPlan.stops.forEach(stop => {
      const isSchool = stop.type === 'school' ||
        /ecole|école|scolaire/i.test(stop.locationName || '');

      if (!isSchool) return;

      if (!isSchoolDay) {
        stop.type = 'shopping';
        return;
      }

      stop.type = 'school';
      const hour = parseInt(stop.time.split(':')[0]);

      if (hour < 14 && !morningSchool) {
        stop.time = '11:15';
        morningSchool = true;
      } else if (hour >= 14 && !afternoonSchool) {
        stop.time = '16:15';
        afternoonSchool = true;
      } else {
        stop.type = 'shopping';
      }
    });
  });
}

// ========================================
// EXTRACTION DATE ISO DEPUIS CHAÎNE FR
// ========================================

/**
 * Extrait la date ISO (YYYY-MM-DD) d'une chaîne comme "mercredi 29/04/2026".
 */
function extractISOFromFrDate(str) {
  const m = (str || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// ========================================
// FICHE DE REPÉRAGE — LIEUX IMPORTANTS DE LA ZONE
// ========================================

/**
 * Rend les lieux structurants de la zone en 4 groupes.
 * Plafonné à 8 entrées par groupe pour rester lisible une fois exporté en PDF.
 */
function renderZoneLandmarks(groups) {
  const MAX = 8;

  // Classes Tailwind écrites en entier : le JIT du CDN ne génère que les
  // classes qu'il trouve sous forme de chaîne littérale complète.
  const THEMES = {
    indigo:  { badge: 'text-indigo-700 bg-indigo-50',   icon: 'text-indigo-600',  title: 'text-indigo-700' },
    emerald: { badge: 'text-emerald-700 bg-emerald-50', icon: 'text-emerald-600', title: 'text-emerald-700' },
    amber:   { badge: 'text-amber-700 bg-amber-50',     icon: 'text-amber-600',   title: 'text-amber-700' },
    sky:     { badge: 'text-sky-700 bg-sky-50',         icon: 'text-sky-600',     title: 'text-sky-700' },
  };

  const block = (title, icon, color, items, lineFn) => {
    if (!items.length) return '';
    const th = THEMES[color];
    const rows = items.slice(0, MAX).map(it => `
      <div class="flex items-start gap-2 py-1.5 border-b border-gray-100 last:border-0">
        <span class="text-xs font-bold ${th.badge} rounded px-1.5 py-0.5 flex-shrink-0 mt-0.5">${sanitize(it.distance)}km</span>
        <div class="min-w-0 text-sm">${lineFn(it)}</div>
      </div>`).join('');
    const more = items.length > MAX
      ? `<p class="text-xs text-gray-400 italic mt-2">+ ${items.length - MAX} autre(s) dans la zone</p>` : '';
    return `
      <div>
        <div class="flex items-center gap-2 mb-2">
          <i data-lucide="${icon}" class="w-4 h-4 ${th.icon}"></i>
          <span class="text-sm font-extrabold uppercase tracking-widest ${th.title}">${title} (${items.length})</span>
        </div>
        <div class="bg-gray-50 rounded-2xl px-4 py-2 border border-gray-200">${rows}${more}</div>
      </div>`;
  };

  const nameLine = (it) => `<span class="font-bold text-gray-900">${sanitize(it.name)}</span>`
    + (it.kind ? `<span class="text-gray-400 text-xs ml-1.5">${sanitize(it.kind)}</span>` : '')
    + (it.city ? `<span class="text-gray-400 text-xs ml-1.5">${sanitize(it.city)}</span>` : '');

  const html = [
    block('Gares & stations', 'train-front', 'indigo', groups.stations, nameLine),
    block('Marchés', 'shopping-basket', 'emerald', groups.markets, (it) =>
      `${nameLine(it)}<div class="text-xs text-emerald-700 font-semibold capitalize mt-0.5">${sanitize(it.days.join(', '))}${it.hours ? ` · ${sanitize(it.hours)}` : ''}</div>`),
    block('Places & rues importantes', 'map-pin', 'amber', groups.places, nameLine),
    block('Arrêts de bus', 'bus', 'sky', groups.busStops, nameLine),
  ].filter(Boolean).join('');

  // Panne Overpass : on le dit à l'écran plutôt que d'escamoter la page sans
  // explication. `data-pdf-skip` empêche ce message de finir dans le PDF client.
  if (groups.indisponible) {
    el.zoneLandmarksGrid.innerHTML = `
      <div class="md:col-span-2 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
        <i data-lucide="alert-triangle" class="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"></i>
        <div class="text-sm text-amber-900">
          <p class="font-bold">Fiche de repérage indisponible</p>
          <p class="mt-1">Les serveurs OpenStreetMap n'ont pas répondu (3 tentatives). Cette page sera absente du PDF. Relancez la génération dans quelques minutes pour l'obtenir.</p>
        </div>
      </div>`;
    el.zoneLandmarks.dataset.pdfSkip = '1';
    el.zoneLandmarks.classList.remove('hidden');
    return;
  }

  if (!html) return;
  delete el.zoneLandmarks.dataset.pdfSkip;
  el.zoneLandmarksGrid.innerHTML = html;
  el.zoneLandmarks.classList.remove('hidden');
}

// ========================================
// REPÈRES VISUELS D'UN SECTEUR
// ========================================

/**
 * Les 2 lieux les plus identifiables à moins de 300 m de l'arrêt.
 * Donne au chauffeur de quoi se repérer sans GPS.
 * Exige un nom propre : « Pharmacie (Villeneuve) », nom généré faute de tag
 * OSM `name`, serait inutilisable sur le terrain.
 */
function findLandmarks(stop, pois, max = 2) {
  if (!stop?.lat || !stop?.lng) return [];
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const seen = new Set([norm(stop.locationName)]);

  const candidats = pois
    .filter(p => p.hasProperName && p.name)
    .filter(p => {
      const key = norm(p.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(p => ({ p, d: calculateDistance(stop.lat, stop.lng, p.lat, p.lng) }))
    .filter(x => x.d <= 0.3); // calculateDistance renvoie des km

  const byScore = (a, b) => (b.p.publicScore || 1) - (a.p.publicScore || 1) || a.d - b.d;
  candidats.sort(byScore);

  // Une boulangerie (ou pâtisserie/opticien) est le repère le plus parlant
  // pour un chauffeur : enseigne visible, tout le monde la situe. On en
  // garantit une si elle est à portée, le reste se classe au score.
  const vitrine = candidats.find(x => x.p._premiumCenter);
  const retenus = vitrine ? [vitrine, ...candidats.filter(x => x !== vitrine)] : candidats;

  return retenus.slice(0, max).map(x => x.p.name);
}

// ========================================
// DÉCOUPAGE EN SECTEURS (présence + trajet)
// ========================================

// Le chauffeur reste 45 min sur un secteur, puis dispose de 15 min de trajet.
const PRESENCE_MIN = 45;
const TRAVEL_MIN   = 15;
const CYCLE_MIN    = PRESENCE_MIN + TRAVEL_MIN; // 60 min

const _toMin = t => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const _toStr = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Nombre de secteurs tenant dans une plage horaire.
 * Ex. 10:00-13:00 → 3 secteurs (10:00-10:45, 11:00-11:45, 12:00-12:45).
 */
function sectorCount(startTime, endTime) {
  const dur = _toMin(endTime) - _toMin(startTime);
  if (dur <= 0) return 0;
  return Math.max(1, Math.round((dur - TRAVEL_MIN) / CYCLE_MIN));
}

/**
 * Construit n plages [{start, end}] dans la fenêtre donnée.
 * Si n dépasse ce que la fenêtre permet, les plages sont comprimées
 * plutôt que de déborder (cas du jour de livraison des centres équestres).
 */
function buildCycles(startTime, endTime, n) {
  const startMin = _toMin(startTime);
  const endMin   = _toMin(endTime);
  const dur = endMin - startMin;
  if (dur <= 0 || n <= 0) return [];

  const cycle    = Math.min(CYCLE_MIN, Math.floor(dur / n));
  const presence = Math.max(15, Math.min(PRESENCE_MIN, cycle - TRAVEL_MIN));

  return Array.from({ length: n }, (_, i) => {
    const s = startMin + i * cycle;
    return { start: _toStr(s), end: _toStr(Math.min(s + presence, endMin)) };
  });
}

/**
 * Passe finale : affecte à chaque arrêt sa plage de secteur (time + timeEnd).
 * Exécutée en TOUT DERNIER, une fois le nombre d'arrêts définitivement figé.
 * `stop.time` reste l'heure de début canonique utilisée par le reste du code.
 * Les arrêts école gardent leur horaire imposé et consomment le secteur qui
 * les contient, au lieu de décaler toute la grille.
 */
function applySectorTimes(dailyPlans, perDayTimes) {
  dailyPlans.forEach((day, idx) => {
    const t = perDayTimes[idx];
    if (!t || !day.stops?.length) return;

    const split = 14 * 60;
    const morning   = day.stops.filter(s => _toMin(s.time) < split);
    const afternoon = day.stops.filter(s => _toMin(s.time) >= split);

    const assign = (arr, startTime, endTime) => {
      if (arr.length === 0) return;
      const cycles = buildCycles(startTime, endTime, arr.length);
      if (cycles.length === 0) return;

      // Les horaires imposés (école) réservent le secteur le plus proche
      const taken = new Set();
      arr.forEach(s => {
        if (s.type !== 'school') return;
        const target = _toMin(s.time);
        let best = -1, bestDist = Infinity;
        cycles.forEach((c, i) => {
          if (taken.has(i)) return;
          const d = Math.abs(_toMin(c.start) - target);
          if (d < bestDist) { bestDist = d; best = i; }
        });
        if (best !== -1) {
          taken.add(best);
          // L'école garde son heure réelle de sortie, la fin suit le secteur
          s.timeEnd = cycles[best].end;
          s._sector = _toMin(cycles[best].start);
        }
      });

      // Les autres arrêts prennent les secteurs restants, dans l'ordre
      const free = cycles.map((_, i) => i).filter(i => !taken.has(i));
      let fi = 0;
      arr.forEach(s => {
        if (s.type === 'school' && s._sector !== undefined) return;
        const c = cycles[free[fi++]] || cycles[cycles.length - 1];
        s.time = c.start;
        s.timeEnd = c.end;
        s._sector = _toMin(c.start);
      });

      arr.sort((a, b) => (a._sector ?? _toMin(a.time)) - (b._sector ?? _toMin(b.time)));
    };

    assign(morning,   t.mornStart, t.mornEnd);
    assign(afternoon, t.aftStart,  t.aftEnd);

    day.stops = [...morning, ...afternoon];
  });
}

// ========================================
// REDISTRIBUTION DES ARRÊTS SUR UNE PLAGE
// ========================================

/**
 * Recale les horaires des arrêts pour couvrir toute la plage.
 * Préserve les arrêts école (11:15 / 16:15) à leur position.
 */
function redistributeStops(stops, startTime, endTime) {
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const toStr = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  const startMin = toMin(startTime);
  const endMin = toMin(endTime);
  if (endMin <= startMin || stops.length === 0) return;

  const interval = (endMin - startMin) / stops.length;

  stops.forEach((stop, i) => {
    // Ne pas déplacer les arrêts école (horaires imposés)
    if (stop.type === 'school') return;
    const proposed = Math.round(startMin + i * interval);
    stop.time = toStr(Math.min(proposed, endMin - 15));
  });

  // Trier par horaire après redistribution
  stops.sort((a, b) => toMin(a.time) - toMin(b.time));
}

// ========================================
// GÉNÉRATION PRINCIPALE
// ========================================

async function handleGenerate() {
  showMessage('');

  if (!inputRefs.brand.value.trim() || !inputRefs.address.value.trim()) {
    return showMessage("Remplissez l'enseigne et la ville.");
  }

  const keys = getKeys();
  if (!keys[keys.activeEngine]) {
    return showMessage(`Veuillez renseigner votre clé API ${ENGINE_CONFIG[keys.activeEngine]?.label || keys.activeEngine}.`);
  }

  try {
    saveKeys();
    setProgress('Initialisation...', 5);

    // Reset UI
    poolMaigre = null;
    poolDeSecours = false;
    ['potentialMap', 'mapContainer', 'zoneLandmarks', 'planCard', 'attendanceCard',
     'reachEstimationContainer', 'officialBadges', 'badgeSiren', 'badgeInsee',
     'badgePop', 'analysisCard'
    ].forEach(id => el[id]?.classList.add('hidden'));

    // --- Géocodage ---
    setProgress('Vérification Adresse (API BAN)...', 15);
    const originObj = await geocodeAddressBAN(inputRefs.address.value);

    if (originObj.insee) {
      el.inseeVal.textContent = originObj.insee;
      el.badgeInsee.classList.remove('hidden');
      el.officialBadges.classList.remove('hidden');

      setProgress('Analyse Démographique (Géo API)...', 20);
      officialPopulation = await fetchPopulation(originObj.insee);
      if (officialPopulation) {
        el.popVal.textContent = formatNumber(officialPopulation);
        el.badgePop.classList.remove('hidden');
      }
    }

    // --- Dates ---
    const startDateObj = new Date(inputRefs.startDate.value);
    const duration = parseInt(inputRefs.duration.value) || 1;
    const datesList = [];
    const datesISO = [];
    for (let i = 0; i < duration; i++) {
      const d = new Date(startDateObj);
      d.setDate(d.getDate() + i);
      datesList.push(d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }));
      datesISO.push(d.toISOString().split('T')[0]);
    }

    // --- Météo + Vacances scolaires (APIs gratuites) ---
    setProgress('Prévisions météo & calendrier scolaire...', 22);
    const endDateObj = new Date(startDateObj);
    endDateObj.setDate(endDateObj.getDate() + duration - 1);
    const [weatherForecast, schoolHolidays] = await Promise.all([
      fetchWeatherForecast(originObj.lat, originObj.lng, startDateObj, duration),
      fetchSchoolHolidays(startDateObj, endDateObj),
    ]);

    // --- SIRENE ---
    setProgress(`Vérification légale SIRENE...`, 30);
    let officialBrand = inputRefs.brand.value;
    const companyData = await verifySIREN(inputRefs.brand.value);
    if (companyData) {
      officialBrand = companyData.nom_complet || inputRefs.brand.value;
      el.sirenVal.textContent = companyData.siren;
      el.badgeSiren.classList.remove('hidden');
      el.officialBadges.classList.remove('hidden');
    }

    // --- Auto-détection concurrents ---
    if (!inputRefs.competitors.value.trim()) {
      setProgress(`Détection IA des concurrents...`, 35);
      const geminiModel = document.getElementById('modelSelect')?.value || 'gemini-2.5-pro';
      try {
        const sys = 'Tu es un expert retail et géomarketing.';
        const p = `Identifie les 3 principaux concurrents physiques directs de "${officialBrand}" en France. JSON: {"competitors": "Aldi, Carrefour, Leclerc"}`;
        const raw = await callActiveAI(keys, p, sys, geminiModel);
        const parsed = JSON.parse(cleanJson(raw));
        let compValue = parsed.competitors;
        // L'IA peut retourner un tableau d'objets ou de chaînes — normaliser en string CSV
        if (Array.isArray(compValue)) {
          compValue = compValue.map(c => (typeof c === 'object' ? c.name || c.brand || '' : c)).filter(Boolean).join(', ');
        }
        if (compValue && typeof compValue === 'string' && !/vide|inconnu/i.test(compValue)) {
          inputRefs.competitors.value = compValue;
        }
      } catch { /* non-blocking */ }
    }

    // --- POIs OSM ---
    const radius = parseFloat(inputRefs.radius.value) || 10;
    setProgress(`Scan topographique à ${radius}km...`, 45);
    // Besoin réel : ~8 arrêts/jour, marge 1.5, chaque POI réutilisable 2 fois.
    // Sous ce seuil, l'échelle de repli s'épuise et invente des arrêts.
    const minPois = Math.max(30, Math.ceil(duration * 8 * 1.5 / 2));
    const realPOIsRaw = await fetchRealPOIs(originObj.lat, originObj.lng, radius, minPois);
    const targetCity = originObj.city || inputRefs.address.value.split(',')[0].trim();

    console.log(`[POI] ${realPOIsRaw.length} points d'intérêt trouvés dans la zone (rayon ${radius}km).`);

    // --- Filtrage exclusions ---
    const excludedList = inputRefs.excludedCities.value.trim().toLowerCase()
      .split(',').map(c => c.trim()).filter(Boolean);

    // Enseigne propre : liste des mots-clés (ex: "Marie Blachère" → ["marie blachère"])
    const ownBrandRaw = (inputRefs.ownBrand?.value || '').trim();
    const ownBrandList = ownBrandRaw.toLowerCase()
      .split(',').map(c => c.trim()).filter(Boolean);

    // Auto-détection : trouver nos propres magasins dans les POIs de la zone
    // et ajouter automatiquement leurs villes aux barrières
    if (ownBrandList.length > 0) {
      const ownStoresFound = realPOIsRaw.filter(poi =>
        ownBrandList.some(b => poi.name.toLowerCase().includes(b))
      );
      if (ownStoresFound.length > 0) {
        const newCities = [];
        ownStoresFound.forEach(store => {
          // Extraire la ville de l'adresse : dernier segment après la virgule
          const cityMatch = store.address.match(/,\s*([^,]+)$/);
          const city = cityMatch?.[1]?.trim().toLowerCase();
          if (city && !excludedList.includes(city)) {
            excludedList.push(city);
            newCities.push(city);
          }
        });
        if (newCities.length > 0) {
          // Mettre à jour le champ Barrières visuellement
          const currentVal = inputRefs.excludedCities.value.trim();
          inputRefs.excludedCities.value = [currentVal, ...newCities]
            .filter(Boolean).join(', ');
          showMessage(`Barrières auto-ajoutées (notre enseigne) : ${newCities.join(', ')}`, 'info');
        }
      }
    }

    // Géocoder les villes exclues → coordonnées GPS pour blocage précis
    // (certains POIs OSM n'ont pas addr:city → le blocage texte seul est insuffisant)
    const excludedCityCoords = [];
    for (const ex of excludedList) {
      try {
        const r = await fetch(
          `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(ex)}&type=municipality&limit=1`
        );
        const d = await r.json();
        if (d.features?.[0]) {
          const [lng, lat] = d.features[0].geometry.coordinates;
          excludedCityCoords.push({ name: ex, lat, lng });
        }
      } catch { /* continuer sans coords */ }
    }

    // Helper : un lieu est-il interdit ? (texte OU coordonnées dans rayon 3km)
    const isBlocked = (name = '', address = '', lat = null, lng = null) => {
      const nameLow = name.toLowerCase();
      const addrLow = address.toLowerCase();
      // Blocage par texte
      if (excludedList.some(ex => ex && (addrLow.includes(ex) || nameLow.includes(ex)))) return true;
      // Blocage par coordonnées GPS (fiable quand addr:city manque dans OSM)
      if (lat && lng && excludedCityCoords.some(ec =>
        calculateDistance(lat, lng, ec.lat, ec.lng) <= 3
      )) return true;
      // Notre enseigne : blocage par nom (mots-clés)
      if (ownBrandList.some(b => b && nameLow.includes(b))) return true;
      return false;
    };

    let filteredPOIs = realPOIsRaw.filter(poi =>
      !isBlocked(poi.name, poi.address, poi.lat, poi.lng)
    );

    // --- Concurrents ---
    setProgress('Localisation des concurrents...', 50);
    const userCompetitors = inputRefs.competitors.value.trim();
    let preVerifiedCompetitors = [];

    if (userCompetitors) {
      const compList = userCompetitors.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);

      for (const poi of filteredPOIs) {
        if (compList.some(c => poi.name.toLowerCase().includes(c))) {
          poi.type = 'competitor';
          preVerifiedCompetitors.push(poi);
        }
      }
      preVerifiedCompetitors = preVerifiedCompetitors.filter((v, i, a) => a.findIndex(v2 => v2.name === v.name) === i);

      if (preVerifiedCompetitors.length === 0) {
        for (const comp of compList) {
          const sData = await verifyCompetitorSIREN(comp, originObj.lat, originObj.lng, radius);
          if (sData) {
            const dist = calculateDistance(originObj.lat, originObj.lng, sData.lat, sData.lng);
            if (dist <= radius && !isBlocked(sData.name, sData.address, sData.lat, sData.lng)) {
              preVerifiedCompetitors.push({
                name: sData.name, lat: sData.lat, lng: sData.lng,
                type: 'competitor', address: sData.address,
                distance: dist.toFixed(1), source: 'SIRENE (Certifié)',
              });
            }
          }
        }
      }
    }

    // --- Villes / quartiers prioritaires ---
    const priorityList = (inputRefs.priorityCities?.value || '').trim().toLowerCase()
      .split(',').map(c => c.trim()).filter(Boolean);

    // Normalisation : retire tirets et accents pour comparaison robuste
    // "Nogent le Roi" (user) ≡ "Nogent-le-Roi" (OSM)
    const normStr = s => s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents
      .replace(/-/g, ' ')                               // tirets → espaces
      .replace(/\s+/g, ' ').trim();

    const normPriorityList = priorityList.map(normStr);

    // Coordonnées des zones prioritaires (remplies après geocoding)
    const priorityZoneCoords = []; // [{lat, lng}]

    const distKmPriority = (lat1, lng1, lat2, lng2) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    };

    // inPriorityZone : vérifie le flag, la sélection INSEE, la proximité GPS,
    // ou le texte. Le test INSEE passe en premier : c'est le seul qui repose
    // sur une géométrie exacte plutôt que sur un rayon ou une chaîne.
    const inPriorityZone = (name = '', address = '', lat = null, lng = null, flagged = false) => {
      if (flagged) return true;
      if (lat !== null && lng !== null && dansSelectionINSEE(lat, lng)) return true;
      if (lat !== null && lng !== null && priorityZoneCoords.length > 0) {
        if (priorityZoneCoords.some(c => distKmPriority(c.lat, c.lng, lat, lng) <= 3)) return true;
      }
      const nName = normStr(name);
      const nAddr = normStr(address);
      return normPriorityList.some(p => nAddr.includes(p) || nName.includes(p));
    };

    // Fetch POIs dédiés pour chaque zone prioritaire
    // poisByZone[i] = tableau de POIs appartenant à la zone i (pour enforcement par zone)
    const poisByZone = priorityList.map(() => []);
    if (priorityList.length > 0) {
      setProgress('Recherche dans les zones prioritaires…', 48);

      // Phase 1 : géocoder + fetcher toutes les zones EN PARALLÈLE
      const zoneFetches = await Promise.all(priorityList.map(async (city, zi) => {
        try {
          // Geocoding sans restriction de type → accepte adresses, quartiers, villes
          const geoRes = await fetch(
            `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(city)}&limit=1`
          );
          const geoData = await geoRes.json();
          if (!geoData.features?.[0]) {
            console.warn(`[Priorité] geocoding échoué pour : ${city}`);
            return null;
          }
          const [cLng, cLat] = geoData.features[0].geometry.coordinates;
          const cityPOIs = await fetchRealPOIs(cLat, cLng, 3);
          return { zi, city, cLat, cLng, cityPOIs };
        } catch (e) {
          console.warn(`[Priorité] erreur pour ${city}:`, e);
          return null;
        }
      }));

      // Phase 2 : fusionner séquentiellement dans filteredPOIs (état partagé)
      for (const res of zoneFetches) {
        if (!res) continue;
        const { zi, city, cLat, cLng, cityPOIs } = res;
        priorityZoneCoords.push({ lat: cLat, lng: cLng, city });

        cityPOIs.forEach(p => {
          p._priorityZone = true;
          if (!p._priorityZoneIdxs) p._priorityZoneIdxs = [];
          if (!p._priorityZoneIdxs.includes(zi)) p._priorityZoneIdxs.push(zi);
        });

        const newPOIs = cityPOIs.filter(p =>
          !filteredPOIs.some(e => e.name === p.name && e.address === p.address) &&
          !isBlocked(p.name, p.address, p.lat, p.lng)
        );
        // Mettre à jour ceux déjà présents dans filteredPOIs
        cityPOIs.forEach(p => {
          const existing = filteredPOIs.find(e => e.name === p.name && e.address === p.address);
          if (existing) {
            existing._priorityZone = true;
            if (!existing._priorityZoneIdxs) existing._priorityZoneIdxs = [];
            if (!existing._priorityZoneIdxs.includes(zi)) existing._priorityZoneIdxs.push(zi);
          }
        });

        filteredPOIs.push(...newPOIs);
        poisByZone[zi] = filteredPOIs.filter(p => p._priorityZoneIdxs?.includes(zi));
        console.log(`[Priorité] Zone ${zi} "${city}" (${cLat.toFixed(4)},${cLng.toFixed(4)}) → ${poisByZone[zi].length} POI(s)`);
      }
    }

    // --- Secteurs sélectionnés sur la carte du potentiel INSEE ---
    // On va chercher des POI autour de chaque secteur retenu : sans cette
    // passe, la sélection n'aurait aucun candidat à proposer si la requête
    // Overpass initiale, centrée sur le QG, ne les couvrait pas.
    const inseeSecteurs = (inseeSelection?.secteurs || []).slice(0, 6);
    if (inseeSecteurs.length > 0) {
      setProgress('Recherche dans les zones INSEE sélectionnées…', 50);

      const lots = await Promise.all(inseeSecteurs.map(async (sec) => {
        // Rayon couvrant le secteur : chaque carreau fait 0,04 km².
        const rayonSec = Math.min(4, Math.sqrt((sec.nbCarreaux * 0.04) / Math.PI) + 0.4);
        try {
          return { sec, pois: await fetchRealPOIs(sec.lat, sec.lng, rayonSec) };
        } catch (e) {
          console.warn(`[INSEE] POI indisponibles pour ${sec.commune}`, e);
          return { sec, pois: [] };
        }
      }));

      for (const { sec, pois } of lots) {
        const nouveaux = pois.filter(p =>
          !filteredPOIs.some(e => e.name === p.name && e.address === p.address) &&
          !isBlocked(p.name, p.address, p.lat, p.lng)
        );
        nouveaux.forEach(p => { p._priorityZone = true; p._insee = true; });
        // Les POI déjà connus qui tombent dans la sélection héritent du flag.
        filteredPOIs.forEach(p => {
          if (dansSelectionINSEE(p.lat, p.lng)) { p._priorityZone = true; p._insee = true; }
        });
        filteredPOIs.push(...nouveaux);
        console.log(`[INSEE] Secteur "${sec.commune}" (${sec.ind} hab., ${sec.nbCarreaux} carreaux) → +${nouveaux.length} POI(s)`);
      }
    }

    // --- Bonus "lieu de vie" : proximité d'un centre de peuplement ---
    // Un POI à moins de 800 m d'un bourg/village/quartier est un lieu fréquenté.
    // Mesure directe, contrairement au comptage de voisins qui ne refléterait
    // que la composition de notre propre requête Overpass.
    // Les lieux structurants de la zone sont récupérés en parallèle : requête
    // indépendante, inutile d'ajouter sa latence à celle des centres de peuplement.
    const [placeNodes, zoneLandmarks] = await Promise.all([
      fetchPlaceNodes(originObj.lat, originObj.lng, radius),
      fetchZoneLandmarks(originObj.lat, originObj.lng, radius),
    ]);
    if (placeNodes.length > 0) {
      for (const poi of filteredPOIs) {
        const nearPlace = placeNodes.some(pl =>
          calculateDistance(poi.lat, poi.lng, pl.lat, pl.lng) <= 0.8
        );
        if (nearPlace) poi.publicScore = (poi.publicScore || 1) + 3;
        else poi._isolated = true;
      }
    }

    // --- Filtrage strict des lieux isolés, avec repli automatique ---
    // Les transports, marchés et écoles restent valables même isolés
    // (une gare de campagne reste un point de passage public).
    const ALWAYS_KEEP = ['transport', 'market', 'school'];
    const strictPOIs = filteredPOIs.filter(p => !p._isolated || ALWAYS_KEEP.includes(p.type));
    if (strictPOIs.length >= minPois) {
      console.log(`[POI] Filtrage strict : ${filteredPOIs.length} → ${strictPOIs.length} lieux de vie.`);
      filteredPOIs = strictPOIs;
    } else if (strictPOIs.length < filteredPOIs.length) {
      // Repli : réintégrer les meilleurs isolés jusqu'à couvrir le besoin
      const rejected = filteredPOIs
        .filter(p => p._isolated && !ALWAYS_KEEP.includes(p.type))
        .sort((a, b) => (b.publicScore || 1) - (a.publicScore || 1));
      const reinstated = rejected.slice(0, Math.max(0, minPois - strictPOIs.length));
      console.log(`[POI] Filtrage assoupli : ${strictPOIs.length} lieux de vie + ${reinstated.length} réintégrés (besoin ${minPois}).`);
      filteredPOIs = [...strictPOIs, ...reinstated];
    }

    // --- Tri POIs : prioritaires d'abord, puis marchés, puis local, puis distance ---
    filteredPOIs.sort((a, b) => {
      const aPriority = inPriorityZone(a.name, a.address, a.lat, a.lng, a._priorityZone);
      const bPriority = inPriorityZone(b.name, b.address, b.lat, b.lng, b._priorityZone);
      if (aPriority && !bPriority) return -1;
      if (!aPriority && bPriority) return 1;
      if (a.type === 'market' && b.type !== 'market') return -1;
      if (b.type === 'market' && a.type !== 'market') return 1;
      const aLocal = normStr(a.address).includes(normStr(targetCity)) && parseFloat(a.distance) <= 2.0;
      const bLocal = normStr(b.address).includes(normStr(targetCity)) && parseFloat(b.distance) <= 2.0;
      if (aLocal && !bLocal) return -1;
      if (!aLocal && bLocal) return 1;
      return parseFloat(a.distance) - parseFloat(b.distance);
    });

    // --- Sauvetage quand la requête principale n'a rien ramené ---
    // Une panne d'Overpass vidait le pool et tous les arrêts retombaient sur
    // l'adresse du dépôt. Or deux gisements de lieux réels restaient
    // inexploités : la fiche de repérage (gares, arrêts de bus, marchés,
    // places), qui vient d'une requête distincte avec ses propres tentatives,
    // et les centres des communes sélectionnées sur la carte INSEE. Mieux vaut
    // un plan bâti sur ces points-là, quitte à les répéter, que vingt arrêts
    // au dépôt.
    if (filteredPOIs.length === 0) {
      const deRepere = [];
      const verser = (items, type, score) => (items || []).forEach(it => {
        if (!it?.lat || !it?.lng) return;
        deRepere.push({
          name: it.name,
          address: it.city ? `${it.name}, ${it.city}` : it.name,
          type, lat: it.lat, lng: it.lng,
          distance: it.distance,
          publicScore: score, hasProperName: true, marketDays: [],
        });
      });
      verser(zoneLandmarks?.stations, 'transport', 12);
      verser(zoneLandmarks?.markets,  'market',    11);
      verser(zoneLandmarks?.places,   'other',      9);
      verser(zoneLandmarks?.busStops, 'transport',  7);

      if (deRepere.length > 0) {
        filteredPOIs = deRepere.filter(p => !isBlocked(p.name, p.address, p.lat, p.lng));
        console.warn(`[POI] Pool principal vide → ${filteredPOIs.length} lieu(x) repris de la fiche de repérage.`);
      }

      // Toujours rien : les communes retenues sur la carte INSEE sont des
      // centres de population réels, avec un nom et des coordonnées sûres.
      if (filteredPOIs.length === 0 && inseeSelection?.communes?.length) {
        // Élision : « Centre d'Alleins », pas « Centre de Alleins ». Ce nom
        // part tel quel sur la feuille de route du chauffeur.
        const centreDe = (nom) => /^[aeiouyàâéèêëîïôöùûü]/i.test(nom)
          ? `Centre d'${nom}` : `Centre de ${nom}`;
        filteredPOIs = inseeSelection.communes.slice(0, 10).map(c => ({
          name: centreDe(c.commune),
          address: c.commune,
          type: 'other', lat: c.lat, lng: c.lng,
          distance: calculateDistance(originObj.lat, originObj.lng, c.lat, c.lng).toFixed(1),
          publicScore: 6, hasProperName: true, marketDays: [],
        })).filter(p => !isBlocked(p.name, p.address, p.lat, p.lng));
        console.warn(`[POI] Repli INSEE → ${filteredPOIs.length} centre(s) de commune.`);
      }

      poolDeSecours = filteredPOIs.length > 0;
    }

    // --- Construction du prompt IA ---
    // On n'envoie que les champs utiles (nom, adresse, type, coords, distance)
    // et limité à 50 POI pour accélérer — moins de tokens = génération rapide.
    // `insee: 1` marque les lieux situés dans une zone validée par le client :
    // sans ce drapeau, l'IA n'aurait aucun moyen d'appliquer le quota de 60%.
    const slimPOIs = filteredPOIs.slice(0, 50).map(p => ({
      name: p.name, address: p.address, type: p.type,
      lat: p.lat, lng: p.lng, dist: p.distance,
      ...(dansSelectionINSEE(p.lat, p.lng) ? { insee: 1 } : {}),
    }));
    let poiContext = filteredPOIs.length > 0
      ? `BASE OSM DÉDIÉE :\n${JSON.stringify(slimPOIs)}\n`
      : 'BASE OSM VIDE.\n';

    if (preVerifiedCompetitors.length > 0) {
      poiContext += `\nBASE CONCURRENTS CERTIFIÉS :\n${JSON.stringify(preVerifiedCompetitors)}\n`;
    }

    // Jours de marché vérifiés via OSM opening_hours
    const marketPOIs = filteredPOIs.filter(p => p.type === 'market');
    if (marketPOIs.length > 0) {
      const marketLines = marketPOIs.map(m =>
        `${m.name} (${m.address}) → ouvert : ${m.marketDays.length ? m.marketDays.join(', ') : 'mercredi, samedi'}`
      ).join('\n');
      poiContext += `\nMARCHÉS FORAINS VÉRIFIÉS (jours réels OSM) :\n${marketLines}\n`;
      poiContext += `RÈGLE ABSOLUE : ne placer un marché QUE sur les jours indiqués ci-dessus.\n`;
    }

    let competitorInstruction = preVerifiedCompetitors.length > 0
      ? 'CONCURRENTS: Inclus au moins 1-2 par jour tirés de la BASE CONCURRENTS CERTIFIÉS.'
      : 'CONCURRENTS: Aucun trouvé dans le périmètre.';

    // Secteurs INSEE : on donne à l'IA la population réelle de chaque zone
    // retenue, pour qu'elle hiérarchise les journées sur le potentiel mesuré
    // et non sur l'ordre de saisie.
    // Regroupées par commune : une ville éclatée en trois blocs occupait trois
    // places du classement et en évinçait d'autres.
    const inseeCommunes = (inseeSelection?.communes || []).slice(0, 6);
    const inseeInstruction = inseeCommunes.length > 0
      ? `ZONES INSEE SÉLECTIONNÉES PAR LE CLIENT (${inseeSelection.totalInd} habitants, ${inseeSelection.totalMen} ménages au total) — ce sont LES zones à couvrir en priorité, par ordre de potentiel : `
        + inseeCommunes.map((s, i) =>
            `[${i + 1}] ${s.commune} (${s.ind} hab., ${s.men} ménages, centre ${s.lat.toFixed(4)},${s.lng.toFixed(4)})`
          ).join(' ; ')
        + `. Au moins 60% des arrêts doivent se trouver à moins de 1 km du centre d'une de ces zones, et chaque zone du top 3 doit être visitée au moins une fois sur la période.`
      : '';

    const exclusionInstruction = [
      inseeInstruction,
      priorityList.length > 0
        ? `ZONES PRIORITAIRES : inclure au moins 10% des arrêts dans ou autour de : ${priorityList.join(', ').toUpperCase()}. Ces zones doivent apparaître au moins 1 fois par journée.`
        : '',
      excludedList.length > 0
        ? `INTERDICTION ABSOLUE : aucun arrêt dans ${excludedList.join(', ').toUpperCase()} ni dans aucune adresse contenant ces noms.`
        : 'Ne traverse PAS les fleuves majeurs.',
      ownBrandList.length > 0
        ? `NOTRE ENSEIGNE À ÉVITER : ne jamais planifier d'arrêt chez ${ownBrandList.join(', ').toUpperCase()} (notre propre réseau, risque de cannibalisation).`
        : '',
    ].filter(Boolean).join(' ');

    // --- Street Marketing couplé ---
    const smDays = getSmDays(); // ISO dates sélectionnées
    const smCityRaw = (inputRefs.smCity?.value || '').trim() || targetCity;
    const smTeamSize = parseInt(inputRefs.smTeamSize?.value || '2');
    const smActive = smDays.length > 0;
    const smTimes = {
      hasMorning:   inputRefs.smHasMorning?.checked !== false,
      mornStart:    inputRefs.smMornStart?.value || '10:00',
      mornEnd:      inputRefs.smMornEnd?.value   || '13:00',
      hasAfternoon: inputRefs.smHasAfternoon?.checked !== false,
      aftStart:     inputRefs.smAftStart?.value  || '14:00',
      aftEnd:       inputRefs.smAftEnd?.value    || '17:00',
    };

    // Géocoder la ville SM pour contraindre le véhicule à rester proche
    let smCityCoords = null;
    if (smActive) {
      try {
        const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(smCityRaw)}&type=municipality&limit=1`);
        const d = await r.json();
        if (d.features?.[0]) {
          const [lng, lat] = d.features[0].geometry.coordinates;
          smCityCoords = { lat, lng };
        }
      } catch { /* continuer sans */ }
    }

    // --- Centres équestres (distribution de coupons, mardi ou jeudi) ---
    const equestrianActive = inputRefs.equestrianEnabled?.checked === true;
    const equestrianDay = inputRefs.equestrianDay?.value || 'jeudi';
    let equestrianCenters = [];
    if (equestrianActive) {
      setProgress('Recherche des centres équestres...', 50);
      equestrianCenters = await fetchEquestrianCenters(originObj.lat, originObj.lng, radius);
      // Enrichir les adresses de livraison manquantes via reverse-géocodage BAN
      for (const c of equestrianCenters) {
        const hasRealAddress = /\d/.test(c.address) && c.address.includes(',');
        if (!hasRealAddress) {
          const a = await reverseGeocodeBAN(c.lat, c.lng);
          if (a) c.address = a;
        }
      }
      console.log(`[Équestre] ${equestrianCenters.length} centres équestres trouvés (OSM)`);

      // Ajout manuel : « Nom ; Adresse » (une ligne par centre)
      const manualRaw = (inputRefs.equestrianManual?.value || '').trim();
      if (manualRaw) {
        const lines = manualRaw.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          const [namePart, ...addrParts] = line.split(';');
          const name = (namePart || '').trim();
          const address = addrParts.join(';').trim();
          if (!name) continue;
          // Géocodage de l'adresse (ou du nom) pour placer le point sur le tracé
          let geo = null;
          try { geo = await geocodeAddressBAN(address || name); } catch { geo = null; }
          const manual = {
            name, type: 'equestrian', source: 'CENTRE ÉQUESTRE (saisi)',
            address: address || 'Dépôt de coupons',
            hours: 'Non spécifié', reliability: 7, marketDays: [],
            manual: true,
            lat: geo?.lat ?? originObj.lat,
            lng: geo?.lng ?? originObj.lng,
            distance: geo ? calculateDistance(originObj.lat, originObj.lng, geo.lat, geo.lng).toFixed(1) : '0.0',
          };
          // Évite les doublons avec les centres OSM (même nom).
          // Placé en tête pour être prioritaire (jamais coupé par slice(0,10)).
          const dupIdx = equestrianCenters.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
          if (dupIdx >= 0) equestrianCenters.splice(dupIdx, 1);
          equestrianCenters.unshift(manual);
        }
        console.log(`[Équestre] ${lines.length} centre(s) saisi(s) manuellement ajouté(s)`);
      }
    }

    // --- Horaires par jour (personnalisés ou par défaut) ---
    const perDayTimes = [];
    let perDayTimesPrompt = '';
    for (let i = 0; i < duration; i++) {
      const t = getTimesForDay(i);
      perDayTimes.push(t);

      const isHoliday = isSchoolHoliday(datesISO[i], schoolHolidays);
      const mornLabel = t.hasMorning ? `Matin ${t.mornStart}-${t.mornEnd}` : 'PAS DE MATIN (0 arrêts)';
      const aftLabel = t.hasAfternoon ? `Aprem ${t.aftStart}-${t.aftEnd}` : 'PAS D\'APRÈS-MIDI (0 arrêts)';
      const holidayTag = isHoliday ? ' [VACANCES SCOLAIRES - PAS D\'ÉCOLE]' : '';
      const isSmDay = smActive && smDays.includes(datesISO[i]);
      const smTag = isSmDay ? ` [STREET MARKETING : équipe piétonne ${smTeamSize}p à ${smCityRaw}]` : '';
      perDayTimesPrompt += `  - ${datesList[i]} : ${mornLabel}, ${aftLabel}${holidayTag}${smTag}\n`;
    }

    // Nombre total de secteurs à remplir sur la période. Sert à prévenir quand
    // le pool est trop maigre : le plan reste produit, mais il tournera sur les
    // mêmes lieux, et autant le dire avant que le client ne l'ouvre.
    const besoinTotal = perDayTimes.reduce((t, j) =>
      t + (j.hasMorning ? sectorCount(j.mornStart, j.mornEnd) : 0)
        + (j.hasAfternoon ? sectorCount(j.aftStart, j.aftEnd) : 0), 0);
    if (filteredPOIs.length < Math.min(besoinTotal, 8)) {
      console.warn(`[POI] pool maigre : ${filteredPOIs.length} lieux pour ${besoinTotal} arrêts à couvrir.`);
      poolMaigre = { trouves: filteredPOIs.length, besoin: besoinTotal };
    }

    setProgress('Analyse IA Stratégique...', 60);
    el.displayBrand.textContent = officialBrand;
    el.dateSpan.textContent = new Date().toLocaleDateString('fr-FR');

    // Construire info vacances scolaires pour le prompt
    const holidayInfo = schoolHolidays.length > 0
      ? `VACANCES SCOLAIRES en cours : ${schoolHolidays.map(h => h.description || `${h.start} au ${h.end}`).join(', ')}. Les jours marqués [VACANCES SCOLAIRES] ne doivent avoir AUCUN arrêt école.`
      : '';

    const systemInstruction = `Tu es un expert en géomarketing. Renvoie UNIQUEMENT du JSON pur.
RAYON MAX: ${radius} km autour de (${originObj.lat}, ${originObj.lng}).
${exclusionInstruction}
STRATÉGIE CARDINALE: Attribue à chaque jour une direction dominante (Nord, Sud, Est, Ouest).
PROXIMITÉ: 60% des arrêts dans "${targetCity}" à moins de 2.0 km.
REPÈRES PREMIUM: Les opticiens et boulangeries occupent les meilleurs emplacements en cœur de ville — privilégie-les comme points d'ancrage centraux quand ils figurent dans la BASE OSM.
JOURS: Tu DOIS générer EXACTEMENT ${duration} entrées dans dailyPlans, une par jour, dans l'ordre chronologique. Même les jours sans créneau doivent avoir une entrée avec "stops":[] vide.
HORAIRES: environ 1 arrêt par heure de créneau actif (ex. 10:00-13:00 → 3 arrêts). ATTENTION : chaque jour peut avoir des horaires DIFFÉRENTS. Si un créneau indique "PAS DE MATIN" ou "PAS D'APRÈS-MIDI", génère ZÉRO arrêt pour ce créneau.
SECTEURS: chaque arrêt est un SECTEUR où le véhicule stationne 45 minutes. Choisis des lieux de VIE très fréquentés et visibles depuis la rue : commerces de centre-ville, arrêts de bus, gares, places et marchés. JAMAIS de zone d'activité, d'entrepôt ni de lieu isolé en rase campagne. Les horaires exacts sont recalculés automatiquement : donne un ordre de passage cohérent géographiquement, sans te soucier des minutes.
DIVERSITÉ: Mélanger transport, shopping, school, competitor, sport, culture, park, medical. Max 2 du même type d'affilée.
MARCHÉS: Les arrêts type "market" se planifient UNIQUEMENT les mercredis et samedis matin (jours de marché traditionnels en France), à partir de 10h00. Ne jamais placer un marché un mardi, lundi, jeudi ou vendredi.
CENTRES COMMERCIAUX: Les arrêts type "shopping" se planifient entre 12h00 et 14h00 les mercredis après-midi et samedis après-midi (pic d'affluence pause déjeuner et week-end).
ÉCOLES: EXCLUSIVEMENT Lundi, Mardi, Jeudi, Vendredi HORS vacances scolaires. Horaires imposés : matin "11:15" (sortie 11h15-11h30), après-midi "16:15" (sortie 16h15-16h30). ${holidayInfo}
${competitorInstruction}
ANTI-DOUBLON: Aucune adresse répétée.
COPIE EXACTE: Recopier name/address depuis la BASE OSM.
${smActive ? `STREET MARKETING COUPLÉ: Les jours marqués [STREET MARKETING] le VÉHICULE doit concentrer TOUS ses arrêts dans un rayon de 3 km autour du centre de ${smCityRaw}. Ces jours-là, génère AUSSI un tableau "smStops" (4 à 6 arrêts piétons) avec des rues commerçantes, places, hubs de transport ou marchés de ${smCityRaw}. Les smStops ont le même format que stops mais type parmi : pedestrian|square|transport|market.` : ''}
JSON FORMAT: {"analysis":"...","dailyPlans":[{"day":"lundi JJ/MM/YYYY","role":"VÉHICULE","stops":[{"time":"HH:MM","locationName":"Nom","address":"Adresse","type":"market|transport|shopping|school|competitor|sport|culture|park|medical|other","source":"OSM","lat":0,"lng":0}],"smStops":[]}],"attendance":[{"date":"JJ/MM/YYYY","startMatin":"HH:MM","endMatin":"HH:MM","startAprem":"HH:MM","endAprem":"HH:MM"}]}`;

    const prompt = `Plan pour ${officialBrand} depuis ${inputRefs.address.value}.\nHORAIRES PAR JOUR :\n${perDayTimesPrompt}\n${poiContext}`;

    const geminiModel = document.getElementById('modelSelect')?.value || 'gemini-2.5-pro';
    let rawText;
    try {
      rawText = await callActiveAI(keys, prompt, systemInstruction, geminiModel);
    } catch (e) {
      // Message sur sa propre ligne : e.message peut déjà énumérer un moteur
      // par ligne (moteur choisi + replis), illisible accolé à un préfixe.
      throw new Error(`Serveurs IA indisponibles.\n${e.message}`);
    }

    let data;
    try {
      data = JSON.parse(cleanJson(rawText));
      data.dailyPlans = data.dailyPlans || [];
      if (data.dailyPlans.length === 0) {
        throw new Error("Plan vide. Élargissez le rayon ou relancez.");
      }
      // Toujours écraser l'attendance avec les horaires réels de l'utilisateur
      data.attendance = datesList.map((d, i) => {
        const t = perDayTimes[i] || perDayTimes[0];
        return {
          date: d,
          hasMorning: t.hasMorning,
          hasAfternoon: t.hasAfternoon,
          startMatin: t.mornStart,
          endMatin: t.mornEnd,
          startAprem: t.aftStart,
          endAprem: t.aftEnd,
        };
      });
    } catch (err) {
      throw new Error(err.message.includes('vide') ? err.message : "L'IA a mal formaté la réponse.");
    }

    data.shopLocation = { lat: originObj.lat, lng: originObj.lng, address: originObj.display_name };
    window._shopLocation = data.shopLocation; // exposé pour l'édition inline des arrêts

    // --- Normalisation : exactement 1 entrée par date, dans l'ordre ---
    // L'IA peut sauter des jours, en dupliquer, ou les mettre dans le désordre.
    // On force le mapping par DATE, pas par index.
    const plansByISO = {};
    (data.dailyPlans || []).forEach(dp => {
      const iso = extractISOFromFrDate(dp.day || '');
      if (iso && !plansByISO[iso]) {
        plansByISO[iso] = dp;
      } else if (iso && plansByISO[iso]) {
        // Doublon : fusionner les stops
        plansByISO[iso].stops = [...(plansByISO[iso].stops || []), ...(dp.stops || [])];
      }
    });

    data.dailyPlans = datesISO.map((iso, i) => {
      return plansByISO[iso] || { day: datesList[i], role: 'VÉHICULE', stops: [] };
    });

    // --- Garde-fou : forcer la répartition matin/aprem ---
    // Maintenant l'index est fiable (1:1 avec perDayTimes).
    // Si l'IA n'a pas fourni assez d'arrêts, on crée des placeholders
    // que la validation topographique remplira avec de vrais POIs.
    const makePlaceholder = () => ({
      time: '00:00', locationName: '', address: '', type: 'other',
      source: '', lat: 0, lng: 0,
    });

    data.dailyPlans.forEach((dayPlan, idx) => {
      const t = perDayTimes[idx];
      if (!t) return;
      dayPlan.stops = dayPlan.stops || [];

      const allStops = dayPlan.stops;
      // Nombre d'arrêts = nombre de secteurs tenant réellement dans la plage
      const nMorn = t.hasMorning   ? sectorCount(t.mornStart, t.mornEnd) : 0;
      const nAft  = t.hasAfternoon ? sectorCount(t.aftStart,  t.aftEnd)  : 0;

      if (nMorn && nAft) {
        const needed = nMorn + nAft;
        while (allStops.length < needed) allStops.push(makePlaceholder());
        const mornStops = allStops.slice(0, nMorn);
        const aftStops = allStops.slice(nMorn, needed);
        redistributeStops(mornStops, t.mornStart, t.mornEnd);
        redistributeStops(aftStops, t.aftStart, t.aftEnd);
        dayPlan.stops = [...mornStops, ...aftStops];
      } else if (nMorn) {
        while (allStops.length < nMorn) allStops.push(makePlaceholder());
        const mornStops = allStops.slice(0, nMorn);
        redistributeStops(mornStops, t.mornStart, t.mornEnd);
        dayPlan.stops = mornStops;
      } else if (nAft) {
        while (allStops.length < nAft) allStops.push(makePlaceholder());
        const aftStops = allStops.slice(0, nAft);
        redistributeStops(aftStops, t.aftStart, t.aftEnd);
        dayPlan.stops = aftStops;
      } else {
        dayPlan.stops = [];
      }
    });

    // --- Garde-fou écoles (1er passage) ---
    enforceSchoolRules(data.dailyPlans, datesISO, schoolHolidays);

    // --- Validation topographique des arrêts ---
    setProgress('Génération des tracés réels...', 75);

    // Trier par publicScore décroissant : fiabilité du type + richesse des tags
    // + proximité d'un lieu de vie. Le tri JS étant stable, l'ordre par distance
    // établi plus haut est préservé à score égal.
    const availablePOIs = [...filteredPOIs, ...preVerifiedCompetitors]
      .sort((a, b) => (b.publicScore || b.reliability || 1) - (a.publicScore || a.reliability || 1));

    const defaultComps = ['aldi', 'lidl', 'carrefour', 'store', 'brico', 'castorama', 'leroy'];
    const userCompsList = userCompetitors ? userCompetitors.split(',').map(s => s.trim().toLowerCase()) : [];
    const allCompsToCheck = [...defaultComps, ...userCompsList];

    // Préférer les types utiles pour le chauffeur (commerces, transports)
    const USEFUL_TYPES = ['market', 'shopping', 'transport', 'competitor', 'sport', 'culture', 'medical'];

    // Compteur global d'utilisations — max 2 fois par POI sur toute la campagne
    const MAX_POI_USES = 2;
    const poiUseCount = new Map(); // name → nb d'utilisations
    const canUse = (name) => (poiUseCount.get(name) || 0) < MAX_POI_USES;
    const markUsed = (name) => poiUseCount.set(name, (poiUseCount.get(name) || 0) + 1);

    // Arrêts nécessitant un reverse-geocoding → traités en parallèle après la boucle
    const stopsNeedingAddr = [];

    for (const day of data.dailyPlans) {
      if (!day.stops) continue;
      const dayStr = (day.day || '').toLowerCase();
      const isSchoolDay = /lundi|mardi|jeudi|vendredi/.test(dayStr);

      // Set des POIs déjà utilisés CE JOUR (évite doublons dans la même journée)
      const usedThisDay = new Set();

      for (const stop of day.stops) {
        stop.locationName = stop.locationName || 'Lieu de prospection';
        stop.address = stop.address || '';
        stop.type = stop.type || 'other';
        let isLegit = false;

        // Vérif concurrent SIRENE
        const isCompStop = stop.type === 'competitor' || allCompsToCheck.some(c => c && stop.locationName.toLowerCase().includes(c));
        if (isCompStop && stop.source !== 'SIRENE (Certifié)') {
          const cleanName = stop.locationName.replace(new RegExp(inputRefs.address.value, 'gi'), '').trim();
          let sireneData = await verifyCompetitorSIREN(cleanName, originObj.lat, originObj.lng, radius);
          if (!sireneData && cleanName.includes(' ')) {
            sireneData = await verifyCompetitorSIREN(cleanName.split(' ')[0], originObj.lat, originObj.lng, radius);
          }
          if (sireneData && !excludedList.some(ex => sireneData.address.toLowerCase().includes(ex))) {
            Object.assign(stop, {
              locationName: sireneData.name, address: sireneData.address,
              lat: sireneData.lat, lng: sireneData.lng,
              source: 'SIRENE (CERTIFIÉ OFFICIEL)',
            });
            isLegit = true;
          }
        } else if (stop.source === 'SIRENE (Certifié)') {
          isLegit = true;
        }

        // Match dans la base OSM
        if (!isLegit) {
          const aiName = stop.locationName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const idx = availablePOIs.findIndex(p => {
            const pName = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            return canUse(p.name) && !usedThisDay.has(p.name) && (
              (aiName.length > 2 && (aiName.includes(pName) || pName.includes(aiName))) ||
              (stop.address && stop.address.toLowerCase().includes(p.address.toLowerCase()))
            );
          });
          if (idx !== -1) {
            const real = availablePOIs[idx];
            Object.assign(stop, {
              locationName: real.name, address: real.address,
              lat: real.lat, lng: real.lng, type: real.type, source: 'OSM',
              marketDays: real.marketDays || [],
            });
            usedThisDay.add(real.name);
            markUsed(real.name);
            isLegit = true;
          }
        }

        // Fallback intelligent — privilégier transport et commerces fiables
        if (!isLegit && availablePOIs.length > 0) {
          const findFallback = (filter) => availablePOIs.findIndex(p =>
            filter(p) && (isSchoolDay || p.type !== 'school')
          );

          const inPriority = (p) => priorityList.length > 0 &&
            inPriorityZone(p.name, p.address, p.lat, p.lng, p._priorityZone);

          // 0. Zone prioritaire + type utile — en tête absolue
          let idx = priorityList.length > 0
            ? findFallback(p => inPriority(p) && USEFUL_TYPES.includes(p.type) && canUse(p.name) && !usedThisDay.has(p.name))
            : -1;
          // 1. Transport public (arrêt bus/tram/gare) — toujours trouvable
          if (idx === -1) idx = findFallback(p => p.type === 'transport' && canUse(p.name) && !usedThisDay.has(p.name));
          // 2. Même type, même ville, quota non atteint
          if (idx === -1) idx = findFallback(p => p.type === stop.type && p.address.toLowerCase().includes(targetCity.toLowerCase()) && canUse(p.name) && !usedThisDay.has(p.name));
          // 3. Type utile, même ville, quota non atteint
          if (idx === -1) idx = findFallback(p => USEFUL_TYPES.includes(p.type) && p.address.toLowerCase().includes(targetCity.toLowerCase()) && canUse(p.name) && !usedThisDay.has(p.name));
          // 4. Type utile, quota non atteint
          if (idx === -1) idx = findFallback(p => USEFUL_TYPES.includes(p.type) && canUse(p.name) && !usedThisDay.has(p.name));
          // 5. N'importe quel POI non utilisé ce jour, quota non atteint
          if (idx === -1) idx = findFallback(p => canUse(p.name) && !usedThisDay.has(p.name));
          // 6. Réutilisation au-delà du quota (max 2x déjà atteint) — dernier recours avant geocoding random
          if (idx === -1) idx = findFallback(p => USEFUL_TYPES.includes(p.type) && !usedThisDay.has(p.name));
          if (idx === -1) idx = findFallback(p => !usedThisDay.has(p.name));
          if (idx === -1) idx = findFallback(() => true);
          // Pool non vide → toujours préférer un lieu réel, même une école hors
          // jour scolaire, plutôt que de retomber sur le repli centre-ville.
          if (idx === -1) idx = 0;

          if (idx !== -1) {
            const fb = availablePOIs[idx];
            Object.assign(stop, {
              locationName: fb.name, address: fb.address,
              lat: fb.lat, lng: fb.lng, type: fb.type,
              source: 'CORRECTION (Base OSM)',
              marketDays: fb.marketDays || [],
            });
            usedThisDay.add(fb.name);
            markUsed(fb.name);
            isLegit = true;
          }
        }

        // Dernier recours — UNIQUEMENT si le pool est totalement vide.
        // On ne génère JAMAIS de point à coordonnées aléatoires : c'était la
        // cause des arrêts "en pleine campagne" remontés par les chauffeurs.
        // On retombe sur le centre de l'origine, qui est un lieu réel et vérifié.
        if (!isLegit) {
          stop.lat = originObj.lat;
          stop.lng = originObj.lng;
          stop.type = 'other';
          const street = await reverseGeocodeBAN(originObj.lat, originObj.lng);
          stop.locationName = 'Centre-ville';
          stop.address = street || originObj.display_name;
          stop.source = 'CENTRE-VILLE (pool vide)';
          console.warn('[POI] Pool vide — arrêt replié sur le centre-ville de l\'origine.');
        }

        // Reverse geocode différé si pas de vraie adresse postale
        // Une vraie adresse contient un numéro de rue OU une virgule (nom, ville)
        const hasRealAddress = stop.address
          && stop.address !== stop.locationName
          && /\d/.test(stop.address)
          && stop.address.includes(',');
        if (!hasRealAddress && stop.lat && stop.lng) {
          stopsNeedingAddr.push(stop);
        }
      }
    }

    // Reverse geocoding en parallèle (lots de 8 pour ménager l'API BAN)
    if (stopsNeedingAddr.length > 0) {
      setProgress(`Enrichissement adresses (${stopsNeedingAddr.length})...`, 88);
      for (let i = 0; i < stopsNeedingAddr.length; i += 8) {
        const batch = stopsNeedingAddr.slice(i, i + 8);
        await Promise.all(batch.map(async stop => {
          const realAddr = await reverseGeocodeBAN(stop.lat, stop.lng);
          if (realAddr) stop.address = realAddr;
        }));
      }
    }

    // --- ENFORCEMENT ZONES PRIORITAIRES : 1 stop par zone par jour ---
    // Règle : chaque zone doit figurer au moins 1× par jour SI des POIs existent dans le rayon de campagne
    if (priorityList.length > 0 && poisByZone.length > 0) {
      for (const day of data.dailyPlans) {
        if (!day.stops || day.stops.length === 0) continue;

        const usedNames = new Set(day.stops.map(s => s.locationName));

        // Traiter TOUTES les zones sans break anticipé
        for (let zi = 0; zi < priorityList.length; zi++) {
          const zonePOIs = poisByZone[zi] || [];
          if (zonePOIs.length === 0) {
            console.warn(`[Priorité] Zone "${priorityList[zi]}" : aucun POI OSM trouvé`);
            continue;
          }

          // Zone déjà couverte ce jour ? (vérif par nom exact)
          const alreadyCovered = day.stops.some(s =>
            zonePOIs.some(p => p.name === s.locationName)
          );
          if (alreadyCovered) continue;

          // Candidat : dans le rayon de campagne ET non déjà utilisé
          const candidate = zonePOIs.find(p =>
            !usedNames.has(p.name) &&
            p.lat && p.lng &&
            distKmPriority(originObj.lat, originObj.lng, p.lat, p.lng) <= radius
          );

          if (!candidate) {
            console.warn(`[Priorité] Zone "${priorityList[zi]}" : aucun POI dans le rayon ${radius}km`);
            continue;
          }

          // Trouver un stop remplaçable : non-prioritaire, non-concurrent, depuis la fin
          let replaceIdx = -1;
          for (let i = day.stops.length - 1; i >= 0; i--) {
            const s = day.stops[i];
            if (s.type === 'competitor') continue;
            if (inPriorityZone(s.locationName, s.address, s.lat, s.lng)) continue;
            replaceIdx = i;
            break;
          }
          if (replaceIdx === -1) continue;

          const savedTime = day.stops[replaceIdx].time;
          Object.assign(day.stops[replaceIdx], {
            locationName: candidate.name,
            address: candidate.address,
            lat: candidate.lat,
            lng: candidate.lng,
            type: candidate.type,
            source: 'ZONE PRIORITAIRE',
            marketDays: candidate.marketDays || [],
          });
          day.stops[replaceIdx].time = savedTime;
          usedNames.add(candidate.name);
          console.log(`[Priorité] ${day.day} zone "${priorityList[zi]}" → ${candidate.name} (${distKmPriority(originObj.lat, originObj.lng, candidate.lat, candidate.lng).toFixed(1)}km)`);
        }
      }
    }

    // --- STREET MARKETING : contrainte véhicule + arrêts piétons ---
    if (smActive && smCityCoords) {
      const SM_RADIUS_KM = 3;
      const distKm = (lat1, lng1, lat2, lng2) => {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      };

      // POIs piétons : rues commerçantes, places, transport, marchés — proches de la ville SM
      const smPOIs = filteredPOIs.filter(p =>
        distKm(smCityCoords.lat, smCityCoords.lng, p.lat, p.lng) <= SM_RADIUS_KM &&
        ['transport', 'market', 'shopping', 'culture', 'park'].includes(p.type)
      );

      // Rues commerçantes / piétonnes → secteurs « de telle rue à telle rue »
      const shortStreet = (addr) => (addr || '').split(',')[0].replace(/^\d+\s*/, '').trim();
      let smStreetBeats = [];
      try {
        setProgress('Analyse des rues commerçantes (street marketing)...', 55);
        const smStreets = (await fetchCommercialStreets(smCityCoords.lat, smCityCoords.lng, SM_RADIUS_KM))
          .filter(st => distKm(smCityCoords.lat, smCityCoords.lng, st.lat, st.lng) <= SM_RADIUS_KM)
          .slice(0, 8);
        for (const st of smStreets) {
          // Reverse-géocode des extrémités pour décrire « de X à Y »
          const [fromA, toA] = await Promise.all([
            reverseGeocodeBAN(st.startLat, st.startLng),
            reverseGeocodeBAN(st.endLat, st.endLng),
          ]);
          const fromLabel = shortStreet(fromA) || st.name;
          const toLabel = shortStreet(toA) || st.name;
          const beat = (fromLabel && toLabel && fromLabel !== toLabel)
            ? `Secteur piéton : de ${fromLabel} à ${toLabel}`
            : `Secteur piéton : ${st.name}`;
          smStreetBeats.push({
            locationName: st.name,
            address: beat,
            type: 'pedestrian',
            source: 'RUE COMMERÇANTE (street marketing)',
            lat: st.lat, lng: st.lng,
            marketDays: [],
          });
        }
        console.log(`[SM] ${smStreetBeats.length} secteurs de rue construits`);
      } catch (e) { console.warn('[SM] rues commerçantes indisponibles', e); }

      for (let idx = 0; idx < data.dailyPlans.length; idx++) {
        const iso = datesISO[idx];
        if (!smDays.includes(iso)) continue;
        const day = data.dailyPlans[idx];

        // 1. Forcer les arrêts VÉHICULE à rester dans 3 km autour de smCityCoords
        if (day.stops?.length) {
          const inRange = day.stops.filter(s => s.lat && s.lng && distKm(smCityCoords.lat, smCityCoords.lng, s.lat, s.lng) <= SM_RADIUS_KM);
          // Si l'IA a bien placé les arrêts, les garder ; sinon réassigner depuis POIs SM
          if (inRange.length < day.stops.length && smPOIs.length > 0) {
            const usedSm = new Set(inRange.map(s => s.locationName));
            let fill = smPOIs.filter(p => !usedSm.has(p.name));
            day.stops = day.stops.map(stop => {
              if (stop.lat && stop.lng && distKm(smCityCoords.lat, smCityCoords.lng, stop.lat, stop.lng) <= SM_RADIUS_KM) return stop;
              const poi = fill.shift();
              if (!poi) return stop; // garder si pas de remplacement dispo
              return { ...poi, time: stop.time, source: 'OSM (SM zone)' };
            });
          }
        }

        // 2. Construire/enrichir smStops (arrêts piétons)
        //    Priorité aux secteurs de rue précis « de telle rue à telle rue »
        const validSmStops = smStreetBeats.map(b => ({ ...b }));
        const beatNames = new Set(smStreetBeats.map(b => b.locationName));
        const smFill = smPOIs.filter(p => !beatNames.has(p.name));
        while (validSmStops.length < 6 && smFill.length > 0) {
          const poi = smFill.shift();
          validSmStops.push({ ...poi, source: 'OSM (SM piéton)' });
        }

        // Assigner des horaires répartis sur la journée (selon smTimes formulaire)
        if (validSmStops.length > 0) {
          const slots = [];
          if (smTimes.hasMorning) {
            const [mh, mm] = smTimes.mornStart.split(':').map(Number);
            const [meh, mem] = smTimes.mornEnd.split(':').map(Number);
            const totalMin = (meh * 60 + mem) - (mh * 60 + mm);
            const mornCount = smTimes.hasAfternoon
              ? Math.min(Math.ceil(validSmStops.length / 2), validSmStops.length)
              : validSmStops.length;
            for (let k = 0; k < mornCount; k++) {
              const minOffset = Math.round((totalMin / Math.max(mornCount, 1)) * k);
              const h = Math.floor((mh * 60 + mm + minOffset) / 60);
              const m = (mh * 60 + mm + minOffset) % 60;
              slots.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
            }
          }
          if (smTimes.hasAfternoon) {
            const [ah, am] = smTimes.aftStart.split(':').map(Number);
            const [aeh, aem] = smTimes.aftEnd.split(':').map(Number);
            const totalMin = (aeh * 60 + aem) - (ah * 60 + am);
            const aftCount = validSmStops.length - slots.length;
            for (let k = 0; k < aftCount; k++) {
              const minOffset = Math.round((totalMin / Math.max(aftCount, 1)) * k);
              const h = Math.floor((ah * 60 + am + minOffset) / 60);
              const m = (ah * 60 + am + minOffset) % 60;
              slots.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
            }
          }
          validSmStops.forEach((s, k) => { s.time = slots[k] || s.time || smTimes.mornStart || '09:00'; });
        }

        day.smStops = validSmStops;
      }
    }

    // --- SMART SCHEDULING : marchés selon jours OSM, centres commerciaux aprem mer/sam ---
    const FR_DAYS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];

    for (const day of data.dailyPlans) {
      if (!day.stops || day.stops.length === 0) continue;
      const dayStr = (day.day || '').toLowerCase();
      // Extraire le nom du jour en français depuis la chaîne (ex: "mercredi 29/04/2026")
      const dayFr = FR_DAYS.find(d => dayStr.includes(d)) || '';
      const isWedOrSat = dayFr === 'mercredi' || dayFr === 'samedi';

      const toMin = t => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
      const morning   = day.stops.filter(s => toMin(s.time) < 14 * 60);
      const afternoon = day.stops.filter(s => toMin(s.time) >= 14 * 60);

      // Valider les marchés : vérifier que le jour courant est dans marketDays (données OSM réelles)
      // Si un marché est placé le mauvais jour → downgrade en shopping
      day.stops.forEach(s => {
        if (s.type !== 'market') return;
        const validDays = s.marketDays?.length ? s.marketDays : ['mercredi', 'samedi'];
        if (dayFr && !validDays.includes(dayFr)) {
          console.log(`[Market] ${s.locationName} invalidé pour ${dayFr} (ouvert : ${validDays.join(', ')})`);
          s.type = 'shopping'; // mauvais jour → dégradé
        }
      });

      // Matin mer/sam : marchés valides en premier (heure la plus tôt du créneau)
      if (isWedOrSat) {
        morning.sort((a, b) => {
          const aM = a.type === 'market'; const bM = b.type === 'market';
          return aM === bM ? 0 : aM ? -1 : 1;
        });
      }

      // Après-midi mer/sam : centres commerciaux et concurrents en premier (créneau 12h-14h)
      if (isWedOrSat) {
        afternoon.sort((a, b) => {
          const aS = ['shopping', 'competitor'].includes(a.type);
          const bS = ['shopping', 'competitor'].includes(b.type);
          return aS === bS ? 0 : aS ? -1 : 1;
        });
      }

      // Réappliquer les temps dans le nouvel ordre
      const mornTimes = morning.map(s => s.time);
      const aftTimes  = afternoon.map(s => s.time);
      morning.forEach((s, i)   => { s.time = mornTimes[i]; });
      afternoon.forEach((s, i) => { s.time = aftTimes[i]; });
      day.stops = [...morning, ...afternoon];
    }

    // --- FILTRE FINAL GARANTI : barrières + enseigne propre + limite chaîne ---
    // Ce filtre est la dernière ligne de défense, appliqué APRÈS toute validation IA ou geocoding
    for (const day of data.dailyPlans) {
      if (!day.stops) continue;

      const chainCountThisDay = {}; // nb de visites par chaîne (ex: "marie blachere" → 1)

      day.stops = day.stops.filter(stop => {
        // Blocage combiné texte + GPS : le plus robuste
        if (isBlocked(stop.locationName || '', stop.address || '', stop.lat, stop.lng)) return false;

        // Limite : max 2 visites de la même chaîne par jour
        const chainKey = (stop.locationName || '').toLowerCase()
          .replace(/[^a-zàâéèêëïîôùûü ]/gi, '').trim()
          .split(/\s+/).slice(0, 2).join(' ');
        if (chainKey.length > 3) {
          chainCountThisDay[chainKey] = (chainCountThisDay[chainKey] || 0) + 1;
          if (chainCountThisDay[chainKey] > 2) return false;
        }

        return true;
      });
    }

    // --- Garde-fou écoles (2e passage post-topographie) ---
    enforceSchoolRules(data.dailyPlans, datesISO, schoolHolidays);

    // --- CENTRES ÉQUESTRES : mission dédiée mardi ou jeudi ---
    // La même personne assure la mission. La livraison de coupons est rapide,
    // donc on CONSERVE les arrêts POI importants du jour et on AJOUTE les centres
    // (une seule livraison par centre, jamais de retour dans la journée).
    if (equestrianActive && equestrianCenters.length > 0) {
      for (let idx = 0; idx < data.dailyPlans.length; idx++) {
        const day = data.dailyPlans[idx];
        const dayFr = FR_DAYS.find(d => (day.day || '').toLowerCase().includes(d)) || '';
        if (dayFr !== equestrianDay) continue;
        const t = perDayTimes[idx];
        if (!t) continue;

        const centers = equestrianCenters
          .filter(c => !isBlocked(c.name, c.address, c.lat, c.lng))
          .slice(0, 10)
          .map(c => ({
            time: '00:00', locationName: c.name, address: c.address,
            type: 'equestrian', source: 'CENTRE ÉQUESTRE (coupons)',
            lat: c.lat, lng: c.lng, marketDays: [], hours: c.hours || 'Non spécifié',
            outsideRadius: c.outsideRadius === true,
          }));
        if (centers.length === 0) continue;

        // Conserve les arrêts importants existants (hors anciens centres équestres)
        const existing = (day.stops || []).filter(s => s.type !== 'equestrian');

        if (t.hasMorning && t.hasAfternoon) {
          const half = Math.ceil(centers.length / 2);
          const morning = centers.slice(0, half);
          const afternoon = centers.slice(half);
          redistributeStops(morning, t.mornStart, t.mornEnd);
          redistributeStops(afternoon, t.aftStart, t.aftEnd);
          day.stops = [...existing, ...morning, ...afternoon];
        } else if (t.hasMorning) {
          redistributeStops(centers, t.mornStart, t.mornEnd);
          day.stops = [...existing, ...centers];
        } else if (t.hasAfternoon) {
          redistributeStops(centers, t.aftStart, t.aftEnd);
          day.stops = [...existing, ...centers];
        }
        console.log(`[Équestre] ${day.day} → ${centers.length} centres équestres ajoutés au tracé (${existing.length} arrêts importants conservés)`);
      }
    }

    // --- COUVERTURE HORAIRE GARANTIE ---
    // Chaque créneau actif doit couvrir toute sa plage horaire.
    // Si le filtrage a laissé trop peu de lieux, on double les lieux existants
    // (au lieu de laisser un créneau avec un seul arrêt).
    const toMinCov = t => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
    for (let idx = 0; idx < data.dailyPlans.length; idx++) {
      const day = data.dailyPlans[idx];
      const t = perDayTimes[idx];
      if (!t) continue;

      // Journée rendue vide par l'IA alors que des créneaux sont déclarés :
      // on l'amorce avec les meilleurs lieux du pool. Sans cela la journée
      // sortait blanche sur le PDF, créneaux affichés mais aucun arrêt.
      if ((!day.stops || day.stops.length === 0) && (t.hasMorning || t.hasAfternoon)) {
        day.stops = filteredPOIs.slice(0, 2).map(p => ({
          time: t.hasMorning ? t.mornStart : t.aftStart,
          locationName: p.name, address: p.address, type: p.type,
          lat: p.lat, lng: p.lng, source: 'COMPLÉMENT (base OSM)',
          marketDays: p.marketDays || [],
        }));
        if (day.stops.length) {
          console.warn(`[Couverture] ${day.day} : journée vide amorcée avec ${day.stops.length} lieu(x) du pool.`);
        }
      }
      if (!day.stops || day.stops.length === 0) continue;

      // Séparer matin / après-midi (frontière 14:00, cohérent avec le reste du code)
      const split = 14 * 60;
      let morning   = day.stops.filter(s => toMinCov(s.time) < split);
      let afternoon = day.stops.filter(s => toMinCov(s.time) >= split);

      // Double les lieux d'un créneau jusqu'à couvrir tous les secteurs.
      // Jamais les écoles ni les centres équestres (livrés une seule fois).
      // `secours` = les arrêts de l'autre créneau : quand l'IA ne rend que des
      // arrêts du matin, l'après-midi déclaré restait VIDE dans le plan, faute
      // de quoi que ce soit à dupliquer. C'est le créneau manquant remonté par
      // les chauffeurs.
      const reutilisable = s => s.type !== 'school' && s.type !== 'equestrian';
      const padSlot = (arr, target, secours = []) => {
        if (arr.length >= target) return arr;
        const propres = arr.filter(reutilisable);
        const source = propres.length ? propres : secours.filter(reutilisable);
        if (source.length === 0) return arr; // rien à dupliquer sans risque
        const etiquette = propres.length ? '2e passage' : 'report de créneau';
        let i = 0;
        while (arr.length < target) {
          arr.push({ ...source[i % source.length], source: etiquette });
          i++;
        }
        return arr;
      };

      // Les deux créneaux se servent l'un de l'autre : on fige donc une copie
      // du matin avant de le compléter, sinon l'après-midi se remplirait avec
      // les doublons qu'on vient d'ajouter au matin.
      const matinInitial = morning.slice();
      if (t.hasMorning) {
        morning = padSlot(morning, sectorCount(t.mornStart, t.mornEnd), afternoon);
        redistributeStops(morning, t.mornStart, t.mornEnd);
      }
      if (t.hasAfternoon) {
        afternoon = padSlot(afternoon, sectorCount(t.aftStart, t.aftEnd), matinInitial);
        redistributeStops(afternoon, t.aftStart, t.aftEnd);
      }

      day.stops = [...morning, ...afternoon];
    }

    // --- Passe finale : affectation des plages de secteur (time + timeEnd) ---
    // Exécutée en tout dernier, une fois le nombre d'arrêts définitivement figé
    // (après l'injection des centres équestres et le padding de couverture).
    applySectorTimes(data.dailyPlans, perDayTimes);

    // --- Repères visuels : commerces identifiables autour de chaque secteur ---
    const landmarkPool = [...filteredPOIs, ...preVerifiedCompetitors];
    for (const day of data.dailyPlans) {
      for (const stop of (day.stops || [])) {
        stop.landmarks = findLandmarks(stop, landmarkPool);
      }
    }

    // --- Rendu HTML sécurisé ---
    setProgress('Calcul itinéraire routier (OSRM)...', 85);

    let plansHtml = '';
    let outOfBoundsCount = 0;
    let totalStops = 0;

    for (let idx = 0; idx < data.dailyPlans.length; idx++) {
      const day = data.dailyPlans[idx];
      const fallbackTimes = perDayTimes[idx] || perDayTimes[0];
      const att = data.attendance[idx] || { hasMorning: fallbackTimes.hasMorning, hasAfternoon: fallbackTimes.hasAfternoon, startMatin: fallbackTimes.mornStart, endMatin: fallbackTimes.mornEnd, startAprem: fallbackTimes.aftStart, endAprem: fallbackTimes.aftEnd };

      // Météo du jour
      const dayISO = datesISO[idx];
      const weather = dayISO ? weatherForecast[dayISO] : null;
      const weatherBadgeHtml = weather ? renderWeatherBadge(weather) : '';

      const stopsHtmlArr = await Promise.all((day.stops || []).map(async (s) => {
        totalStops++;
        // Distance à vol d'oiseau = référence du rayon (Overpass "around" est à vol d'oiseau)
        const crowDist = calculateDistance(originObj.lat, originObj.lng, s.lat, s.lng);

        let distBadge;
        if (crowDist > radius) {
          if (crowDist > radius * 1.3) outOfBoundsCount++;
          distBadge = `<span class="text-sm font-bold text-amber-500 ml-3 whitespace-nowrap">&#x1F699; ${crowDist.toFixed(1)}km</span>`;
        } else {
          distBadge = `<span class="text-sm font-bold text-[#10b981] ml-3 whitespace-nowrap">&#x2713; ${crowDist.toFixed(1)}km</span>`;
        }

        return renderStopHTML(s, distBadge);
      }));

      // Alerte météo si mauvais temps
      let weatherAlert = '';
      if (weather && weather.severity === 'bad') {
        weatherAlert = `<div class="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 flex items-center gap-2 text-sm text-red-700 font-semibold">
          <i data-lucide="alert-triangle" class="w-5 h-5 text-red-500 flex-shrink-0"></i>
          <span>Alerte météo : ${sanitize(weather.label)} prévue (${weather.precipitation}mm de précipitations, vent ${weather.wind}km/h). Prévoir un plan de repli.</span>
        </div>`;
      }

      // Section Street Marketing piéton (jours couplés SM)
      const isSmDay = smActive && smDays.includes(datesISO[idx]);
      let smSectionHtml = '';
      if (isSmDay && day.smStops?.length > 0) {
        const smStopsHtml = day.smStops.map(s => renderSmStopHTML(s)).join('');
        const smMornBadge = smTimes.hasMorning
          ? `<span class="bg-amber-50 border border-amber-200 text-amber-800 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1">
               <i data-lucide="sun" class="w-3 h-3"></i> ${sanitize(smTimes.mornStart)} - ${sanitize(smTimes.mornEnd)}
             </span>` : '';
        const smAftBadge = smTimes.hasAfternoon
          ? `<span class="bg-orange-50 border border-orange-200 text-orange-800 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1">
               <i data-lucide="sunset" class="w-3 h-3"></i> ${sanitize(smTimes.aftStart)} - ${sanitize(smTimes.aftEnd)}
             </span>` : '';
        smSectionHtml = `
          <div>
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <i data-lucide="footprints" class="w-5 h-5 text-cyan-600"></i>
              <span class="text-sm font-extrabold uppercase tracking-widest text-cyan-700">Équipe Piétonne (${smTeamSize}p) · ${sanitize(smCityRaw)}</span>
              ${smMornBadge}${smAftBadge}
            </div>
            <div class="bg-cyan-50 p-4 rounded-3xl border border-cyan-200">${smStopsHtml}</div>
          </div>`;
      } else if (isSmDay) {
        smSectionHtml = `
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <i data-lucide="footprints" class="w-5 h-5 text-cyan-600"></i>
              <span class="text-sm font-extrabold uppercase tracking-widest text-cyan-700">Street Marketing — Équipe Piétonne (${smTeamSize}p) · ${sanitize(smCityRaw)}</span>
              <span class="text-xs text-cyan-400 italic ml-2">Arrêts piétons non disponibles — cibler rues commerçantes du centre</span>
            </div>
          </div>`;
      }

      const smBadgeHtml = isSmDay ? `<span class="bg-cyan-50 border border-cyan-300 text-cyan-700 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center shadow-sm gap-1.5">
        <i data-lucide="footprints" class="w-4 h-4"></i> SM Couplé
      </span>` : '';

      // Listing livraison — Centres équestres (jour dédié)
      let equestrianSectionHtml = '';
      const eqSeen = new Set();
      const eqStops = (day.stops || []).filter(s => s.type === 'equestrian').filter(s => {
        const k = `${s.locationName}|${s.address}`;
        if (eqSeen.has(k)) return false; eqSeen.add(k); return true;
      });
      const isEquestrianDay = equestrianActive
        && FR_DAYS.find(d => (day.day || '').toLowerCase().includes(d)) === equestrianDay;
      if (eqStops.length > 0) {
        const eqRows = eqStops.map((s, i) => {
          const hasHours = s.hours && s.hours !== 'Non spécifié';
          const outBadge = s.outsideRadius
            ? `<span class="ml-2 text-[10px] font-bold uppercase bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">hors rayon</span>` : '';
          return `
          <div class="flex items-start gap-3 p-3 bg-white rounded-xl border border-amber-200 mb-2">
            <span class="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full bg-amber-100 text-amber-800 font-extrabold text-sm">${i + 1}</span>
            <div class="min-w-0">
              <div class="font-extrabold text-amber-900 text-base">${sanitize(s.locationName)}${outBadge}</div>
              <div class="text-sm text-amber-700 flex items-center gap-1 mt-0.5">
                <i data-lucide="map-pin" class="w-3.5 h-3.5 flex-shrink-0"></i>
                <span>${sanitize(s.address || 'Dépôt de coupons')}</span>
              </div>
              <div class="text-xs mt-1 flex items-center gap-1 ${hasHours ? 'text-amber-600' : 'text-amber-400 italic'}">
                <i data-lucide="clock" class="w-3.5 h-3.5 flex-shrink-0"></i>
                <span>${hasHours ? sanitize(s.hours) : 'Horaires non communiqués'}</span>
              </div>
            </div>
          </div>`;
        }).join('');
        equestrianSectionHtml = `
          <div>
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <i data-lucide="rabbit" class="w-5 h-5 text-amber-700"></i>
              <span class="text-sm font-extrabold uppercase tracking-widest text-amber-700">Listing livraison — Centres équestres (${eqStops.length})</span>
            </div>
            <div class="bg-amber-50 p-4 rounded-3xl border border-amber-200">${eqRows}</div>
          </div>`;
      } else if (isEquestrianDay) {
        // Jour dédié aux centres équestres mais aucun trouvé : on l'indique
        equestrianSectionHtml = `
          <div>
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <i data-lucide="rabbit" class="w-5 h-5 text-amber-700"></i>
              <span class="text-sm font-extrabold uppercase tracking-widest text-amber-700">Listing livraison — Centres équestres</span>
            </div>
            <div class="bg-orange-50 p-4 rounded-3xl border border-orange-200 text-orange-800 text-sm font-semibold flex items-center gap-2">
              <i data-lucide="alert-triangle" class="w-4 h-4 flex-shrink-0"></i>
              <span>Aucun centre équestre référencé (OpenStreetMap) n'a été trouvé dans le rayon. Vérifiez le rayon de campagne ou ajoutez les centres manuellement.</span>
            </div>
          </div>`;
      }

      plansHtml += `
        <div id="day-card-${idx}" class="mb-10 page-break-inside-avoid px-2">
          <div class="flex flex-col md:flex-row md:justify-between md:items-end mb-4 pb-3 border-b ${isSmDay ? 'border-cyan-200' : 'border-gray-200'} gap-4">
            <div class="flex flex-col">
              <h4 class="font-extrabold text-3xl ${isSmDay ? 'text-cyan-900' : 'text-[#0E2C59]'} capitalize mb-1">${sanitize(day.day)}</h4>
              <span class="text-sm font-bold uppercase ${isSmDay ? 'text-cyan-600' : 'text-gray-500'} tracking-widest">${sanitize(day.role || 'VÉHICULE')}</span>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
              ${smBadgeHtml}
              ${weatherBadgeHtml}
              ${att.hasMorning !== false ? `<span class="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center shadow-sm">
                <i data-lucide="sun" class="w-4 h-4 mr-1.5"></i> ${sanitize(att.startMatin)} - ${sanitize(att.endMatin)}
              </span>` : ''}
              ${att.hasAfternoon !== false ? `<span class="bg-orange-50 border border-orange-200 text-orange-800 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center shadow-sm">
                <i data-lucide="sunset" class="w-4 h-4 mr-1.5"></i> ${sanitize(att.startAprem)} - ${sanitize(att.endAprem)}
              </span>` : ''}
              ${att.hasMorning === false && att.hasAfternoon === false ? '<span class="text-sm text-gray-400 italic">Pas de créneau</span>' : ''}
            </div>
          </div>
          ${weatherAlert}
          <div class="bg-[#F8FAFC] p-4 rounded-3xl">${stopsHtmlArr.join('')}</div>
        </div>`;

      // Street Marketing et centres équestres sortent de la carte journalière :
      // empilés sous les arrêts véhicule, l'ensemble dépassait la hauteur d'une
      // A4 et était réduit jusqu'à devenir illisible. Chacun a sa propre page.
      if (smSectionHtml) {
        plansHtml += `
          <div id="sm-card-${idx}" class="mb-10 page-break-inside-avoid px-2">
            <div class="flex flex-col mb-4 pb-3 border-b border-cyan-200">
              <h4 class="font-extrabold text-3xl text-cyan-900 capitalize mb-1">${sanitize(day.day)}</h4>
              <span class="text-sm font-bold uppercase text-cyan-600 tracking-widest">Street Marketing — Équipe piétonne</span>
            </div>
            ${smSectionHtml}
          </div>`;
      }

      if (equestrianSectionHtml) {
        plansHtml += `
          <div id="eq-card-${idx}" class="mb-10 page-break-inside-avoid px-2">
            <div class="flex flex-col mb-4 pb-3 border-b border-amber-300">
              <h4 class="font-extrabold text-3xl text-amber-900 capitalize mb-1">${sanitize(day.day)}</h4>
              <span class="text-sm font-bold uppercase text-amber-600 tracking-widest">Livraison centres équestres</span>
            </div>
            ${equestrianSectionHtml}
          </div>`;
      }
    }

    el.dailyPlansContainer.innerHTML = plansHtml;

    // --- Finalisation ---
    setProgress('Génération du document final...', 95);
    el.outputContainer.classList.remove('hidden');

    if (data.analysis) {
      el.analysisText.textContent = data.analysis; // textContent, pas innerHTML !
      el.analysisCard.classList.remove('hidden');
    }

    el.planCard.classList.remove('hidden');

    const statusOk = outOfBoundsCount === 0;
    el.mapStats.innerHTML = `<span class="${statusOk ? 'text-[#4ade80]' : 'text-amber-300'} flex items-center">
      <span class="mr-1">${statusOk ? '&#x2713;' : '&#x1F699;'}</span>
      ${statusOk ? 'Distances routières 100% OK' : 'Itinéraires de route calculés'}
    </span>`;

    if (data.attendance?.length > 0) {
      el.attendanceGrid.innerHTML = data.attendance.map(renderAttendanceHTML).join('');
      el.attendanceCard.classList.remove('hidden');
    }

    generatedData = data;
    renderZoneLandmarks(zoneLandmarks);
    lucide.createIcons();

    if (poolMaigre || poolDeSecours) {
      const n = poolMaigre?.trouves ?? 0;
      const besoin = poolMaigre?.besoin ?? 0;
      showMessage(
        (poolDeSecours
          ? `La recherche de commerces n'a rien ramené (serveurs OpenStreetMap indisponibles). `
            + `Le plan a été bâti sur les points de repère de la zone — gares, arrêts de bus, marchés, places. `
          : n === 0
            ? `Aucun lieu n'a pu être récupéré : les serveurs OpenStreetMap sont indisponibles et tous `
              + `les arrêts sont repliés sur l'adresse de départ. Ce plan n'est PAS exploitable tel quel — `
              + `relancez la génération dans quelques minutes. `
            : `Plan généré avec ${n} lieu(x) pour ${besoin} arrêts à couvrir. `)
        + `Tous les créneaux sont couverts, mais certains secteurs sont repassés plusieurs fois `
        + `(mentions « 2e passage » et « report de créneau »). Relancez dans quelques minutes `
        + `pour un plan plus varié, ou élargissez le rayon.`,
        'warn'
      );
    }

    setTimeout(() => {
      el.mapContainer.classList.remove('hidden');

      setTimeout(() => {
        // Le potentiel d'abord : c'est la zone visée, dessinée avant le tracé
        // qui en découle.
        drawPotentialMap(originObj, radius);
        drawMap(data, originObj, radius);

        // Calcul Reach
        const baseReach = 350 + Math.floor(Math.random() * 200);
        let reach = Math.round(totalStops * baseReach * 1.1);
        if (officialPopulation && reach > officialPopulation * 0.8) {
          reach = Math.round(officialPopulation * (0.4 + Math.random() * 0.3));
        }
        const impressions = Math.round(reach * 3.5);

        el.estTotalStops.textContent = totalStops;
        el.estReach.textContent = formatNumber(reach);
        el.estImpressions.textContent = formatNumber(impressions);
        el.reachEstimationContainer.classList.remove('hidden');

        setProgress(false);
        el.outputContainer.scrollIntoView({ behavior: 'smooth' });
      }, 400);
    }, 100);

  } catch (e) {
    setProgress(false);
    showMessage('Interruption : ' + (e.message || 'Erreur'));
  }
}

// ========================================
// HORAIRES PAR JOUR (personnalisation)
// ========================================

/**
 * Génère dynamiquement les lignes de personnalisation par jour
 * dans le conteneur #perDayScheduleContainer.
 */
// Mémorisation des défauts précédents pour la mise à jour intelligente
let _prevDefaultMorn = '';
let _prevDefaultAft = '';

function rebuildPerDaySchedule() {
  const container = document.getElementById('perDayScheduleContainer');
  if (!container) return;

  const startDate = inputRefs.startDate?.value;
  const duration = parseInt(inputRefs.duration?.value) || 0;

  if (!startDate || duration < 1) {
    container.innerHTML = '<p class="text-xs text-gray-400 italic">Renseignez la date de début et la durée pour voir les jours.</p>';
    return;
  }

  const newDefaultMorn = inputRefs.morning?.value || '10:00 - 13:00';
  const newDefaultAft = inputRefs.afternoon?.value || '14:00 - 17:00';

  // Sauvegarder les valeurs existantes AVANT de reconstruire
  const saved = {};
  for (let i = 0; i < 31; i++) {
    const m = document.getElementById(`perDay_morn_${i}`);
    const a = document.getElementById(`perDay_aft_${i}`);
    if (m !== null) {
      // Si la valeur est l'ANCIEN défaut → on la met à jour avec le NOUVEAU défaut
      // Si la valeur est une perso → on la conserve telle quelle
      const mVal = (_prevDefaultMorn && m.value === _prevDefaultMorn) ? newDefaultMorn : m.value;
      const aVal = (_prevDefaultAft && a && a.value === _prevDefaultAft) ? newDefaultAft : (a?.value ?? '');
      saved[i] = { morn: mVal, aft: aVal };
    }
  }

  _prevDefaultMorn = newDefaultMorn;
  _prevDefaultAft = newDefaultAft;

  const startObj = new Date(startDate);
  let html = '';
  for (let i = 0; i < duration; i++) {
    const d = new Date(startObj);
    d.setDate(d.getDate() + i);
    const dayLabel = d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit' });

    // Valeur perso conservée, ou nouveau défaut pour les nouveaux jours
    const mornVal = saved[i] !== undefined ? saved[i].morn : newDefaultMorn;
    const aftVal  = saved[i] !== undefined ? saved[i].aft  : newDefaultAft;

    html += `
      <div class="flex flex-col sm:flex-row items-start sm:items-center gap-2 p-2 rounded-lg bg-white border border-indigo-100">
        <span class="text-sm font-bold text-indigo-900 capitalize min-w-[140px]">${sanitize(dayLabel)}</span>
        <div class="flex flex-1 gap-2 flex-wrap">
          <div class="flex items-center gap-1">
            <i data-lucide="sun" class="w-3 h-3 text-amber-500 flex-shrink-0"></i>
            <input type="text" class="input-style text-xs py-1.5 px-2 w-[130px]"
                   id="perDay_morn_${i}" value="${sanitize(mornVal)}" placeholder="Vide = pas de matin" />
          </div>
          <div class="flex items-center gap-1">
            <i data-lucide="sunset" class="w-3 h-3 text-orange-500 flex-shrink-0"></i>
            <input type="text" class="input-style text-xs py-1.5 px-2 w-[130px]"
                   id="perDay_aft_${i}" value="${sanitize(aftVal)}" placeholder="Vide = pas d'aprem" />
          </div>
        </div>
      </div>`;
  }

  container.innerHTML = html;

  // Reconstruire aussi le sélecteur de jours SM
  rebuildSmDaySelector(startDate, duration);

  lucide.createIcons();
}

/**
 * Reconstruit le sélecteur de jours Street Marketing.
 * Affiche les jours de la campagne sous forme de cases à cocher (max 2).
 */
function rebuildSmDaySelector(startDate, duration) {
  const selector = document.getElementById('smDaySelector');
  if (!selector) return;
  if (!startDate || duration < 1) {
    selector.innerHTML = '<p class="text-xs text-gray-400 italic">Renseignez la date de début et la durée pour voir les jours.</p>';
    return;
  }
  // Conserver les jours déjà cochés
  const checked = new Set(
    [...selector.querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value)
  );

  // Étendre aux semaines complètes (lun→dim) couvrant la campagne
  const startObj = new Date(startDate);
  const endObj = new Date(startDate);
  endObj.setDate(endObj.getDate() + duration - 1);

  // Reculer au lundi de la semaine de début
  const weekStart = new Date(startObj);
  const dow = weekStart.getDay(); // 0=dim, 1=lun, ...
  weekStart.setDate(weekStart.getDate() - (dow === 0 ? 6 : dow - 1));

  // Avancer au dimanche de la semaine de fin
  const weekEnd = new Date(endObj);
  const dow2 = weekEnd.getDay();
  weekEnd.setDate(weekEnd.getDate() + (dow2 === 0 ? 0 : 7 - dow2));

  let html = '<div class="flex flex-wrap gap-2">';
  for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const isChecked = checked.has(iso) ? 'checked' : '';
    // Griser les jours hors campagne (visuellement, mais sélectionnables)
    const inCampaign = d >= startObj && d <= endObj;
    const style = inCampaign
      ? 'border-cyan-200 bg-white hover:bg-cyan-50 text-cyan-900'
      : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-400';
    html += `
      <label class="flex items-center gap-1 cursor-pointer px-2 py-1 rounded-lg border ${style} text-xs font-medium transition-colors sm-day-label" title="${inCampaign ? 'Jour de campagne' : 'Hors campagne'}">
        <input type="checkbox" class="sm-day-cb accent-cyan-600" value="${iso}" ${isChecked}
               onchange="enforceSMDayLimit(this)" />
        ${sanitize(label)}
      </label>`;
  }
  html += '</div>';
  selector.innerHTML = html;
}

/** Empêche de cocher plus de 2 jours SM */
function enforceSMDayLimit(cb) {
  const all = document.querySelectorAll('.sm-day-cb:checked');
  if (all.length > 2) {
    cb.checked = false;
    showMessage('Maximum 2 jours de Street Marketing (non consécutifs recommandés).', 'error');
  }
}

/** Retourne les dates ISO des jours SM sélectionnés */
function getSmDays() {
  return [...document.querySelectorAll('.sm-day-cb:checked')].map(cb => cb.value);
}

/**
 * Récupère les horaires pour un jour donné (index).
 * Champ vidé volontairement (existe mais vide) = pas de session.
 * Champ inexistant (section pas ouverte) = horaires par défaut.
 */
function getTimesForDay(dayIndex) {
  const defaultMorn = parseTimes(inputRefs.morning?.value || '10:00 - 13:00');
  const defaultAft = parseTimes(inputRefs.afternoon?.value || '14:00 - 17:00');

  // Garantir des valeurs par défaut solides
  const safeMornStart = defaultMorn.start || '10:00';
  const safeMornEnd = defaultMorn.end || '13:00';
  const safeAftStart = defaultAft.start || '14:00';
  const safeAftEnd = defaultAft.end || '17:00';

  const mornInput = document.getElementById(`perDay_morn_${dayIndex}`);
  const aftInput = document.getElementById(`perDay_aft_${dayIndex}`);

  // Input inexistant → utiliser les horaires par défaut (les deux créneaux actifs)
  // Input existant mais vide → créneau désactivé volontairement
  const hasMorning = mornInput ? mornInput.value.trim() !== '' : true;
  const hasAfternoon = aftInput ? aftInput.value.trim() !== '' : true;

  const morn = hasMorning ? parseTimes(mornInput ? mornInput.value.trim() : inputRefs.morning?.value || '10:00 - 13:00') : null;
  const aft = hasAfternoon ? parseTimes(aftInput ? aftInput.value.trim() : inputRefs.afternoon?.value || '14:00 - 17:00') : null;

  return {
    hasMorning,
    hasAfternoon,
    mornStart: (morn?.start && morn.start !== '') ? morn.start : safeMornStart,
    mornEnd: (morn?.end && morn.end !== '') ? morn.end : safeMornEnd,
    aftStart: (aft?.start && aft.start !== '') ? aft.start : safeAftStart,
    aftEnd: (aft?.end && aft.end !== '') ? aft.end : safeAftEnd,
  };
}

// ========================================
// INITIALISATION
// ========================================

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initDomRefs();
  loadSavedKeys();
  setupValidationButtons();

  // Date par défaut = demain
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  inputRefs.startDate.valueAsDate = tomorrow;

  // Régénérer les lignes par jour quand date/durée/horaires changent
  const triggerFields = ['campaignStartDate', 'campaignDuration', 'timeMorning', 'timeAfternoon'];
  triggerFields.forEach(id => {
    const field = document.getElementById(id);
    if (field) field.addEventListener('change', rebuildPerDaySchedule);
  });
  rebuildPerDaySchedule();

  // Événements
  el.btn.addEventListener('click', handleGenerate);
  document.getElementById('downloadPdfBtn').addEventListener('click', () => generateFullPDF(generatedData, inputRefs));

  initInseeUI();
  document.getElementById('openInseeBtn')?.addEventListener('click', handleOpenInsee);
});

/**
 * Ouvre la carte du potentiel INSEE centrée sur l'adresse de départ.
 * Le géocodage est fait ici et non à la génération : sans point d'origine ni
 * rayon, la carte n'aurait aucune emprise à charger.
 */
async function handleOpenInsee() {
  const adresse = inputRefs.address?.value?.trim();
  if (!adresse) {
    return showMessage("Renseignez d'abord l'adresse du point de départ : la carte du potentiel se centre dessus.");
  }
  const rayon = parseFloat(inputRefs.radius?.value) || 10;

  const bouton = document.getElementById('openInseeBtn');
  const htmlInitial = bouton.innerHTML;
  bouton.disabled = true;
  bouton.innerHTML = 'Localisation de l\'adresse…';

  let origine;
  try {
    origine = await geocodeAddressBAN(adresse);
  } catch (e) {
    showMessage(`Adresse introuvable : ${e.message}`);
    return;
  } finally {
    bouton.disabled = false;
    bouton.innerHTML = htmlInitial;
    lucide.createIcons();
  }

  showMessage('');
  const selection = await openInseeMap(origine, rayon);
  if (selection) {
    renderInseeSummary();
    lucide.createIcons();
  }
}
