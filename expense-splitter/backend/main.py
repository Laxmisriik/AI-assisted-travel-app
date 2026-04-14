from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import uuid
from datetime import datetime

app = FastAPI(title="Expense Splitter API")

# ── Translator module ─────────────────────────────────────────────
from translator import router as translator_router
app.include_router(translator_router)
from travel_planner import router as travel_router 
app.include_router(travel_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory store ──────────────────────────────────────────────
groups: Dict[str, dict] = {}
expenses: Dict[str, dict] = {}
settlements: Dict[str, dict] = {}


# ── Schemas ──────────────────────────────────────────────────────
class GroupCreate(BaseModel):
    name: str
    members: List[str]

class MemberUpdate(BaseModel):
    member: str

class ExpenseCreate(BaseModel):
    group_id: str
    title: str
    amount: float
    paid_by: str

class SettlementCreate(BaseModel):
    group_id: str
    debtor: str
    creditor: str
    amount: float

class SettlementAction(BaseModel):
    action: str  # "pay" | "confirm"


# ── Helpers ──────────────────────────────────────────────────────
def calculate_balances(group_id: str):
    group = groups.get(group_id)
    if not group:
        return {}

    members = group["members"]
    paid: Dict[str, float] = {m: 0.0 for m in members}
    share: Dict[str, float] = {m: 0.0 for m in members}

    # Step 1: tally raw expense payments and equal shares
    for exp in expenses.values():
        if exp["group_id"] != group_id:
            continue
        n = len(members)
        each = exp["amount"] / n
        paid[exp["paid_by"]] += exp["amount"]
        for m in members:
            share[m] += each

    paid = {m: round(paid[m], 2) for m in members}
    share = {m: round(share[m], 2) for m in members}

    # Step 2: net = how much each person is owed (positive) or owes (negative)
    net = {m: round(paid[m] - share[m], 2) for m in members}

    # Step 3: only pending_confirmation settlements adjust net (in-progress payments).
    # Fully settled ones are already "done" — their effect is captured by
    # the real cash that changed hands, so we don't double-count them.
    # We only dim the balance for in-progress (pending_confirmation) settlements.
    for s in settlements.values():
        if s["group_id"] != group_id:
            continue
        if s["status"] != "pending_confirmation":
            continue
        net[s["debtor"]] = round(net[s["debtor"]] + s["amount"], 2)
        net[s["creditor"]] = round(net[s["creditor"]] - s["amount"], 2)

    return {"paid": paid, "share": share, "net": net}


def compute_who_owes_whom(group_id: str):
    bal = calculate_balances(group_id)
    if not bal:
        return []

    net = bal["net"].copy()
    # Use mutable dicts instead of tuples to avoid index-reassignment bugs
    debtors = [{"name": m, "amt": round(-v, 2)} for m, v in net.items() if v < -0.01]
    creditors = [{"name": m, "amt": round(v, 2)} for m, v in net.items() if v > 0.01]
    debtors.sort(key=lambda x: -x["amt"])
    creditors.sort(key=lambda x: -x["amt"])

    result = []
    i, j = 0, 0
    while i < len(debtors) and j < len(creditors):
        owe = debtors[i]["amt"]
        recv = creditors[j]["amt"]
        amount = round(min(owe, recv), 2)
        if amount > 0.01:
            result.append({
                "debtor": debtors[i]["name"],
                "creditor": creditors[j]["name"],
                "amount": amount
            })
        debtors[i]["amt"] = round(owe - amount, 2)
        creditors[j]["amt"] = round(recv - amount, 2)
        if debtors[i]["amt"] < 0.01:
            i += 1
        if creditors[j]["amt"] < 0.01:
            j += 1

    return result


# ── Routes ───────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"message": "Expense Splitter API running"}


# Groups
@app.post("/groups")
def create_group(body: GroupCreate):
    gid = str(uuid.uuid4())
    groups[gid] = {"id": gid, "name": body.name, "members": body.members, "created_at": datetime.utcnow().isoformat()}
    return groups[gid]

@app.get("/groups")
def list_groups():
    return list(groups.values())

@app.get("/groups/{gid}")
def get_group(gid: str):
    if gid not in groups:
        raise HTTPException(404, "Group not found")
    return groups[gid]

@app.post("/groups/{gid}/members")
def add_member(gid: str, body: MemberUpdate):
    if gid not in groups:
        raise HTTPException(404, "Group not found")
    if body.member not in groups[gid]["members"]:
        groups[gid]["members"].append(body.member)
    return groups[gid]

@app.delete("/groups/{gid}/members/{member}")
def remove_member(gid: str, member: str):
    if gid not in groups:
        raise HTTPException(404, "Group not found")
    groups[gid]["members"] = [m for m in groups[gid]["members"] if m != member]
    return groups[gid]


# Expenses
@app.post("/expenses")
def add_expense(body: ExpenseCreate):
    group = groups.get(body.group_id)
    if not group:
        raise HTTPException(404, "Group not found")
    if body.paid_by not in group["members"]:
        raise HTTPException(400, "Payer not in group")
    eid = str(uuid.uuid4())
    expenses[eid] = {
        "id": eid,
        "group_id": body.group_id,
        "title": body.title,
        "amount": body.amount,
        "paid_by": body.paid_by,
        "created_at": datetime.utcnow().isoformat()
    }
    return expenses[eid]

@app.get("/groups/{gid}/expenses")
def list_expenses(gid: str):
    return [e for e in expenses.values() if e["group_id"] == gid]

@app.delete("/expenses/{eid}")
def delete_expense(eid: str):
    if eid not in expenses:
        raise HTTPException(404, "Expense not found")
    del expenses[eid]
    return {"deleted": eid}


# Balances
@app.get("/groups/{gid}/balances")
def get_balances(gid: str):
    if gid not in groups:
        raise HTTPException(404, "Group not found")
    bal = calculate_balances(gid)

    # only exclude pairs that are currently mid-flow (pending_confirmation)
    # settled pairs are done — new expenses can create new debts between same people
    active_pairs = set(
        (s["debtor"], s["creditor"])
        for s in settlements.values()
        if s["group_id"] == gid and s["status"] == "pending_confirmation"
    )

    all_owes = compute_who_owes_whom(gid)
    owes = [o for o in all_owes if (o["debtor"], o["creditor"]) not in active_pairs]

    total = sum(e["amount"] for e in expenses.values() if e["group_id"] == gid)
    return {"balances": bal, "settlements_needed": owes, "total_expense": round(total, 2)}


# Settlements
@app.post("/settlements")
def create_settlement(body: SettlementCreate):
    # only block if there's already an active (in-progress) settlement for this pair
    # settled ones are done — new expenses can create fresh debts between same people
    for s in settlements.values():
        if (s["group_id"] == body.group_id and
                s["debtor"] == body.debtor and
                s["creditor"] == body.creditor and
                s["status"] == "pending_confirmation"):
            raise HTTPException(400, "Settlement already in progress for this pair")
    sid = str(uuid.uuid4())
    settlements[sid] = {
        "id": sid,
        "group_id": body.group_id,
        "debtor": body.debtor,
        "creditor": body.creditor,
        "amount": body.amount,
        "status": "pending_confirmation",  # creditor marks received → debtor confirms → settled
        "created_at": datetime.utcnow().isoformat(),
        "paid_at": None,
        "confirmed_at": None,
    }
    return settlements[sid]

@app.patch("/settlements/{sid}")
def update_settlement(sid: str, body: SettlementAction):
    if sid not in settlements:
        raise HTTPException(404, "Settlement not found")
    s = settlements[sid]
    if body.action == "confirm":
        if s["status"] != "pending_confirmation":
            raise HTTPException(400, "Can only confirm a pending_confirmation settlement")
        s["status"] = "settled"
        s["confirmed_at"] = datetime.utcnow().isoformat()
    else:
        raise HTTPException(400, "Unknown action")
    return s

@app.get("/groups/{gid}/settlements")
def list_settlements(gid: str):
    return [s for s in settlements.values() if s["group_id"] == gid]
