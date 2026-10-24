# B15: district information in the available Hemnet SaleCard fixtures

Inspected offline on 2026-10-24; no Hemnet, Booli or Mapbox requests were made.

The captured `SAMPLE_CARD` in `tests/test_hemnet_parser.py` contains these
location-related fields: `streetAddress` and `coordinates` (`lat`, `long`). Its
other fields are the Apollo typename, card/listing IDs, sale date and label,
asking/final price, living area, fee, square-metre price and rooms. It contains
no district name, area name, location object or location reference.

The hand-built SaleCards in `tests/test_reparse.py`, `tests/test_street_address.py`
and the `_hemnet_card` helper in `tests/test_pagination.py` likewise contain no
area/location name. `tests/test_source_characterisation.py` builds synthetic
Apollo pages; those are extraction fixtures rather than independent captured
location evidence. The existing backend agent-memory note describes Booli's
`descriptiveAreaName`, not an equivalent Hemnet field.

`src/scraper/hemnet.py` extracts SaleCards from the embedded Apollo cache and
assigns the requested district in `card_fields`. `_district_url` selects the
existing district location ID. These URL IDs describe the query, not an
independent per-card district assertion. Coordinates and street names cannot
safely supply such an assertion without additional boundary data, especially
on streets crossing district borders.

Decision: keep the existing district query and assignment. There is no
trustworthy district-name field in the available SaleCard evidence on which to
base a mismatch filter. This does **not** establish that every current live
Hemnet payload lacks such a field. A future offline capture with a documented
per-card district field can justify a filter and matching/mismatching fixture
tests; do not invent field names or reuse Booli's shape for Hemnet.
