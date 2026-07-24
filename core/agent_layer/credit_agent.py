"""Credit agent used to evaluate entities and recommend vendors."""


class CreditAgent:
    def __init__(self, entity_profile):
        self.entity = entity_profile

    def evaluate_tier(self):
        score = self.entity["paydex"]
        tradelines = self.entity["tradelines"]

        if tradelines < 3:
            return "tier_1"
        elif tradelines < 6:
            return "tier_2"
        elif score >= 75:
            return "tier_3"
        else:
            return "tier_4"

    def recommend_vendors(self, vendor_data):
        tier = self.evaluate_tier()
        return vendor_data[tier]

    def funding_strategy(self):
        if self.entity["revenue"] > 50000:
            return "Apply for Amex + Chase"
        return "Build more tradelines"
