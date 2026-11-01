# hub/data — dining master (lives OUTSIDE this public repo)

The Dining tab's single source is `BCM_Dining_Master.csv`, kept privately by Bill (Mac: `BCM/BCM_Phase3h-DiningData-2026-11-01/`, plus a Gmail draft) because it also carries his restaurant-roulette prospecting columns. It is **not** committed here.

Edit the CSV → run the generator → upload the JSON (after Bill's "Yes, upload"):

```
python3 hub/tools/build-dining-json.py /path/to/BCM_Dining_Master.csv hub/assets/dining.json
# TUS-upload hub/assets/dining.json to public_html/assets/dining.json, clear cache
```

Columns the generator reads: Region, RegionName, Category (restaurant|pizza|icecream|cinema), Area, AreaColor, BusinessName, Cuisine, Vibe, PriceLevel, Signature, Address, Phone, Website, MenuUrl, Note, Resort, Tier, Active. Everything else in the CSV is ignored and never exported.

Retire a listing by setting `Active` to `N`; don't delete rows. Delivery apps and "Getters" are generic services and stay hard-coded in the app.

Audit 2026-11-01 (91 URLs): 104 live, 11 live but bot-blocked to scripts, 7 dead, 2 parked, 32 venues with no website. 10 of 12 cinema rows are unverifiable fabrications from the original AI pass (only Silverspot Cinema is real).
