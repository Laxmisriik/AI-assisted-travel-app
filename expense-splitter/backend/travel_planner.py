"""
Travel Planner Module — Comprehensive Worldwide Engine
Gemini-first: full_gemini_plan() is called for every request.
Offline engine is emergency fallback only.
"""

import json, math, os, re
from typing import Optional, List
import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime
from collections import defaultdict

# ── Router (MUST be defined before any @router decorators) ───────
router = APIRouter(prefix="/travel", tags=["travel-planner"])

# ── Schemas ──────────────────────────────────────────────────────
class PlanRequest(BaseModel):
    destination:    str
    originCity:     str  = "Hyderabad"
    travelMonth:    str  = "December"
    days:           int  = 4
    travelers:      int  = 2
    tripType:       str  = "friends"
    includeFlights: bool = True

class SearchHistoryItem(BaseModel):
    session_id:      str
    destination:     str
    days:            int
    travelers:       int
    trip_type:       str
    budget_category: str
    include_flights: bool
    timestamp:       Optional[str] = None

class RecommendRequest(BaseModel):
    session_id:           str
    current_destination:  Optional[str] = None
    days:                 Optional[int] = 4
    travelers:            Optional[int] = 2
    trip_type:            Optional[str] = "friends"
    preferred_budget:     Optional[str] = "standard"

# ── In-memory history store ───────────────────────────────────────
_search_history: dict = defaultdict(list)

# ── Helpers ───────────────────────────────────────────────────────
def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip()).title()

def nkey(text: str) -> str:
    return normalize(text).lower()

def fmt_inr(n: int) -> str:
    return f"₹{n:,}"

# ── World cost database ───────────────────────────────────────────
WORLD_COSTS = {
    "goa":           {"accom":(2000,4500,10000),"food":(800,1800,4000),"local":(600,1200,3000),"activities":(800,2000,5000),"tier":"domestic","currency":"INR","visa":0},
    "kerala":        {"accom":(1800,4000,9000), "food":(700,1500,3500),"local":(500,1000,2500),"activities":(700,1800,4500),"tier":"domestic","currency":"INR","visa":0},
    "jaipur":        {"accom":(1500,3500,8000), "food":(600,1400,3000),"local":(500,900,2000), "activities":(600,1500,4000),"tier":"domestic","currency":"INR","visa":0},
    "udaipur":       {"accom":(1800,4000,9500), "food":(700,1600,3500),"local":(500,1000,2500),"activities":(700,1800,4500),"tier":"domestic","currency":"INR","visa":0},
    "manali":        {"accom":(1200,3000,7000), "food":(600,1300,3000),"local":(600,1200,3000),"activities":(800,2000,5000),"tier":"domestic","currency":"INR","visa":0},
    "kashmir":       {"accom":(2000,4500,10000),"food":(700,1500,3500),"local":(600,1200,3000),"activities":(900,2200,5500),"tier":"domestic","currency":"INR","visa":0},
    "ladakh":        {"accom":(1500,3500,8000), "food":(700,1400,3000),"local":(800,1600,4000),"activities":(1000,2500,6000),"tier":"domestic","currency":"INR","visa":0},
    "varanasi":      {"accom":(1200,2800,6500), "food":(500,1200,2800),"local":(400,800,2000), "activities":(500,1200,3000),"tier":"domestic","currency":"INR","visa":0},
    "delhi":         {"accom":(1500,4000,9000), "food":(700,1600,3500),"local":(500,1000,2500),"activities":(600,1500,4000),"tier":"domestic","currency":"INR","visa":0},
    "mumbai":        {"accom":(2000,5000,12000),"food":(900,2000,5000),"local":(500,1200,3000),"activities":(700,1800,4500),"tier":"domestic","currency":"INR","visa":0},
    "hampi":         {"accom":(800,2000,5000),  "food":(500,1000,2500),"local":(400,800,2000), "activities":(500,1200,3000),"tier":"domestic","currency":"INR","visa":0},
    "andaman":       {"accom":(2500,5500,12000),"food":(900,2000,4500),"local":(700,1500,4000),"activities":(1200,3000,7000),"tier":"domestic","currency":"INR","visa":0},
    "coorg":         {"accom":(2000,4500,10000),"food":(700,1600,3500),"local":(500,1200,3000),"activities":(700,1800,4500),"tier":"domestic","currency":"INR","visa":0},
    "rishikesh":     {"accom":(1000,2500,6000), "food":(500,1100,2500),"local":(400,800,2000), "activities":(800,2000,5000),"tier":"domestic","currency":"INR","visa":0},
    "shimla":        {"accom":(1500,3500,8000), "food":(600,1400,3000),"local":(500,1000,2500),"activities":(600,1500,3500),"tier":"domestic","currency":"INR","visa":0},
    "bali":          {"accom":(2000,5000,15000),"food":(1000,2200,5500),"local":(800,1800,4500),"activities":(1500,4000,10000),"tier":"short_haul","currency":"IDR","visa":3000},
    "bangkok":       {"accom":(1500,4000,12000),"food":(900,2000,5000),"local":(700,1500,4000),"activities":(1200,3000,8000),"tier":"short_haul","currency":"THB","visa":0},
    "phuket":        {"accom":(2500,6000,18000),"food":(1200,2800,7000),"local":(900,2000,5000),"activities":(1800,4500,12000),"tier":"short_haul","currency":"THB","visa":0},
    "chiang mai":    {"accom":(1200,3000,9000), "food":(800,1800,4500),"local":(600,1400,3500),"activities":(1000,2500,7000),"tier":"short_haul","currency":"THB","visa":0},
    "singapore":     {"accom":(5000,10000,25000),"food":(2500,5000,12000),"local":(1000,2000,5000),"activities":(2000,5000,14000),"tier":"short_haul","currency":"SGD","visa":0},
    "kuala lumpur":  {"accom":(2000,5000,13000),"food":(1200,2500,6000),"local":(800,1800,4500),"activities":(1200,3000,8000),"tier":"short_haul","currency":"MYR","visa":0},
    "dubai":         {"accom":(5000,12000,30000),"food":(2500,5500,14000),"local":(1500,3000,8000),"activities":(2500,6000,16000),"tier":"short_haul","currency":"AED","visa":7000},
    "maldives":      {"accom":(8000,18000,50000),"food":(3000,7000,18000),"local":(2000,4500,12000),"activities":(3000,7000,20000),"tier":"short_haul","currency":"MVR","visa":0},
    "sri lanka":     {"accom":(2000,4500,12000),"food":(1000,2200,5500),"local":(700,1600,4000),"activities":(1200,3000,8000),"tier":"short_haul","currency":"LKR","visa":2500},
    "nepal":         {"accom":(1200,2800,8000), "food":(700,1600,4000),"local":(500,1200,3000),"activities":(1000,2500,7000),"tier":"short_haul","currency":"NPR","visa":2500},
    "istanbul":      {"accom":(2500,6000,16000),"food":(1200,2800,7000),"local":(800,1800,4500),"activities":(1200,3000,8000),"tier":"short_haul","currency":"TRY","visa":3500},
    "tokyo":         {"accom":(4000,9000,25000),"food":(2000,4500,12000),"local":(1200,2500,6000),"activities":(2000,5000,14000),"tier":"long_haul","currency":"JPY","visa":1500},
    "kyoto":         {"accom":(3500,8000,22000),"food":(1800,4000,11000),"local":(1000,2200,5500),"activities":(1800,4500,12000),"tier":"long_haul","currency":"JPY","visa":1500},
    "osaka":         {"accom":(3000,7000,20000),"food":(1800,4000,11000),"local":(1000,2200,5500),"activities":(1800,4500,12000),"tier":"long_haul","currency":"JPY","visa":1500},
    "seoul":         {"accom":(3000,7000,20000),"food":(1500,3500,9000),"local":(1000,2000,5000),"activities":(1500,4000,11000),"tier":"long_haul","currency":"KRW","visa":0},
    "paris":         {"accom":(6000,13000,35000),"food":(2800,6000,16000),"local":(1500,3000,7000),"activities":(2500,6000,16000),"tier":"long_haul","currency":"EUR","visa":9000},
    "london":        {"accom":(7000,15000,40000),"food":(3000,7000,18000),"local":(1800,3500,8000),"activities":(2500,6000,16000),"tier":"long_haul","currency":"GBP","visa":9000},
    "rome":          {"accom":(5000,11000,30000),"food":(2500,5500,14000),"local":(1200,2500,6000),"activities":(2000,5000,14000),"tier":"long_haul","currency":"EUR","visa":9000},
    "barcelona":     {"accom":(5000,11000,30000),"food":(2500,5500,14000),"local":(1200,2500,6000),"activities":(2000,5000,14000),"tier":"long_haul","currency":"EUR","visa":9000},
    "amsterdam":     {"accom":(5500,12000,32000),"food":(2800,6000,15000),"local":(1200,2500,6000),"activities":(2000,5000,14000),"tier":"long_haul","currency":"EUR","visa":9000},
    "prague":        {"accom":(3000,7000,20000),"food":(1500,3500,9000),"local":(800,1800,4500),"activities":(1500,3500,10000),"tier":"long_haul","currency":"CZK","visa":9000},
    "new york":      {"accom":(7000,16000,45000),"food":(3500,8000,20000),"local":(1500,3000,7000),"activities":(3000,7000,20000),"tier":"long_haul","currency":"USD","visa":15000},
    "sydney":        {"accom":(6000,13000,35000),"food":(3000,6500,17000),"local":(1500,3200,7500),"activities":(2500,6000,16000),"tier":"long_haul","currency":"AUD","visa":5000},
    "mauritius":     {"accom":(5000,12000,35000),"food":(2500,5500,14000),"local":(1500,3500,8000),"activities":(2000,5000,14000),"tier":"short_haul","currency":"MUR","visa":0},
    "cappadocia":    {"accom":(3500,8000,22000),"food":(1500,3500,9000),"local":(1000,2200,5500),"activities":(2000,5000,14000),"tier":"short_haul","currency":"TRY","visa":3500},
}

FLIGHT_COSTS = {
    "domestic":    {"budget":5000,  "standard":9000,  "premium":16000},
    "short_haul":  {"budget":22000, "standard":35000, "premium":60000},
    "long_haul":   {"budget":50000, "standard":80000, "premium":135000},
}

MAJOR_ORIGINS = {"hyderabad","delhi","mumbai","chennai","bengaluru","kolkata","pune","ahmedabad"}
PEAK_MONTHS   = {"november","december","january","may","june"}
SHOULDER_MONTHS = {"april","july","august","october"}

def season_mult(month: str) -> float:
    m = month.strip().lower()
    if m in PEAK_MONTHS:    return 1.18
    if m in SHOULDER_MONTHS: return 1.06
    return 1.0

def rooms_needed(travelers: int, trip_type: str) -> int:
    if trip_type == "family": return max(1, math.ceil(travelers / 3))
    return max(1, math.ceil(travelers / 2))

def get_costs(dest_key: str):
    if dest_key in WORLD_COSTS:
        return WORLD_COSTS[dest_key]
    return {
        "accom":(1500,3500,8000),"food":(600,1500,4000),
        "local":(500,1200,3000),"activities":(600,2000,5000),
        "tier":"domestic","currency":"INR","visa":0,
    }

def get_tier(dest_key: str) -> str:
    return get_costs(dest_key).get("tier", "domestic")

def get_visa(dest_key: str, travelers: int) -> int:
    return get_costs(dest_key).get("visa", 0) * max(travelers, 1)

def flight_cost(dest_key, origin, travelers, cat, month, include):
    if not include: return 0
    tier = get_tier(dest_key)
    base = FLIGHT_COSTS.get(tier, FLIGHT_COSTS["long_haul"])[cat]
    s = season_mult(month)
    total = base * max(travelers, 1) * s
    if nkey(origin) not in MAJOR_ORIGINS and tier != "domestic":
        total *= 1.22
    return int(total)

def airport_transfer(dest_key, cat, travelers):
    tier = get_tier(dest_key)
    base = {
        "domestic":   {"budget":900,  "standard":2000, "premium":4000},
        "short_haul": {"budget":2500, "standard":5000, "premium":10000},
        "long_haul":  {"budget":3500, "standard":6500, "premium":14000},
    }
    return base.get(tier, base["long_haul"])[cat]

def taxes_fees(flight, accom, activities):
    return int(0.05 * (flight + accom) + 0.03 * activities)

def build_plan(req: PlanRequest) -> dict:
    dest = req.destination.strip()
    norm = normalize(dest)
    k = nkey(dest)
    days = max(1, req.days)
    travelers = max(1, req.travelers)
    trip_type = req.tripType
    origin = req.originCity
    month = req.travelMonth
    include_flights = req.includeFlights

    costs = get_costs(k)
    tier = costs.get("tier", "domestic")
    nights = max(1, days - 1)
    r = rooms_needed(travelers, trip_type)
    s = season_mult(month)

    def make_option(cat: str, idx: int) -> dict:
        accom = int(costs["accom"][idx] * nights * r * s)
        food = int(costs["food"][idx] * days * travelers * s)
        local_tr = int(costs["local"][idx] * days * s)
        activities = int(costs["activities"][idx] * days * travelers * s)
        fl = flight_cost(k, origin, travelers, cat, month, include_flights)
        at = airport_transfer(k, cat, travelers) * 2
        vi = get_visa(k, travelers)
        tx = taxes_fees(fl, accom, activities)
        misc = int({"budget":4000,"standard":7000,"premium":12000}[cat] * max(travelers/2,1) * s)
        total = fl + accom + food + local_tr + activities + at + vi + tx + misc

        itinerary = []
        for i in range(days):
            if i == 0:
                summary = f"Arrive in {norm} and explore nearby highlights."
            elif i == days - 1:
                summary = f"Morning at leisure and depart from {norm}."
            else:
                summary = f"Full exploration day in {norm}."
            itinerary.append({
                "day_number": i + 1,
                "title": f"Day {i+1} in {norm}",
                "tourist_places": [f"Top attraction {i+1}", f"Local site {i+1}"],
                "transport_mode": {"budget":"Public transport","standard":"Metro + Uber","premium":"Private cab"}[cat],
                "food_plan": {"budget":"Street food","standard":"Local restaurants","premium":"Fine dining"}[cat],
                "estimated_day_cost_inr": int(total / days),
                "summary": summary,
            })

        return {
            "plan_name": {"budget":"Economical Escape","standard":"Comfortable Journey","premium":"Luxury Indulgence"}[cat],
            "range_label": f"₹{int(total*0.9):,} – ₹{int(total*1.13):,}",
            "category": cat,
            "total_estimate_inr": total,
            "flight_estimate_inr": fl,
            "accommodation_estimate_inr": accom,
            "transport_estimate_inr": local_tr,
            "airport_transfer_estimate_inr": at,
            "food_estimate_inr": food,
            "activities_estimate_inr": activities,
            "visa_estimate_inr": vi,
            "taxes_fees_estimate_inr": tx,
            "misc_estimate_inr": misc,
            "per_person_estimate": int(total / travelers),
            "per_day_estimate": int(total / days),
            "best_for": f"{trip_type.title()} travellers on a {cat} budget.",
            "optimization_tips": ["Book flights 6–8 weeks early", "Use local transport cards", "Eat where locals eat"],
            "itinerary": itinerary,
        }

    m = nkey(month)
    season_note = ""
    if m in PEAK_MONTHS: season_note = f" Note: {month} is peak season — book early!"
    elif m in SHOULDER_MONTHS: season_note = f" {month} offers good shoulder-season value."

    fn = "included" if include_flights else f"excluded (add ₹{flight_cost(k, origin, travelers, 'standard', month, True):,} for flights)"

    return {
        "destination": dest,
        "normalized_destination": norm,
        "trip_summary": f"{days}-day {trip_type} trip to {norm}. Flights {fn}.{season_note}",
        "source": "offline",
        "local_currency": costs.get("currency", "INR"),
        "assumptions": [
            f"Origin: {normalize(origin)}.",
            f"Travel month: {normalize(month)} — seasonal pricing applied.",
            f"Accommodation: {r} room(s) for {travelers} traveller(s), {nights} nights.",
            "All prices in INR. Actual costs may vary ±15%.",
        ],
        "budget_options": [
            make_option("budget", 0),
            make_option("standard", 1),
            make_option("premium", 2),
        ],
    }

# ── Gemini schema ─────────────────────────────────────────────────
GEMINI_FULL_SCHEMA = {
    "type": "object",
    "properties": {
        "destination":            {"type": "string"},
        "normalized_destination": {"type": "string"},
        "trip_summary":           {"type": "string"},
        "local_currency":         {"type": "string"},
        "best_time_insight":      {"type": "string"},
        "hidden_gems":            {"type": "array", "items": {"type": "string"}},
        "local_foods":            {"type": "array", "items": {"type": "string"}},
        "assumptions":            {"type": "array", "items": {"type": "string"}},
        "budget_options": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "plan_name":                    {"type": "string"},
                    "range_label":                  {"type": "string"},
                    "category":                     {"type": "string"},
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
                    "per_person_estimate":           {"type": "integer"},
                    "per_day_estimate":              {"type": "integer"},
                    "best_for":                     {"type": "string"},
                    "optimization_tips":            {"type": "array", "items": {"type": "string"}},
                    "itinerary": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "day_number":             {"type": "integer"},
                                "title":                  {"type": "string"},
                                "tourist_places":         {"type": "array", "items": {"type": "string"}},
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

async def full_gemini_plan(req: PlanRequest) -> dict:
    from dotenv import load_dotenv
    load_dotenv()

    print("🚀 ENTERED GEMINI FUNCTION")

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    print("🔑 API KEY FROM PYTHON:", api_key)

    if not api_key:
        raise RuntimeError("❌ GEMINI_API_KEY is missing")

    model = os.getenv("GEMINI_MODEL") or "gemini-2.0-flash-lite"

    url = f"https://generativelanguage.googleapis.com/v1/models/{model}:generateContent"

    print("🌐 URL:", url)

    prompt = f"""
Generate a travel plan for:
Destination: {req.destination}
Days: {req.days}
Travellers: {req.travelers}
Return only JSON.
"""

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.4,
            "response_mime_type": "application/json"
        }
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                url,
                params={"key": api_key},   # ✅ FIXED (no string URL issues)
                json=payload
            )

            print("📡 STATUS:", resp.status_code)
            print("📦 RAW RESPONSE:", resp.text)

            resp.raise_for_status()

            data = resp.json()

            # ✅ Extract text safely
            text = data["candidates"][0]["content"]["parts"][0]["text"]

            print("🧠 GEMINI TEXT:", text)

            result = json.loads(text)

    except Exception as e:
        print("❌ GEMINI ERROR:", str(e))
        raise e

    result["source"] = "gemini"
    result["ai_enhanced"] = True

    return result
# ── Merge helper ──────────────────────────────────────────────────
def _merge_offline_fields(gemini_plan: dict, offline_plan: dict) -> dict:
    for key, val in offline_plan.items():
        if key not in gemini_plan or gemini_plan[key] is None:
            gemini_plan[key] = val

    for g_opt, o_opt in zip(
        gemini_plan.get("budget_options", []),
        offline_plan.get("budget_options", []),
    ):
        for field in (
            "per_person_estimate", "per_day_estimate",
            "airport_transfer_estimate_inr", "taxes_fees_estimate_inr",
            "misc_estimate_inr", "optimization_tips", "best_for",
        ):
            if not g_opt.get(field):
                g_opt[field] = o_opt.get(field)

        g_days = g_opt.get("itinerary", [])
        o_days = o_opt.get("itinerary", [])
        if len(g_days) < len(o_days):
            g_opt["itinerary"] = g_days + o_days[len(g_days):]

    return gemini_plan

# ── Popular destinations list ─────────────────────────────────────
POPULAR_DESTINATIONS = sorted([
    "Goa","Kerala","Jaipur","Udaipur","Manali","Kashmir","Ladakh","Varanasi","Delhi","Mumbai",
    "Andaman","Coorg","Rishikesh","Shimla","Hampi","Bali","Bangkok","Phuket","Chiang Mai",
    "Singapore","Kuala Lumpur","Hanoi","Ho Chi Minh City","Siem Reap","Nepal","Kathmandu",
    "Sri Lanka","Maldives","Dubai","Istanbul","Mauritius","Tokyo","Kyoto","Osaka","Seoul",
    "Paris","London","Rome","Barcelona","Amsterdam","Prague","New York","Sydney","Cappadocia",
])

# ── Routes ────────────────────────────────────────────────────────

@router.get("/health")
def travel_health():
    return {"ok": True, "destinations_supported": len(WORLD_COSTS)}

@router.get("/suggestions")
def suggestions(q: str = Query(default="")):
    q = q.strip().lower()
    if not q:
        return {"suggestions": POPULAR_DESTINATIONS[:12]}
    prefix   = [d for d in POPULAR_DESTINATIONS if d.lower().startswith(q)]
    contains = [d for d in POPULAR_DESTINATIONS if q in d.lower() and d not in prefix]
    return {"suggestions": (prefix + contains)[:12]}

@router.post("/generate-plan")
async def generate_plan(body: PlanRequest):
    if not body.destination.strip():
        raise HTTPException(status_code=400, detail="Destination is required")

    api_key = os.getenv("GEMINI_API_KEY", "").strip()

    if api_key:
        try:
            plan = await full_gemini_plan(body)
            offline = build_plan(body)
            plan = _merge_offline_fields(plan, offline)
            plan["source"] = "gemini"
            plan["ai_enhanced"] = True
            return plan
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"[travel] Gemini failed, falling back to offline: {e}")

    try:
        plan = build_plan(body)
        plan["source"] = "offline"
        plan["ai_enhanced"] = False
        plan["note"] = (
            "Set GEMINI_API_KEY for AI-powered plans."
            if not api_key else
            "AI generation failed. Showing offline estimates."
        )
        return plan
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# ── History ───────────────────────────────────────────────────────
@router.post("/history/add")
def add_history(item: SearchHistoryItem):
    item.timestamp = item.timestamp or datetime.utcnow().isoformat()
    _search_history[item.session_id].append(item.dict())
    if len(_search_history[item.session_id]) > 20:
        _search_history[item.session_id] = _search_history[item.session_id][-20:]
    return {"ok": True, "count": len(_search_history[item.session_id])}

@router.get("/history/{session_id}")
def get_history(session_id: str):
    return {"history": _search_history.get(session_id, [])}

@router.post("/recommendations")
def get_recommendations(body: RecommendRequest):
    return {"recommendations": [], "note": "Recommendations available after search history builds up."}