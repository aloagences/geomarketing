/**
 * export.js - Exports PDF, CSV, KML
 */

// ========================================
// CSV
// ========================================

function generateCSV(data, brandName) {
  if (!data) return;
  let csv = "\uFEFFNom,Description,Type,Latitude,Longitude\n";

  if (data.shopLocation) {
    csv += `"Magasin QG","${sanitize(data.shopLocation.address)}","QG",${data.shopLocation.lat},${data.shopLocation.lng}\n`;
  }

  (data.dailyPlans || []).forEach(day => {
    (day.stops || []).forEach(stop => {
      csv += `"${sanitize(day.day)} - ${sanitize(stop.time)}","${sanitize(stop.locationName)} - ${sanitize(stop.address)}","${sanitize(day.role)}",${stop.lat},${stop.lng}\n`;
    });
  });

  downloadBlob(csv, `Plan_${safeName(brandName)}.csv`, 'text/csv;charset=utf-8;');
}

// ========================================
// KML
// ========================================

function generateKML(data) {
  if (!data) return;
  const c = str => (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 .,-]/g, '');

  let kml = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Export Campagne</name>';

  if (data.shopLocation) {
    kml += `<Placemark><name>QG</name><Point><coordinates>${data.shopLocation.lng},${data.shopLocation.lat}</coordinates></Point></Placemark>`;
  }

  (data.dailyPlans || []).forEach(day => {
    (day.stops || []).forEach(stop => {
      kml += `<Placemark><name>${c(day.day)} - ${c(stop.time)}</name><description>${c(stop.locationName)} (${c(stop.address)})</description><Point><coordinates>${stop.lng},${stop.lat}</coordinates></Point></Placemark>`;
    });
  });

  kml += '</Document></kml>';
  downloadBlob(kml, 'Plan_Export.kml', 'application/vnd.google-earth.kml+xml');
}

// ========================================
// PDF (Premium A4 Paysage)
// ========================================

async function generateFullPDF(data, inputRefs) {
  const btn = document.getElementById('downloadPdfBtn');
  const originalHTML = btn.innerHTML;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 mr-2 animate-spin"></i> Création PDF...';
  btn.disabled = true;

  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('l', 'mm', 'a4');
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();

    const addFooter = (isBlue = false) => {
      const c = isBlue ? 255 : 14;
      const c2 = isBlue ? 255 : 44;
      const c3 = isBlue ? 255 : 89;
      pdf.setFont('helvetica', 'bold').setFontSize(12).setTextColor(c, c2, c3);
      pdf.text('àlo', 15, H - 10);
      pdf.setFont('helvetica', 'normal').setTextColor(isBlue ? 200 : 150, isBlue ? 200 : 150, isBlue ? 200 : 150);
      pdf.text('we are mixed culture\u00AE', W - 15, H - 10, { align: 'right' });
    };

    const captureElement = async (elementId, isBlue = false) => {
      const el = document.getElementById(elementId);
      if (!el || el.classList.contains('hidden')) return;

      const saved = { borderRadius: el.style.borderRadius, border: el.style.border, margin: el.style.margin };
      el.style.borderRadius = '0px';
      el.style.border = 'none';
      el.style.margin = '0px';

      const btns = el.querySelectorAll('button');
      btns.forEach(b => b.style.display = 'none');

      const canvas = await html2canvas(el, {
        scale: 2, useCORS: true,
        backgroundColor: isBlue ? '#0E2C59' : '#F3F4F6',
        windowWidth: 1200,
      });

      Object.assign(el.style, saved);
      btns.forEach(b => b.style.display = '');

      pdf.addPage();
      pdf.setFillColor(...(isBlue ? [14, 44, 89] : [243, 244, 246]));
      pdf.rect(0, 0, W, H, 'F');

      const ratio = canvas.width / canvas.height;
      const margin = 10;
      let rW = W - margin * 2;
      let rH = rW / ratio;
      let x = margin, y = margin + 5;

      if (rH > H - margin * 2 - 15) {
        rH = H - margin * 2 - 15;
        rW = rH * ratio;
        x = (W - rW) / 2;
      }

      pdf.addImage(canvas.toDataURL('image/jpeg', 1.0), 'JPEG', x, y, rW, rH);
      addFooter(isBlue);
    };

    // 1. Couverture
    const coverBrand = document.getElementById('coverBrand');
    const coverAddr = document.getElementById('coverAddress');
    if (coverBrand) coverBrand.textContent = inputRefs.brand.value.trim();
    if (coverAddr) coverAddr.textContent = inputRefs.address.value.trim();

    const coverCanvas = await html2canvas(document.getElementById('pdfCoverPage'), {
      scale: 2, useCORS: true, backgroundColor: '#ffffff',
    });
    pdf.addImage(coverCanvas.toDataURL('image/jpeg', 1.0), 'JPEG', 0, 0, W, H);

    // 2. Reach
    await captureElement('reachEstimationContainer', true);

    // 3. Carte (sans header)
    const mapHeader = document.querySelector('#mapContainerWrapper .flex-col');
    const savedDisplay = mapHeader?.style.display;
    if (mapHeader) mapHeader.style.display = 'none';
    await captureElement('mapContainerWrapper', false);
    if (mapHeader) mapHeader.style.display = savedDisplay;

    // 4. Itinéraires
    if (data?.dailyPlans) {
      for (let i = 0; i < data.dailyPlans.length; i++) {
        await captureElement(`day-card-${i}`, false);
      }
    }

    // 5. Émargement
    if (data?.attendance?.length > 0) {
      const grid = document.getElementById('attendanceGrid');
      const temp = document.createElement('div');
      Object.assign(temp.style, {
        width: '1122px', padding: '40px', background: '#F3F4F6',
        position: 'fixed', top: '0', left: '-9999px',
      });
      document.body.appendChild(temp);

      const headerHTML = `<h3 style="font-size:28px;color:#0E2C59;font-weight:800;margin-bottom:30px;font-family:Montserrat,sans-serif;">Émargement Chauffeur</h3>`;
      const cards = grid.children;
      let pair = document.createElement('div');
      pair.style.cssText = 'display:flex;flex-direction:column;gap:30px';
      temp.innerHTML = headerHTML;

      for (let i = 0; i < cards.length; i++) {
        const clone = cards[i].cloneNode(true);
        clone.style.boxShadow = 'none';
        clone.style.border = 'none';
        pair.appendChild(clone);

        if ((i + 1) % 2 === 0 || i === cards.length - 1) {
          temp.appendChild(pair);
          const canvas = await html2canvas(temp, { scale: 2, useCORS: true, backgroundColor: '#F3F4F6' });

          pdf.addPage();
          pdf.setFillColor(243, 244, 246);
          pdf.rect(0, 0, W, H, 'F');

          const ratio = canvas.width / canvas.height;
          let rW = W - 20, rH = rW / ratio;
          if (rH > H - 30) { rH = H - 30; rW = rH * ratio; }
          pdf.addImage(canvas.toDataURL('image/jpeg', 1.0), 'JPEG', 10, 10, rW, rH);
          addFooter(false);

          temp.innerHTML = headerHTML;
          pair = document.createElement('div');
          pair.style.cssText = 'display:flex;flex-direction:column;gap:30px';
        }
      }
      document.body.removeChild(temp);
    }

    // 6. Page satisfaction finale
    const satEl = document.getElementById('pdfSatisfactionPage');
    if (satEl) {
      const satCanvas = await html2canvas(satEl, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      pdf.addPage();
      pdf.addImage(satCanvas.toDataURL('image/jpeg', 1.0), 'JPEG', 0, 0, W, H);
    }

    // Nom de fichier
    const brand = inputRefs.brand.value.trim().toUpperCase();
    let city = inputRefs.address.value.split(',').pop().trim().replace(/[0-9]/g, '').trim().toUpperCase() || 'VILLE';
    const fileName = `${brand}, ${city}, ${inputRefs.startDate.value}`.replace(/[\/\\?%*:|"<>]/g, '-');
    pdf.save(`${fileName}.pdf`);

  } catch (err) {
    console.error('Erreur PDF:', err);
    alert('Erreur lors de la création du PDF.');
  } finally {
    btn.innerHTML = originalHTML;
    btn.disabled = false;
    lucide.createIcons();
  }
}

// ========================================
// UTILITAIRES INTERNES
// ========================================

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function safeName(str) {
  return (str || 'export').replace(/[^a-zA-Z0-9]/g, '_');
}
