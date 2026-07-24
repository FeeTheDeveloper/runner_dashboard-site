"""Credit API helpers."""

from core.agent_layer.credit_agent import CreditAgent
from core.funding_strategy.strategy import evaluate_growth


def get_credit_profile(entity):
    agent = CreditAgent(entity)
    return {
        "tier": agent.evaluate_tier(),
        "strategy": agent.funding_strategy(),
        "growth": evaluate_growth(entity),
    }
