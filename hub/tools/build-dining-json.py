#!/usr/bin/env python3
"""
build-dining-json.py — BCM Phase 3h
Turns the dining master CSV (hub/data/BCM_Dining_Master.csv) into public_html/assets/dining.json,
in the same shape the app's embedded REGIONS_CONFIG uses, so the app can swap one for the other.

Usage:  python3 build-dining-json.py [master.csv] [out.json]
Rules:
  - Only rows with Active == "Y" are exported. Flip Active to N to retire a listing; never delete the row.
  - Prospect / pipeline columns (Tier*, PipelineStage, ProspectType, Contact*, OutreachChannel, Source,
    WebsiteStatus, LastChecked, Recommend) are NOT exported. Only what a card shows.
    (*Tier is exported because the app gates some entries on it.)
  - Category -> region list:  restaurant -> restaurants[]  (grouped by Area, keeps AreaColor)
                              pizza -> pizzaPlaces[]   icecream -> iceCream[]   cinema -> movies[]
  - mapsUrl is derived from Address, so the CSV never has to carry it.
Output carries "generated" (UTC timestamp) and "count" so the app and humans can tell what they loaded.
"""
import csv, json, sys, urllib.parse, datetime, collections

src = sys.argv[1] if len(sys.argv) > 1 else 'hub/data/BCM_Dining_Master.csv'
out = sys.argv[2] if len(sys.argv) > 2 else 'hub/assets/dining.json'

LISTS = {'restaurant': 'restaurants', 'pizza': 'pizzaPlaces', 'icecream': 'iceCream', 'cinema': 'movies'}
PLACE_FIELDS = [('BusinessName','name'),('Tier','tier'),('Vibe','vibe'),('Cuisine','cuisine'),('Signature','signature'),
                ('PriceLevel','price'),('Address','address'),('Phone','phone'),('Website','website'),('MenuUrl','menuUrl'),
                ('Note','note'),('Resort','resort')]

def place(row):
    p = {}
    for col, key in PLACE_FIELDS:
        v = (row.get(col) or '').strip()
        if v: p[key] = v
    if p.get('address'):
        p['mapsAddr'] = p['address']
        p['mapsUrl'] = 'https://maps.google.com/?daddr=' + urllib.parse.quote_plus(p['address'])
    p.setdefault('tier', 'free')
    return p

regions = collections.OrderedDict()
count = 0
with open(src, encoding='utf-8-sig', newline='') as f:
    for row in csv.DictReader(f):
        if (row.get('Active') or '').strip().upper() != 'Y':
            continue
        cat = (row.get('Category') or '').strip().lower()
        if cat not in LISTS:
            continue
        slug = row['Region'].strip().lower()
        r = regions.setdefault(slug, {'slug': slug, 'name': row.get('RegionName', '').strip(),
                                      'restaurants': [], 'pizzaPlaces': [], 'iceCream': [], 'movies': []})
        if cat == 'restaurant':
            area = (row.get('Area') or 'More places').strip()
            grp = next((g for g in r['restaurants'] if g['area'] == area), None)
            if grp is None:
                grp = {'area': area, 'color': (row.get('AreaColor') or '#0284c7').strip(), 'places': []}
                r['restaurants'].append(grp)
            grp['places'].append(place(row))
        else:
            r[LISTS[cat]].append(place(row))
        count += 1

doc = {'generated': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
       'source': src.split('/')[-1], 'count': count, 'regions': regions}
with open(out, 'w', encoding='utf-8') as f:
    json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
print(f'{out}: {count} places, {len(regions)} regions, {sum(1 for _ in open(out, encoding="utf-8").read())} bytes')
for slug, r in regions.items():
    print(f"  {slug:8s} restaurants={sum(len(g['places']) for g in r['restaurants'])} pizza={len(r['pizzaPlaces'])} iceCream={len(r['iceCream'])} movies={len(r['movies'])}")
