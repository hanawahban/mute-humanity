# Pipeline

Offline Python. Downloads NASA Earth data, regrids each granule to a 2 degree
global grid (90 x 180), splices long records, and writes small JSON and PNG files
to `public/data/`. All dataset settings live in `config/sources.yaml` and
`config/regions.yaml`; nothing dataset-specific is hard-coded.

## Setup

```
source .venv/bin/activate
pip install -r pipeline/requirements.txt
```

Earthdata Login: `~/.netrc` entry for `urs.earthdata.nasa.gov`, or env
`EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD`. FIRMS archive CSVs go in
`pipeline/cache/firms/`.

## Commands (run from repo root)

```
python -m pipeline.peek <reader>        # open first granule, print structure, STOP
python -m pipeline.build <record>       # e.g. no2; add --years 2004 2006 for a trial, --cover for the SVS still
python -m pipeline.report <record>      # contact sheets, histograms, sanity table
python -m pytest pipeline/tests
```

Each reader is written only after its first granule has been inspected and
confirmed. Currently implemented: `omno2d`. Others raise `NotImplementedError`.

## Method

- Each granule is regridded to 2 degrees immediately (area-weighted mean, cos
  latitude; sums for counts), the raw file is deleted, and the coarse result is
  cached in `pipeline/cache/processed/` so reruns skip finished days.
- No valid input gives `null`, never 0. Fire cells with no fire are 0 (the sensor covers them).
- Every granule is logged to `pipeline/logs/<record>.csv` (ok / cached / missing).
- Time step is one year. Daily products use `days_per_month` (default 2: the 5th and 20th)
  averaged into an annual mean; MOD13C2 uses months 1, 4, 7, 10; monthly products use all.
- Years with under 50% of planned samples are null with a `nullReason`.
  The current year is included and flagged `partial`.
- Normalization to 0-1 uses fixed physical ranges (log for NO2, rain, fires, plastic),
  falling back to the 2nd-98th percentile over all years. Per-record, over the full
  spliced series, so years are comparable. Raw units, range and data min/max go in the manifest.
- Region stats (mean, max, valid-cell fraction) per year for each region in `regions.yaml`.
  Humanity level = mean of normalized human-group layers with valid data.
  Fires: vegetation layers are group nature, industrial layers are human.

## Datasets

| Record | Dataset | Variable | Notes |
|---|---|---|---|
| Ocean | MUR25-JPL-L4-GLOB-v04.2 | analysed_sst, K to degC | 2002 on. Reader pending |
| Ocean | OSCAR_L4_OC_FINAL_V2.0, then OSCAR_L4_OC_NRT_V2.0 | u, v | 1993 on. speed = hypot(u, v), direction = atan2, mean of u,v first. FINAL until its last date, NRT after, no adjustment. Reader pending |
| Plants | MOD13C2 v061 (HDF4) | CMG 0.05 Deg Monthly NDVI | scale 0.0001, fill -3000. Reader pending |
| Rain | GPCP monthly 0.5 deg, then GPM_3IMERGM V07 | precipitation | Both in mm/day. GPCP adjusted to IMERG climatology 2001-2010 (per-cell factor, clipped 0.5-2). Switch 2001. GPCP version/start year to be confirmed. Readers pending |
| NO2 | SFC_NITROGEN_DIOXIDE_CONC (1990-2004), then OMNO2d v003 (from 2005; OMI data starts Oct 2004) | ColumnAmountNO2TropCloudScreened (molec/cm2) | OMI/surface ratio over 2005-2010 (median, 3x3 smoothed, regional/global fallback) scales the surface years. Surface variable and units to be confirmed. OMNO2d: fill to NaN, negatives kept until the annual mean (then clipped at 0), axes from StructMetadata.0, Weight field weights the days, display unit 1e15 molec/cm2. Reader done, untested on a real granule |
| Fires | FIRMS MODIS archive CSV, Terra only (satellite == T) | count, summed FRP per cell-year | confidence >= 30. Type 0 vegetation, 2+3 industrial, 1 (volcano) ignored. Reader pending |
| Ocean plastic | CYGNSS_L3_MICROPLASTIC_V3.2 | mp_concentration (#/km2) | 37.4N-37.4S only, null elsewhere. Reader pending |

Caveats:

- Vegetation fires are partly human-set.
- NO2 before 2004 is surface concentration rescaled to column units; it shows pattern
  and trend, not exact column values. Both raw series are summarised in `rawRegionStats`.
- Overlays are upsampled from the 2 degree grid, so they are soft.
- Surface NO2 (George Washington University; DOI 10.5067/J99FI2U38YRN) is a land-use regression for 2010-12 scaled to other years with OMI and MERRA-2 column data. Land only, 60S-75N, annual, ppbv, 0.0083 deg. Its trend is therefore partly OMI-derived, so agreement with OMI over the splice overlap is expected and is not independent validation. Reader coarsens in row blocks (about 150 MB download per year, deleted after).
- Satellite NO2 is cloud screened, so persistently cloudy cells may be null.

## Outputs

`manifest.json` (records, datasets, years, grid, layers with raw ranges, splice info, regions, album cover SVS id),
`<record>.json` (times, per-year `meta` with source/sampled/partial/nullReason, `layers.<id>.grid[year][90][180]`,
`regionStats`, `rawRegionStats`, `humanity`), `overlays/<record>/<layer>_<year>.png`, `covers/`.
Record JSON is kept under about 2 MB by dropping to 1 decimal if needed.

## Citations

Credit NASA and the data teams for each dataset (GES DISC for OMNO2d and IMERG, PO.DAAC for MUR,
OSCAR and CYGNSS, LP DAAC for MOD13C2, NASA FIRMS, GPCP). DOIs to be added to `sources.yaml` after
each dataset's landing page is checked.
