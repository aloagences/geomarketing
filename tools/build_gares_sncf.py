#!/usr/bin/env python3
"""
Compacte l'export GTFS SNCF (open data) en un seul fichier léger pour l'application :
data/gares-sncf.json — gares, horaires théoriques d'arrivée et de départ des trains,
et jours de circulation. Aucune clé API : l'application lit ce fichier directement.

Usage :
    python3 -I tools/build_gares_sncf.py Export_OpenData_SNCF_GTFS_NewTripId.zip [data/gares-sncf.json]

Source : https://transport.data.gouv.fr/datasets/horaires-prevus-sncf (GTFS « NewTripId »).
À relancer à chaque nouveau GTFS : le fichier produit porte sa date de début et de fin de validité.

Format du fichier produit :
  debut, fin     période couverte (AAAA-MM-JJ)
  gares          [[uic, nom, lat, lng], ...]
  services       un masque de jours par service, en hexadécimal : le bit i vaut 1 si le
                 service circule le jour (debut + i)
  evenements     pour chaque gare (même ordre que « gares »), une liste d'entiers triés
                 service * 8192 + minute * 4 + genre   (genre 1 = arrivée, 2 = départ),
                 minute = minutes depuis minuit, de 04:00 à 23:59 seulement,
                 stockés en DIFFÉRENCES successives (cumul à la lecture) : fichier 3x plus léger
"""
import csv
import io
import json
import sys
import zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta

MIN_JOUR, MAX_JOUR = 4 * 60, 24 * 60 - 1
TYPE_TRAIN = '2'          # route_type GTFS : 2 = train (les autocars TER et les tramways sont écartés)


def lire(zf, nom):
    with zf.open(nom) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig'))


def minutes(hhmmss):
    h, m, _ = hhmmss.split(':')
    return int(h) * 60 + int(m)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    zf = zipfile.ZipFile(sys.argv[1])
    sortie = sys.argv[2] if len(sys.argv) > 2 else 'data/gares-sncf.json'

    info = next(lire(zf, 'feed_info.txt'))
    debut = datetime.strptime(info['feed_start_date'], '%Y%m%d').date()
    fin = datetime.strptime(info['feed_end_date'], '%Y%m%d').date()
    nb_jours = (fin - debut).days + 1

    types = {r['route_id']: r['route_type'] for r in lire(zf, 'routes.txt')}
    voyages = {t['trip_id']: t['service_id'] for t in lire(zf, 'trips.txt') if types.get(t['route_id']) == TYPE_TRAIN}

    arrets = {s['stop_id']: s for s in lire(zf, 'stops.txt')}
    def gare_de(stop_id):
        s = arrets.get(stop_id)
        return (s.get('parent_station') or stop_id) if s else None

    # Jours de circulation de chaque service (calendar_dates, type 1 = ajout)
    utiles = set(voyages.values())
    masques = defaultdict(int)
    for r in lire(zf, 'calendar_dates.txt'):
        if r['exception_type'] != '1' or r['service_id'] not in utiles:
            continue
        i = (datetime.strptime(r['date'], '%Y%m%d').date() - debut).days
        if 0 <= i < nb_jours:
            masques[r['service_id']] |= 1 << i

    # Services identiques regroupés : un seul masque pour tous
    index_masque, services, index_service = {}, [], {}
    for sid, m in masques.items():
        if m not in index_masque:
            index_masque[m] = len(services)
            services.append(m)
        index_service[sid] = index_masque[m]

    # Événements par gare
    evenements = defaultdict(set)
    for r in lire(zf, 'stop_times.txt'):
        sid = voyages.get(r['trip_id'])
        if sid is None or sid not in index_service:
            continue
        gare = gare_de(r['stop_id'])
        if gare is None:
            continue
        svc = index_service[sid]
        if r['drop_off_type'] != '1' and r['arrival_time']:
            m = minutes(r['arrival_time'])
            if MIN_JOUR <= m <= MAX_JOUR:
                evenements[gare].add(svc * 8192 + m * 4 + 1)
        if r['pickup_type'] != '1' and r['departure_time']:
            m = minutes(r['departure_time'])
            if MIN_JOUR <= m <= MAX_JOUR:
                evenements[gare].add(svc * 8192 + m * 4 + 2)

    gares, liste = [], []
    for gare_id, evs in sorted(evenements.items()):
        s = arrets[gare_id]
        uic = gare_id.rsplit('OCE', 1)[-1]
        gares.append([uic, s['stop_name'], round(float(s['stop_lat']), 5), round(float(s['stop_lon']), 5)])
        triee = sorted(evs)
        liste.append([v - p for v, p in zip(triee, [0] + triee)])

    def en_hexa(m):
        """Bit i (jour debut + i) → quartet i // 4, bit de poids fort en premier."""
        bits = ''.join('1' if (m >> i) & 1 else '0' for i in range(nb_jours)).ljust((nb_jours + 3) // 4 * 4, '0')
        return ''.join(format(int(bits[k:k + 4], 2), 'x') for k in range(0, len(bits), 4))

    donnees = {
        'debut': debut.isoformat(), 'fin': fin.isoformat(),
        'genere': date.today().isoformat(),
        'gares': gares,
        'services': [en_hexa(m) for m in services],
        'evenements': liste,
    }
    with open(sortie, 'w', encoding='utf-8') as f:
        json.dump(donnees, f, ensure_ascii=False, separators=(',', ':'))
    total = sum(len(e) for e in liste)
    print(f'{len(gares)} gares, {len(services)} services, {total} horaires, {debut} → {fin} : {sortie}')


if __name__ == '__main__':
    main()
