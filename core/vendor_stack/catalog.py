"""Vendor recommendation helpers."""

import json
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def load_vendor_catalog(path=None):
    catalog_path = Path(path) if path else DATA_DIR / "vendors.json"
    with catalog_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)
