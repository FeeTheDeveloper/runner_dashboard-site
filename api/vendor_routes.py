"""Vendor recommendation API helpers."""

from core.agent_layer.credit_agent import CreditAgent
from core.entity_manager.registry import get_entity, load_entities
from core.vendor_stack.catalog import load_vendor_catalog


def get_recommendations(entity_name):
    entities = load_entities()
    vendors = load_vendor_catalog()

    entity = get_entity(entity_name, entities)

    agent = CreditAgent(entity)

    return {
        "tier": agent.evaluate_tier(),
        "vendors": agent.recommend_vendors(vendors),
        "strategy": agent.funding_strategy(),
    }
