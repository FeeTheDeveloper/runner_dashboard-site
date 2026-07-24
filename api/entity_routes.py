"""Entity API helpers."""

from core.entity_manager.registry import get_entity, load_entities


def get_entity_details(entity_name):
    entities = load_entities()
    return get_entity(entity_name, entities)
