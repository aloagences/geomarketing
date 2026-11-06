#!/usr/bin/env python3
"""
Carreaux de population des pays voisins (recensement 2021, grille européenne 1 km) pour la carte
du potentiel : là où les carreaux INSEE s'arrêtent à la frontière, l'appli affiche ceux-ci.

Source : Eurostat, « Census 2021 population grid » (GISCO), version 3, fichiers par pays
(ESTAT_Census_2021_country.csv.zip → CENSUS_GRID_N_XX_2021.csv).
https://ec.europa.eu/eurostat/web/gisco/geodata/population-distribution/population-grids
© Union européenne 2026. Données reprises sans modification des valeurs ; regroupées en tuiles.

On lit les fichiers PAR PAYS, pas le fichier européen fusionné : sur la frontière, un carré
partagé (Kehl / Strasbourg) porte dans le fichier fusionné la population des deux pays. Ici on
ne garde que la part du pays voisin ; la part française reste celle des carreaux INSEE 200 m.

Noms de localité : GeoNames « cities500 » (localités de plus de 500 habitants, avec leur pays),
https://download.geonames.org/export/dump/cities500.zip — CC BY 4.0. Chaque carré prend le nom
de la localité DU MÊME PAYS la plus proche (8 km au plus) : une ville française ne nomme jamais
un carré allemand, et l'appli n'a pas à interroger OpenStreetMap, souvent saturé.

Usage :
    python3 -I tools/build_carreaux_europe.py <dossier des CSV par pays> [data/carreaux-europe] [cities500.txt]

Sortie :
    index.json            pays couverts, taille moyenne des ménages, liste des tuiles
    tuiles/<n>_<e>.json   une tuile de 50 × 50 km :
                          {"p": ["DE", ...], "n": ["Kehl", ...], "c": [k, habitants, pays, nom, ...]}
                          (nom = indice dans "n", -1 si aucune localité à moins de 8 km)
                          k = ligne * 50 + colonne du carré de 1 km dans la tuile ; le coin
                          sud-ouest du carré vaut N = n*50000 + ligne*1000, E = e*50000 + colonne*1000
                          (mètres, ETRS89-LAEA / EPSG:3035, comme l'id_inspire des carreaux INSEE).
"""
import csv
import json
import math
import os
import re
import sys
from collections import defaultdict
from datetime import date

PAYS = ('DE', 'CH', 'IT', 'ES', 'BE', 'LU')
# Taille moyenne des ménages (personnes par ménage, ordre de grandeur Eurostat 2021) :
# sert à estimer un nombre de ménages, que la grille européenne ne donne pas.
TAILLE_MENAGE = {'DE': 2.0, 'CH': 2.2, 'IT': 2.3, 'ES': 2.5, 'BE': 2.3, 'LU': 2.4}
NOMS = {'DE': 'Allemagne', 'CH': 'Suisse', 'IT': 'Italie', 'ES': 'Espagne', 'BE': 'Belgique', 'LU': 'Luxembourg'}
TUILE = 50000
CARRE = 1000
ID_RE = re.compile(r'CRS3035RES1000mN(\d+)E(\d+)$')
RAYON_NOM_KM = 8
# GeoNames donne parfois le nom anglais : on rétablit le nom en usage chez nos clients.
NOMS_FR = {'Geneva': 'Genève'}

# --- ETRS89-LAEA (EPSG:3035) → WGS84, formules de Snyder (les mêmes que js/carreaux-europe.js) ---
_A, _E2 = 6378137.0, 0.00669438002290
_E = math.sqrt(_E2)
_LAT0, _LON0, _FE, _FN = math.radians(52), math.radians(10), 4321000.0, 3210000.0


def _q(phi):
    s = math.sin(phi)
    return (1 - _E2) * (s / (1 - _E2 * s * s) - (1 / (2 * _E)) * math.log((1 - _E * s) / (1 + _E * s)))


_QP = _q(math.pi / 2)
_B1 = math.asin(_q(_LAT0) / _QP)
_RQ = _A * math.sqrt(_QP / 2)
_D = _A * math.cos(_LAT0) / (math.sqrt(1 - _E2 * math.sin(_LAT0) ** 2) * _RQ * math.cos(_B1))


def laea_vers_wgs(n, e):
    x, y = e - _FE, n - _FN
    rho = math.hypot(x / _D, _D * y)
    c = 2 * math.asin(rho / (2 * _RQ))
    bp = math.asin(math.cos(c) * math.sin(_B1) + (_D * y * math.sin(c) * math.cos(_B1)) / rho)
    lon = _LON0 + math.atan2(x * math.sin(c), _D * rho * math.cos(_B1) * math.cos(c) - _D * _D * y * math.sin(_B1) * math.sin(c))
    e4, e6 = _E2 ** 2, _E2 ** 3
    lat = (bp + (_E2 / 3 + 31 * e4 / 180 + 517 * e6 / 5040) * math.sin(2 * bp)
           + (23 * e4 / 360 + 251 * e6 / 3780) * math.sin(4 * bp) + (761 * e6 / 45360) * math.sin(6 * bp))
    return math.degrees(lat), math.degrees(lon)


def km(lat1, lng1, lat2, lng2):
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lng2 - lng1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


def lire_localites(chemin):
    """Localités GeoNames des pays couverts, rangées par case de 0,1° et par pays."""
    cases = defaultdict(list)
    with open(chemin, encoding='utf-8') as f:
        for ligne in f:
            c = ligne.rstrip('\n').split('\t')
            if len(c) < 9 or c[6] != 'P' or c[8] not in PAYS:
                continue
            lat, lng = float(c[4]), float(c[5])
            cases[(c[8], int(lat * 10), int(lng * 10))].append((lat, lng, NOMS_FR.get(c[1], c[1])))
    return cases


def localite_proche(cases, pays, lat, lng):
    meilleur, d_min = None, RAYON_NOM_KM
    bl, bg = int(lat * 10), int(lng * 10)
    for dl in (-1, 0, 1):
        for dg in (-2, -1, 0, 1, 2):
            for la, lo, nom in cases.get((pays, bl + dl, bg + dg), ()):
                d = km(lat, lng, la, lo)
                if d < d_min:
                    d_min, meilleur = d, nom
    return meilleur


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    dossier = sys.argv[1]
    sortie = sys.argv[2] if len(sys.argv) > 2 else 'data/carreaux-europe'
    localites = lire_localites(sys.argv[3]) if len(sys.argv) > 3 else {}
    os.makedirs(os.path.join(sortie, 'tuiles'), exist_ok=True)

    # (n, e) → {pays: habitants}
    carres = defaultdict(dict)
    for code in PAYS:
        chemin = os.path.join(dossier, f'CENSUS_GRID_N_{code}_2021.csv')
        total = 0
        with open(chemin, newline='', encoding='utf-8-sig') as f:
            for r in csv.DictReader(f):
                if r['STAT'] != 'T':
                    continue
                try:
                    hab = int(float(r['OBS_VALUE']))
                except (TypeError, ValueError):
                    continue          # valeur confidentielle ou absente
                if hab <= 0:
                    continue
                m = ID_RE.search(r['SPATIAL'])
                if not m:
                    continue          # population non localisée (« XX_unallocated »)
                cle = (int(m[1]), int(m[2]))
                carres[cle][code] = carres[cle].get(code, 0) + hab
                total += hab
        print(f'{code} : {total:,} habitants'.replace(',', ' '))

    tuiles = defaultdict(list)
    sans_nom = 0
    for (n, e), parPays in carres.items():
        hab = sum(parPays.values())
        pays = max(parPays, key=parPays.get)
        nom = ''
        if localites:
            lat, lng = laea_vers_wgs(n + CARRE / 2, e + CARRE / 2)
            nom = localite_proche(localites, pays, lat, lng) or ''
            sans_nom += not nom
        tuiles[(n // TUILE, e // TUILE)].append(((n % TUILE) // CARRE * 50 + (e % TUILE) // CARRE, hab, pays, nom))

    for (tn, te), liste in tuiles.items():
        liste.sort()
        codes = sorted({p for _, _, p, _ in liste})
        noms = sorted({nom for *_, nom in liste if nom})
        plat = []
        for k, hab, p, nom in liste:
            plat += [k, hab, codes.index(p), noms.index(nom) if nom else -1]
        with open(os.path.join(sortie, 'tuiles', f'{tn}_{te}.json'), 'w', encoding='utf-8') as f:
            json.dump({'p': codes, 'n': noms, 'c': plat}, f, ensure_ascii=False, separators=(',', ':'))
    if localites:
        print(f'{sans_nom} carrés sans localité à moins de {RAYON_NOM_KM} km')

    index = {
        'source': 'Eurostat, Census 2021 population grid (GISCO), v3 — © Union européenne 2026 ; noms : GeoNames (CC BY 4.0)',
        'genere': date.today().isoformat(),
        'resolution': CARRE, 'tuile': TUILE,
        'pays': {c: {'nom': NOMS[c], 'tailleMenage': TAILLE_MENAGE[c]} for c in PAYS},
        'tuiles': sorted(f'{tn}_{te}' for tn, te in tuiles),
    }
    with open(os.path.join(sortie, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(carres)} carrés de 1 km, {len(tuiles)} tuiles : {sortie}')


if __name__ == '__main__':
    main()
