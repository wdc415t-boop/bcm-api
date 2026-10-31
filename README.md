# bcm-api
## Shell identification: Google Web Detection hints (Phase 3a, 2026-10-30)

`vision.js` runs Google Cloud Vision **Web Detection** (the engine behind Lens) on the photo before Claude, maps the names it returns onto catalog species (common names, scientific names and the synonyms table), and hands the ranked list to Claude as *hints from a second observer*. Claude still picks, caps and explains from the catalog; a hint that a visible structural feature contradicts loses. Names that match no catalog species surface as `not_in_catalog_guess` material.

| Env | Default | Meaning |
|---|---|---|
| `GOOGLE_VISION_API_KEY` | unset | Key restricted to Cloud Vision API. Unset = stage never runs. |
| `BCM_VISION` | `off` | `on` turns the stage on for every scan. Eval requests (`X-BCM-Eval`) may pass `{"vision":"on"|"off"}` per request regardless. |

Cost: about $0.0035 per scan after Google's free 1,000 a month. Any failure (timeout, quota, bad key) logs `[VISION]` and the scan proceeds without hints. The response carries a `vision` block (`used`, `strength`, `candidates`, `unmatched`, `best_guess`, `ms`, `cost_usd`, `error`). `npm test` runs the mapping tests against the bundled catalog.

### Second-opinion model (Phase 3a.2, 2026-10-31)

`opinion.js` asks a second vision model through OpenRouter (default `google/gemini-4-argon` in the eval) to name the species in free text, maps its names onto the catalog with the same mapper, and adds them to Claude's hints as a labelled second opinion. `BCM_OPINION=<openrouter model id>` turns it on for every scan (default `off`); eval requests may pass `{"opinion":"<model>"|"off"}`. Response carries an `opinion` block. Both hint sources can run together.
