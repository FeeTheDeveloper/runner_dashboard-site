"""Entity lookup helpers."""

import json
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def load_entities(path=None):
    entities_path = Path(path) if path else DATA_DIR / "entities.json"
    with entities_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def get_entity(entity_name, entities=None):
    records = entities if entities is not None else load_entities()
    return next(entity for entity in records if entity["name"] == entity_name)
