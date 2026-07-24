"""Funding strategy recommendations."""


def evaluate_growth(entity):
    if entity["paydex"] >= 75 and entity["tradelines"] >= 5:
        return "Upgrade to Tier 3"
    if entity["revenue"] >= 100000:
        return "Push Tier 4 funding"
    return "Maintain current tier"
