"""Core credit evaluation helpers."""


def evaluate_tier(entity):
    score = entity["paydex"]
    tradelines = entity["tradelines"]

    if tradelines < 3:
        return "tier_1"
    if tradelines < 6:
        return "tier_2"
    if score >= 75:
        return "tier_3"
    return "tier_4"
