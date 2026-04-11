"""
Travel Planner Module — FastAPI version
Converted from Flask. Integrates with existing FastAPI app via APIRouter.
Uses Gemini AI for plan generation with a smart demo fallback.
"""

import json, math, os, re
from typing import Optional
import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/travel", tags=["travel-planner"])

MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

POPULAR_DESTINATIONS = [
    "Paris", "Bali", "Tokyo", "Kyoto", "Osaka", "London", "Rome", "Barcelona", "Dubai",
    "Singapore", "Bangkok", "Phuket", "Istanbul", "New York", "Los Angeles", "Sydney",
    "Melbourne", "Zurich", "Amsterdam", "Prague", "Vienna", "Athens", "Santorini",
    "Seoul", "Hong Kong", "Kuala Lumpur", "Maldives", "Mauritius", "Iceland",
    "Kerala", "Goa", "Jaipur", "Udaipur", "Varanasi", "Manali", "Kashmir", "Ladakh",
    "Hyderabad", "Delhi", "Mumbai", "Chennai", "Kolkata", "Bengaluru", "Pune",
    "Hanoi", "Ho Chi Minh City", "Da Nang", "Hoi An", "Kathmandu", "Pokhara",
    "Paro", "Thimphu", "Thailand", "Japan", "France",
]

INDIAN_DESTINATIONS = {
    "hyderabad","delhi","mumbai","chennai","kolkata","bengaluru","pune",
    "goa","kerala","jaipur","udaipur","varanasi","manali","kashmir","ladakh",
}
SHORT_HAUL = {"dubai","maldives","bali","bangkok","phuket","singapore","kuala lumpur","thailand","mauritius","istanbul"}
LONG_HAUL  = {"tokyo","japan","paris","france","london","rome","barcelona","new york","los angeles","sydney","melbourne","zurich","amsterdam","prague","vienna","athens","seoul","hong kong","iceland"}

TRAVEL_SCHEMA = {
    "type": "object",
    "properties": {
        "destination":            {"type": "string"},
        "normalized_destination": {"type": "string"},
        "trip_summary":           {"type": "string"},
        "assumptions":            {"type": "array", "items": {"type": "string"}},
        "budget_options": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "plan_name":                    {"type": "string"},
                    "range_label":                  {"type": "string"},
                    "category":                     {"type": "string", "enum": ["budget","standard","premium"]},
                    "total_estimate_inr":            {"type": "integer"},
                    "flight_estimate_inr":           {"type": "integer"},
                    "accommodation_estimate_inr":    {"type": "integer"},
                    "transport_estimate_inr":        {"type": "integer"},
                    "airport_transfer_estimate_inr": {"type": "integer"},
                    "food_estimate_inr":             {"type": "integer"},
                    "activities_estimate_inr":       {"type": "integer"},
                    "visa_estimate_inr":             {"type": "integer"},
                    "taxes_fees_estimate_inr":       {"type": "integer"},
                    "misc_estimate_inr":             {"type": "integer"},
                    "best_for":                     {"type": "string"},
                    "optimization_tips":            {"type": "array","items":{"type":"string"}},
                    "itinerary": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "day_number":             {"type": "integer"},
                                "title":                  {"type": "string"},
                                "tourist_places":         {"type": "array","items":{"type":"string"}},
                                "transport_mode":         {"type": "string"},
                                "food_plan":              {"type": "string"},
                                "estimated_day_cost_inr": {"type": "integer"},
                                "summary":                {"type": "string"},
                            },
                        },
                    },
                },
            },
        },
    },
}


# ── Schemas ──────────────────────────────────────────────────────
class PlanRequest(BaseModel):
    destination:    str
    originCity:     str   = "Hyderabad"
    travelMonth:    str   = "December"
    days:           int   = 4
    travelers:      int   = 2
    tripType:       str   = "friends"
    includeFlights: bool  = True


# ── Helpers ──────────────────────────────────────────────────────
def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip()).title()

def nkey(text: str) -> str:
    return normalize(text).lower()

def bucket(dest: str) -> str:
    k = nkey(dest)
    if k in INDIAN_DESTINATIONS: return "domestic"
    if k in SHORT_HAUL:          return "short_haul"
    if k in LONG_HAUL:           return "long_haul"
    return "international"

def season_mult(month: str) -> float:
    m = nkey(month)
    if m in {"november","december","january","may"}:   return 1.15
    if m in {"april","june","july","august"}:           return 1.05
    return 1.0

def rooms(travelers: int, trip_type: str) -> int:
    return max(1, math.ceil(travelers / (3 if trip_type == "family" else 2)))

def plan_name(cat: str) -> str:
    return {"budget":"Economical Escape","standard":"Comfortable Journey","premium":"Luxury Indulgence"}[cat]

def best_for(cat: str, trip_type: str) -> str:
    base = trip_type.title()
    if cat == "budget":   return f"{base} travelers looking for value without missing key sights."
    if cat == "standard": return f"{base} travelers wanting a balanced trip with comfort and great experiences."
    return f"{base} travelers seeking premium stays, dining, and exclusive activities."

def flight_est(dest, origin, travelers, cat, month, include):
    if not include: return 0
    b = bucket(dest); s = season_mult(month)
    rates = {
        "domestic":      {"budget":6000,  "standard":10000, "premium":18000},
        "short_haul":    {"budget":25000, "standard":38000, "premium":65000},
        "long_haul":     {"budget":55000, "standard":85000, "premium":140000},
        "international": {"budget":35000, "standard":55000, "premium":90000},
    }
    total = rates[b][cat] * max(travelers,1) * s
    major = {"hyderabad","delhi","mumbai","chennai","bengaluru","kolkata","pune"}
    if nkey(origin) not in major and b != "domestic":
        total *= 1.25
    return int(total)

def visa_est(dest, travelers):
    b = bucket(dest); k = nkey(dest)
    if b == "domestic": return 0
    if k == "dubai":    return 7000 * max(travelers,1)
    if b == "short_haul": return 4500 * max(travelers,1)
    if b == "long_haul":  return 9000 * max(travelers,1)
    return 6000 * max(travelers,1)

SEED_PLACES = {
    "dubai":    ["Burj Khalifa","Dubai Mall","Dubai Fountain","Museum of the Future","Desert Safari","Dubai Marina","Palm Jumeirah","Al Fahidi Historical District"],
    "tokyo":    ["Shibuya Crossing","Senso-ji Temple","Tokyo Skytree","Meiji Shrine","Asakusa","Shinjuku","Odaiba","TeamLab Planets"],
    "bali":     ["Ubud","Tegallalang Rice Terraces","Tanah Lot Temple","Uluwatu Temple","Seminyak Beach","Nusa Dua","Ubud Palace","Kuta"],
    "paris":    ["Eiffel Tower","Louvre Museum","Seine River Cruise","Montmartre","Arc de Triomphe","Notre-Dame Area","Palace of Versailles","Champs-Élysées"],
    "goa":      ["Baga Beach","Calangute Beach","Fort Aguada","Anjuna","Old Goa Churches","Dudhsagar Falls","Candolim","Chapora Fort"],
    "maldives": ["Male City","Resort Island Lagoon","Sandbank Excursion","Sunset Cruise","Snorkeling Reef","Water Villa Area"],
    "singapore":["Marina Bay Sands","Gardens by the Bay","Sentosa Island","Orchard Road","Chinatown","Little India","Universal Studios","Clarke Quay"],
    "london":   ["Big Ben","Tower of London","Buckingham Palace","British Museum","Hyde Park","The Shard","Covent Garden","Oxford Street"],
    "bangkok":  ["Grand Palace","Wat Pho","Chatuchak Market","Khao San Road","Chao Phraya River","MBK Center","Lumphini Park","Wat Arun"],
}

DAY_TITLES = {
    "dubai":  ["Arrival & Iconic Landmarks","Desert Adventure & Culture","Modern Dubai & Marina","Shopping & Departure","Relaxed Exploration"],
    "tokyo":  ["Arrival & City Icons","Temples & Traditional Districts","Pop Culture & Skyline Views","Shopping & Departure","Leisure Exploration"],
    "bali":   ["Arrival & Rice Terraces","Temples & Spiritual Bali","Beach & Sunset Views","Adventure Day","Relaxed Departure"],
    "paris":  ["Arrival & Eiffel Tower","Louvre & Museums","Versailles Day Trip","Montmartre & Cafés","Shopping & Departure"],
}
DEFAULT_TITLES = ["Arrival & City Highlights","Major Attractions Day","Culture & Food Trail","Shopping & Departure","Flexible Exploration"]


def build_demo(dest, days, travelers, trip_type, origin, month, include_flights):
    norm = normalize(dest); k = nkey(dest); b = bucket(dest)
    nights = max(1, days-1); r = rooms(travelers, trip_type); s = season_mult(month)

    accom_rates = {
        "domestic":      {"budget":3500, "standard":6500,  "premium":14000},
        "short_haul":    {"budget":5000, "standard":9000,  "premium":18000},
        "long_haul":     {"budget":7000, "standard":13000, "premium":28000},
        "international": {"budget":6000, "standard":10000, "premium":21000},
    }
    transport_pd = {
        "domestic":      {"budget":1500, "standard":2500, "premium":4500},
        "short_haul":    {"budget":2500, "standard":4000, "premium":8000},
        "long_haul":     {"budget":3000, "standard":5000, "premium":9000},
        "international": {"budget":2500, "standard":4500, "premium":8500},
    }
    airport_tx = {
        "domestic":      {"budget":1200, "standard":2500,  "premium":5000},
        "short_haul":    {"budget":3500, "standard":6000,  "premium":12000},
        "long_haul":     {"budget":4500, "standard":7000,  "premium":15000},
        "international": {"budget":4000, "standard":6500,  "premium":13000},
    }
    food_ppd = {
        "domestic":      {"budget":1200, "standard":2200, "premium":4000},
        "short_haul":    {"budget":1800, "standard":3000, "premium":5500},
        "long_haul":     {"budget":2500, "standard":4000, "premium":7000},
        "international": {"budget":2000, "standard":3200, "premium":6000},
    }
    acts_ppd = {
        "domestic":      {"budget":1500, "standard":3000,  "premium":6000},
        "short_haul":    {"budget":3000, "standard":6000,  "premium":12000},
        "long_haul":     {"budget":4000, "standard":8000,  "premium":16000},
        "international": {"budget":3200, "standard":6500,  "premium":13000},
    }
    misc_base = {"budget":6000,"standard":9000,"premium":15000}

    places = SEED_PLACES.get(k, [
        f"{norm} City Center", f"Top Museum in {norm}", f"Popular Market in {norm}",
        f"Heritage Landmark in {norm}", f"Iconic Viewpoint in {norm}", f"Main Attraction in {norm}",
    ])
    titles = DAY_TITLES.get(k, DEFAULT_TITLES)

    transport_label = {
        "budget":   "Metro / public transport / shared cabs",
        "standard": "Metro + taxis / ride-hailing mix",
        "premium":  "Private cab / chauffeur / premium transfers",
    }
    food_label = {
        "budget":   "Local eateries and value-for-money cafes",
        "standard": "Good local restaurants with a few premium meals",
        "premium":  "Fine dining and premium restaurant experiences",
    }

    def make_option(cat):
        fl  = flight_est(dest, origin, travelers, cat, month, include_flights)
        ac  = int(accom_rates[b][cat] * nights * r * s)
        tr  = int(transport_pd[b][cat] * max(days,1) * s)
        at  = int(airport_tx[b][cat] * s)
        fo  = int(food_ppd[b][cat] * max(days,1) * max(travelers,1) * s)
        ac2 = int(acts_ppd[b][cat] * max(days,1) * max(travelers,1) * s)
        vi  = visa_est(dest, travelers)
        tx  = int(0.06*(fl+ac+ac2) + 0.02*fo)
        mi  = int(misc_base[cat] * s)
        total = fl+ac+tr+at+fo+ac2+vi+tx+mi

        day_weights = [1.05] + [1.0]*max(0,days-2) + [0.95]
        ws = sum(day_weights[:days])

        itinerary = []
        for i in range(days):
            p1 = places[i % len(places)]; p2 = places[(i+1) % len(places)]
            itinerary.append({
                "day_number": i+1,
                "title": titles[i % len(titles)],
                "tourist_places": [p1, p2],
                "transport_mode": transport_label[cat],
                "food_plan": food_label[cat],
                "estimated_day_cost_inr": int(total * (day_weights[i] / ws)),
                "summary": f"Visit {p1} and {p2} — {cat} {trip_type} plan in {norm}.",
            })

        low = int(total*0.92); high = int(total*1.10)
        return {
            "plan_name": plan_name(cat),
            "range_label": f"₹{low:,} – ₹{high:,}",
            "category": cat,
            "total_estimate_inr": total,
            "flight_estimate_inr": fl,
            "accommodation_estimate_inr": ac,
            "transport_estimate_inr": tr,
            "airport_transfer_estimate_inr": at,
            "food_estimate_inr": fo,
            "activities_estimate_inr": ac2,
            "visa_estimate_inr": vi,
            "taxes_fees_estimate_inr": tx,
            "misc_estimate_inr": mi,
            "best_for": best_for(cat, trip_type),
            "optimization_tips": [
                "Book flights and hotels early for better bundled pricing.",
                "Use combo attraction passes where available.",
                "Keep one light sightseeing day to reduce transport and meal spend.",
            ],
            "itinerary": itinerary,
        }

    fn = "included" if include_flights else "excluded"
    return {
        "destination": dest,
        "normalized_destination": norm,
        "trip_summary": f"This {days}-day {trip_type} trip to {norm}: hotels, food, local transport, activities, taxes/fees included. Flights are {fn}.",
        "assumptions": [
            f"Origin city: {normalize(origin)}.",
            f"Travel month: {normalize(month)}.",
            "All prices in INR — may vary by season, booking date, and preferences.",
            "Visa included for international destinations where applicable.",
        ],
        "budget_options": [make_option("budget"), make_option("standard"), make_option("premium")],
    }


async def call_gemini(req: PlanRequest) -> dict:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing GEMINI_API_KEY in environment")

    prompt = f"""
You are a travel planning engine for realistic trip budgeting.

Destination: {req.destination}
Origin city: {req.originCity}
Trip length: {req.days} days
Travelers: {req.travelers}
Trip type: {req.tripType}
Travel month: {req.travelMonth}
Include flights: {req.includeFlights}

Return exactly 3 budget options (budget, standard, premium) with:
- All cost components in INR integers
- Realistic amounts for the destination and traveler count
- Day-wise itinerary with real tourist attractions
- total_estimate_inr must be the sum of all components

Return only JSON matching the schema. Do not underestimate expensive destinations.
""".strip()

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL_NAME}:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "response_mime_type": "application/json",
            "response_json_schema": TRAVEL_SCHEMA,
        },
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text)


# ── Routes ────────────────────────────────────────────────────────

@router.get("/health")
def travel_health():
    return {"ok": True, "gemini_key_set": bool(os.getenv("GEMINI_API_KEY"))}


@router.get("/suggestions")
def suggestions(q: str = Query(default="")):
    q = q.strip().lower()
    if not q:
        return {"suggestions": POPULAR_DESTINATIONS[:10]}
    matches = [d for d in POPULAR_DESTINATIONS if q in d.lower()]
    return {"suggestions": matches[:10]}


@router.post("/generate-plan")
async def generate_plan(body: PlanRequest):
    if not body.destination.strip():
        raise HTTPException(status_code=400, detail="Destination is required")

    try:
        result = await call_gemini(body)
        result["source"] = "gemini"
        return result
    except Exception as e:
        err = str(e)
        demo = build_demo(
            dest=body.destination, days=body.days, travelers=body.travelers,
            trip_type=body.tripType, origin=body.originCity,
            month=body.travelMonth, include_flights=body.includeFlights,
        )
        demo["source"] = "demo"
        demo["fallback_reason"] = (
            "Gemini rate limit reached. Please wait and try again."
            if "429" in err or "RESOURCE_EXHAUSTED" in err
            else "Gemini API key not set or temporarily unavailable — showing estimated plan."
        )
        print("Gemini error:", err)
        return demo


# ════════════════════════════════════════════════════════════════
# RECOMMENDATIONS ENGINE
# ════════════════════════════════════════════════════════════════

from datetime import datetime
from collections import defaultdict
from typing import List

# In-memory store per session (keyed by a session_id the frontend sends)
_search_history: dict[str, list] = defaultdict(list)   # session_id -> list of plan requests
_plan_history:   dict[str, list] = defaultdict(list)   # session_id -> list of generated plans

# ── Destination metadata for recommendation engine ───────────────
DEST_META = {
    # key: { tags, region, budget_tier (1=cheapest,3=priciest), similar }
    "goa":          {"tags":["beach","party","nature"],      "region":"india",      "tier":1, "similar":["kerala","bali","phuket","maldives"]},
    "kerala":       {"tags":["nature","culture","backwater"],"region":"india",      "tier":1, "similar":["goa","vietnam","sri lanka","bali"]},
    "jaipur":       {"tags":["heritage","culture","desert"], "region":"india",      "tier":1, "similar":["udaipur","varanasi","delhi","agra"]},
    "udaipur":      {"tags":["heritage","romantic","lake"],  "region":"india",      "tier":1, "similar":["jaipur","varanasi","rajasthan"]},
    "manali":       {"tags":["adventure","snow","nature"],   "region":"india",      "tier":1, "similar":["kashmir","ladakh","himachal"]},
    "kashmir":      {"tags":["nature","snow","romantic"],    "region":"india",      "tier":1, "similar":["manali","ladakh","himachal"]},
    "ladakh":       {"tags":["adventure","desert","nature"], "region":"india",      "tier":1, "similar":["manali","kashmir","spiti"]},
    "bali":         {"tags":["beach","culture","nature"],    "region":"sea",        "tier":2, "similar":["phuket","goa","lombok","vietnam"]},
    "bangkok":      {"tags":["city","food","culture"],       "region":"sea",        "tier":1, "similar":["phuket","vietnam","kuala lumpur","singapore"]},
    "phuket":       {"tags":["beach","resort","party"],      "region":"sea",        "tier":2, "similar":["bali","maldives","krabi","samui"]},
    "singapore":    {"tags":["city","luxury","food"],        "region":"sea",        "tier":3, "similar":["hong kong","kuala lumpur","tokyo"]},
    "kuala lumpur": {"tags":["city","food","culture"],       "region":"sea",        "tier":1, "similar":["singapore","bangkok","jakarta"]},
    "maldives":     {"tags":["beach","luxury","romantic"],   "region":"indian_ocean","tier":3,"similar":["seychelles","mauritius","bali","phuket"]},
    "mauritius":    {"tags":["beach","romantic","nature"],   "region":"indian_ocean","tier":3,"similar":["maldives","bali","seychelles"]},
    "dubai":        {"tags":["luxury","shopping","city"],    "region":"middle_east","tier":3, "similar":["abu dhabi","singapore","doha"]},
    "istanbul":     {"tags":["culture","heritage","food"],   "region":"europe",     "tier":2, "similar":["athens","rome","prague","cairo"]},
    "paris":        {"tags":["romantic","culture","luxury"], "region":"europe",     "tier":3, "similar":["rome","barcelona","amsterdam","prague"]},
    "rome":         {"tags":["heritage","culture","food"],   "region":"europe",     "tier":3, "similar":["paris","barcelona","athens","florence"]},
    "barcelona":    {"tags":["beach","culture","food"],      "region":"europe",     "tier":3, "similar":["rome","madrid","lisbon","paris"]},
    "amsterdam":    {"tags":["culture","city","romantic"],   "region":"europe",     "tier":3, "similar":["brussels","paris","prague","berlin"]},
    "prague":       {"tags":["heritage","culture","budget"], "region":"europe",     "tier":2, "similar":["vienna","budapest","krakow","warsaw"]},
    "vienna":       {"tags":["culture","music","luxury"],    "region":"europe",     "tier":3, "similar":["prague","salzburg","budapest","munich"]},
    "zurich":       {"tags":["luxury","nature","city"],      "region":"europe",     "tier":3, "similar":["geneva","interlaken","munich","vienna"]},
    "iceland":      {"tags":["adventure","nature","aurora"], "region":"europe",     "tier":3, "similar":["norway","finland","greenland"]},
    "athens":       {"tags":["heritage","culture","food"],   "region":"europe",     "tier":2, "similar":["rome","istanbul","santorini","crete"]},
    "santorini":    {"tags":["romantic","beach","luxury"],   "region":"europe",     "tier":3, "similar":["mykonos","bali","maldives","capri"]},
    "tokyo":        {"tags":["city","culture","food"],       "region":"east_asia",  "tier":3, "similar":["kyoto","osaka","seoul","hong kong"]},
    "kyoto":        {"tags":["culture","heritage","nature"], "region":"east_asia",  "tier":2, "similar":["tokyo","osaka","nara","hiroshima"]},
    "osaka":        {"tags":["food","city","culture"],       "region":"east_asia",  "tier":2, "similar":["tokyo","kyoto","hiroshima","kobe"]},
    "seoul":        {"tags":["city","food","culture"],       "region":"east_asia",  "tier":2, "similar":["tokyo","hong kong","taipei","beijing"]},
    "hong kong":    {"tags":["city","luxury","food"],        "region":"east_asia",  "tier":3, "similar":["singapore","tokyo","shanghai","macau"]},
    "new york":     {"tags":["city","luxury","culture"],     "region":"americas",   "tier":3, "similar":["chicago","boston","washington dc","los angeles"]},
    "los angeles":  {"tags":["city","beach","entertainment"],"region":"americas",   "tier":3, "similar":["san francisco","las vegas","new york","miami"]},
    "sydney":       {"tags":["city","beach","nature"],       "region":"oceania",    "tier":3, "similar":["melbourne","auckland","fiji","brisbane"]},
    "kathmandu":    {"tags":["adventure","culture","nature"],"region":"south_asia", "tier":1, "similar":["pokhara","manali","ladakh","darjeeling"]},
    "pokhara":      {"tags":["adventure","nature","lake"],   "region":"south_asia", "tier":1, "similar":["kathmandu","manali","mussoorie"]},
    "hanoi":        {"tags":["culture","food","heritage"],   "region":"sea",        "tier":1, "similar":["ho chi minh city","hoi an","da nang","bangkok"]},
    "ho chi minh city":{"tags":["city","food","culture"],   "region":"sea",        "tier":1, "similar":["hanoi","phnom penh","bangkok","bali"]},
    "hoi an":       {"tags":["heritage","culture","beach"],  "region":"sea",        "tier":1, "similar":["hanoi","da nang","hue","bali"]},
}

# Budget tier mapping from plan category
BUDGET_TIER_MAP = {"budget": 1, "standard": 2, "premium": 3}

# Region groupings for variety
REGION_GROUPS = {
    "india":       ["goa","kerala","jaipur","udaipur","manali","kashmir","ladakh","varanasi","hampi","coorg"],
    "sea":         ["bali","bangkok","phuket","singapore","kuala lumpur","hanoi","ho chi minh city","hoi an","da nang","cambodia"],
    "middle_east": ["dubai","abu dhabi","muscat","doha","jordan"],
    "europe":      ["paris","rome","barcelona","amsterdam","prague","vienna","athens","santorini","istanbul","zurich","iceland","lisbon","london"],
    "east_asia":   ["tokyo","kyoto","osaka","seoul","hong kong","taipei","beijing","shanghai"],
    "americas":    ["new york","los angeles","cancun","rio de janeiro","buenos aires","machu picchu"],
    "oceania":     ["sydney","melbourne","new zealand","fiji","bora bora"],
    "south_asia":  ["kathmandu","pokhara","colombo","male","dhaka"],
    "indian_ocean":["maldives","mauritius","seychelles","reunion"],
}


class SearchHistoryItem(BaseModel):
    session_id: str
    destination: str
    days: int
    travelers: int
    trip_type: str
    budget_category: str   # "budget" | "standard" | "premium"
    include_flights: bool
    timestamp: Optional[str] = None


class RecommendRequest(BaseModel):
    session_id: str
    current_destination: Optional[str] = None
    days: Optional[int] = 4
    travelers: Optional[int] = 2
    trip_type: Optional[str] = "friends"
    preferred_budget: Optional[str] = "standard"  # budget|standard|premium


def _get_user_profile(session_id: str) -> dict:
    """Analyse search history to build a user preference profile."""
    history = _search_history.get(session_id, [])
    if not history:
        return {}

    tag_counts:    defaultdict = defaultdict(int)
    region_counts: defaultdict = defaultdict(int)
    tier_sum = 0
    type_counts:   defaultdict = defaultdict(int)
    visited = set()

    for item in history:
        key = item["destination"].lower()
        visited.add(key)
        meta = DEST_META.get(key, {})
        for tag in meta.get("tags", []):
            tag_counts[tag] += 1
        region = meta.get("region", "")
        if region:
            region_counts[region] += 1
        tier_sum += BUDGET_TIER_MAP.get(item.get("budget_category","standard"), 2)
        type_counts[item.get("trip_type","friends")] += 1

    avg_tier = tier_sum / len(history) if history else 2
    top_tags    = sorted(tag_counts,    key=lambda x: -tag_counts[x])[:3]
    top_regions = sorted(region_counts, key=lambda x: -region_counts[x])[:2]
    top_type    = max(type_counts, key=type_counts.get) if type_counts else "friends"

    return {
        "top_tags":    top_tags,
        "top_regions": top_regions,
        "avg_tier":    round(avg_tier, 1),
        "top_type":    top_type,
        "visited":     visited,
        "search_count": len(history),
    }


def _score_destination(dest_key: str, profile: dict, requested_tier: int, current_key: str) -> float:
    """Score a destination 0–100 based on how well it matches the profile."""
    if dest_key == current_key:
        return -1  # never recommend same destination
    if dest_key in profile.get("visited", set()):
        return -1  # already searched this

    meta = DEST_META.get(dest_key, {})
    score = 0.0

    # Tag match — up to 40 pts
    top_tags = profile.get("top_tags", [])
    dest_tags = meta.get("tags", [])
    tag_overlap = len(set(top_tags) & set(dest_tags))
    score += tag_overlap * (40 / max(len(top_tags), 1))

    # Region match — up to 25 pts
    top_regions = profile.get("top_regions", [])
    if meta.get("region") in top_regions:
        score += 25

    # Budget tier proximity — up to 20 pts
    dest_tier = meta.get("tier", 2)
    tier_diff = abs(dest_tier - requested_tier)
    score += max(0, 20 - tier_diff * 8)

    # Novelty bonus — up to 15 pts (prefer unexplored regions)
    if meta.get("region") not in top_regions:
        score += 8

    return score


def _budget_range_for_tier(tier: int, days: int, travelers: int) -> tuple:
    """Return (low, high) INR estimate for a tier."""
    per_person_per_day = {1: 4000, 2: 8000, 3: 15000}  # rough daily incl. all
    ppd = per_person_per_day[tier]
    base = ppd * days * travelers
    return int(base * 0.85), int(base * 1.20)


@router.post("/history/add")
def add_to_history(item: SearchHistoryItem):
    """Frontend calls this after each plan generation to track search."""
    item.timestamp = item.timestamp or datetime.utcnow().isoformat()
    _search_history[item.session_id].append(item.dict())
    # Keep last 20 searches per session
    if len(_search_history[item.session_id]) > 20:
        _search_history[item.session_id] = _search_history[item.session_id][-20:]
    return {"ok": True, "count": len(_search_history[item.session_id])}


@router.get("/history/{session_id}")
def get_history(session_id: str):
    return {
        "history": _search_history.get(session_id, []),
        "profile": _get_user_profile(session_id),
    }


@router.post("/recommendations")
def get_recommendations(body: RecommendRequest):
    """Return personalised destination recommendations with budget estimates."""
    profile   = _get_user_profile(body.session_id)
    req_tier  = BUDGET_TIER_MAP.get(body.preferred_budget or "standard", 2)
    current   = (body.current_destination or "").lower()

    # Score all known destinations
    scored = []
    for dest_key, meta in DEST_META.items():
        s = _score_destination(dest_key, profile, req_tier, current)
        if s >= 0:
            lo, hi = _budget_range_for_tier(meta.get("tier",2), body.days or 4, body.travelers or 2)
            scored.append({
                "destination":   dest_key.title(),
                "tags":          meta.get("tags", []),
                "region":        meta.get("region", "").replace("_"," ").title(),
                "budget_tier":   ["Budget","Standard","Premium"][meta.get("tier",2)-1],
                "est_low_inr":   lo,
                "est_high_inr":  hi,
                "match_score":   round(s, 1),
                "why":           _why_text(dest_key, profile, meta),
            })

    scored.sort(key=lambda x: -x["match_score"])

    # Return top 8, ensuring region diversity
    seen_regions = set()
    diverse = []
    for r in scored:
        reg = r["region"]
        if reg not in seen_regions or len(diverse) < 4:
            diverse.append(r)
            seen_regions.add(reg)
        if len(diverse) >= 8:
            break

    # If no history yet, return curated popular list
    if not profile:
        diverse = _default_recommendations(req_tier, body.days or 4, body.travelers or 2)

    return {
        "recommendations": diverse,
        "profile": profile,
        "based_on_searches": len(_search_history.get(body.session_id, [])),
    }


def _why_text(dest_key: str, profile: dict, meta: dict) -> str:
    """Generate a short human-readable reason for recommendation."""
    top_tags = profile.get("top_tags", [])
    shared = list(set(top_tags) & set(meta.get("tags", [])))
    if shared:
        return f"Matches your interest in {', '.join(shared[:2])} travel"
    if meta.get("region") in profile.get("top_regions", []):
        return f"Popular in {meta['region'].replace('_',' ').title()} — a region you love"
    tier = meta.get("tier", 2)
    tier_names = {1:"budget-friendly",2:"mid-range",3:"premium"}
    return f"A {tier_names[tier]} destination worth exploring"


def _default_recommendations(tier: int, days: int, travelers: int) -> list:
    """Curated recommendations when no history exists."""
    defaults = {
        1: ["goa","bali","bangkok","kerala","kathmandu","hanoi","jaipur","manali"],
        2: ["bali","prague","istanbul","kyoto","barcelona","hoi an","udaipur","phuket"],
        3: ["maldives","dubai","paris","tokyo","santorini","singapore","new york","zurich"],
    }
    picks = defaults.get(tier, defaults[2])
    result = []
    for d in picks:
        meta = DEST_META.get(d, {})
        lo, hi = _budget_range_for_tier(meta.get("tier", tier), days, travelers)
        result.append({
            "destination":  d.title(),
            "tags":         meta.get("tags", []),
            "region":       meta.get("region","").replace("_"," ").title(),
            "budget_tier":  ["Budget","Standard","Premium"][meta.get("tier",2)-1],
            "est_low_inr":  lo,
            "est_high_inr": hi,
            "match_score":  0,
            "why":          "Popular pick for your budget range",
        })
    return result