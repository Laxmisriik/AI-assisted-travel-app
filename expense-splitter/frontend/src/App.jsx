import { useState, useEffect, useCallback, useRef } from "react";
import { get, post, patch, del } from "./utils/api";
import Translator from "./components/translator/Translator";
import TravelPlanner from "./components/travel/TravelPlanner";

// ── tiny helpers ────────────────────────────────────────────────
const fmt = (n) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clsx = (...c) => c.filter(Boolean).join(" ");

// ── status meta ─────────────────────────────────────────────────
const STATUS = {
  pending_payment: { label: "Marked Received – Awaiting Debtor", color: "#f59e0b", icon: "💰" },
  pending_confirmation: { label: "Pending Debtor Confirmation", color: "#6366f1", icon: "⏳" },
  settled: { label: "Fully Settled", color: "#10b981", icon: "✅" },
};

// ── category icons ───────────────────────────────────────────────
const CATS = ["🍔 Food", "✈️ Travel", "🏨 Stay", "🎉 Fun", "🛒 Shopping", "⚡ Utility", "💊 Medical", "🎬 Movies"];

export default function App() {
  const [groups, setGroups] = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [balances, setBalances] = useState(null);
  const [settlements, setSettlements] = useState([]);
  const [view, setView] = useState("groups"); // groups | expenses | balances | settle
  const [page, setPage] = useState("expenses"); // expenses | translator | travel
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null); // null | "group" | "expense" | "member"

  // forms
  const [gForm, setGForm] = useState({ name: "", membersRaw: "" });
  const [eForm, setEForm] = useState({ title: "", amount: "", paid_by: "" });
  const [memberInput, setMemberInput] = useState("");
  const [activeUser, setActiveUser] = useState(""); // simulated logged-in user

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── loaders ─────────────────────────────────────────────────
  const loadGroups = useCallback(async () => {
    try { setGroups(await get("/groups")); } catch {}
  }, []);

  const loadGroup = useCallback(async (gid) => {
    setLoading(true);
    try {
      const [exp, bal, set] = await Promise.all([
        get(`/groups/${gid}/expenses`),
        get(`/groups/${gid}/balances`),
        get(`/groups/${gid}/settlements`),
      ]);
      setExpenses(exp);
      setBalances(bal);
      setSettlements(set);
    } catch (e) { showToast(e.message, "error"); }
    setLoading(false);
  }, []);

  const pollRef = useRef(null);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  // auto-refresh active group every 5s so balances/settlements stay in sync across all tabs
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (activeGroup) {
      loadGroup(activeGroup.id);
      pollRef.current = setInterval(() => loadGroup(activeGroup.id), 5000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeGroup?.id]);

  // ── group actions ────────────────────────────────────────────
  async function createGroup() {
    const members = gForm.membersRaw.split(",").map(m => m.trim()).filter(Boolean);
    if (!gForm.name || members.length < 2) return showToast("Need a name & ≥2 members", "error");
    try {
      const g = await post("/groups", { name: gForm.name, members });
      setGroups(prev => [...prev, g]);
      setGForm({ name: "", membersRaw: "" });
      setModal(null);
      showToast(`Group "${g.name}" created!`);
    } catch (e) { showToast(e.message, "error"); }
  }

  async function addMember() {
    if (!memberInput.trim()) return;
    try {
      const g = await post(`/groups/${activeGroup.id}/members`, { member: memberInput.trim() });
      setActiveGroup(g);
      setMemberInput("");
      setModal(null);
      showToast("Member added");
      loadGroup(g.id);
    } catch (e) { showToast(e.message, "error"); }
  }

  async function removeMember(m) {
    try {
      const g = await del(`/groups/${activeGroup.id}/members/${m}`);
      setActiveGroup(g);
      loadGroup(g.id);
      showToast("Member removed");
    } catch (e) { showToast(e.message, "error"); }
  }

  // ── expense actions ──────────────────────────────────────────
  async function addExpense() {
    const { title, amount, paid_by } = eForm;
    if (!title || !amount || !paid_by) return showToast("Fill all fields", "error");
    try {
      await post("/expenses", { group_id: activeGroup.id, title, amount: parseFloat(amount), paid_by });
      setEForm({ title: "", amount: "", paid_by: "" });
      setModal(null);
      showToast("Expense added!");
      loadGroup(activeGroup.id);
    } catch (e) { showToast(e.message, "error"); }
  }

  async function deleteExpense(eid) {
    try {
      await del(`/expenses/${eid}`);
      showToast("Expense removed");
      loadGroup(activeGroup.id);
    } catch (e) { showToast(e.message, "error"); }
  }

  // ── settlement actions ───────────────────────────────────────
  async function initiateSettlement(item) {
    try {
      await post("/settlements", { group_id: activeGroup.id, ...item });
      showToast("Marked as received! Ask the debtor to confirm payment.");
      loadGroup(activeGroup.id);
    } catch (e) { showToast(e.message, "error"); }
  }

  async function settlementAction(sid, action) {
    try {
      await patch(`/settlements/${sid}`, { action });
      showToast(action === "pay" ? "Marked as received — waiting for debtor confirmation" : "Confirmed! Settlement complete ✅");
      loadGroup(activeGroup.id);
    } catch (e) { showToast(e.message, "error"); }
  }

  // ── render helpers ───────────────────────────────────────────
  const settledSettlements = settlements.filter(s => s.status === "settled");
  const inProgressSettlements = settlements.filter(s => s.status === "pending_confirmation" || s.status === "pending_payment");
  // backend already filters out active/settled pairs — this is the clean list
  const owes = balances?.settlements_needed || [];

  // already has a settlement record for a pair?
  const getSettlement = (debtor, creditor) =>
    settlements.find(s => s.debtor === debtor && s.creditor === creditor && s.status !== "settled");

  // pairs mid-flow: receiver marked, waiting for debtor to confirm
  const awaitingConfirmation = inProgressSettlements;

  return (
    <div style={styles.root}>
      {/* ── top nav: module switcher ── */}
      <div style={styles.topNav}>
        <button style={{...styles.topNavBtn, ...(page==="expenses" ? styles.topNavActive : {})}}
          onClick={() => setPage("expenses")}>
          💸 Expense Splitter
        </button>
        <button style={{...styles.topNavBtn, ...(page==="translator" ? styles.topNavActive : {})}}
          onClick={() => setPage("translator")}>
          🌐 Travel Translator
        </button>
        <button style={{...styles.topNavBtn, ...(page==="travel" ? styles.topNavActive : {})}}
          onClick={() => setPage("travel")}>
          ✈️ Trip Planner
        </button>
      </div>

      {page === "translator" && <Translator />}
      {page === "travel" && <TravelPlanner />}

      {page === "expenses" && (
      <div style={styles.expensesWrapper}>
      {/* ── bg decoration ── */}
      <div style={styles.bgBlob1} />
      <div style={styles.bgBlob2} />

      {/* ── toast ── */}
      {toast && (
        <div style={{ ...styles.toast, background: toast.type === "error" ? "#ef4444" : "#10b981" }}>
          {toast.type === "error" ? "⚠️" : "✓"} {toast.msg}
        </div>
      )}

      {/* ── sidebar ── */}
      <aside style={styles.sidebar}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>₹</span>
          <div>
            <div style={styles.logoTitle}>SplitMate</div>
            <div style={styles.logoSub}>Group Expense Tracker</div>
          </div>
        </div>

        {activeGroup && (
          <>
            <div style={styles.activeGroupCard}>
              <div style={styles.agLabel}>ACTIVE GROUP</div>
              <div style={styles.agName}>{activeGroup.name}</div>
              <div style={styles.agMeta}>{activeGroup.members.length} members · {fmt(balances?.total_expense || 0)} total</div>
            </div>

            {/* simulate active user */}
            <div style={styles.userBox}>
              <div style={styles.userLabel}>Viewing as:</div>
              <select
                style={styles.select}
                value={activeUser}
                onChange={e => setActiveUser(e.target.value)}
              >
                <option value="">— Select user —</option>
                {activeGroup.members.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>

            <nav style={styles.nav}>
              {[
                ["expenses", "💳", "Expenses"],
                ["balances", "⚖️", "Balances"],
                ["settle", "🤝", "Settlements", owes.length + awaitingConfirmation.length],
              ].map(([v, icon, label, badge]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  style={{ ...styles.navBtn, ...(view === v ? styles.navBtnActive : {}) }}
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                  {badge > 0 && <span style={styles.badge}>{badge}</span>}
                </button>
              ))}
            </nav>
          </>
        )}

        <button style={styles.backBtn} onClick={() => { setActiveGroup(null); setView("groups"); }}>
          ← All Groups
        </button>
      </aside>

      {/* ── main ── */}
      <main style={styles.main}>

        {/* ══ GROUPS VIEW ══ */}
        {view === "groups" && (
          <section style={styles.section}>
            <div style={styles.sectionHeader}>
              <div>
                <h1 style={styles.h1}>Your Groups</h1>
                <p style={styles.sub}>Select a group or create a new one</p>
              </div>
              <button style={styles.btnPrimary} onClick={() => setModal("group")}>+ New Group</button>
            </div>

            {groups.length === 0 ? (
              <div style={styles.empty}>
                <div style={{ fontSize: 56 }}>🌍</div>
                <div style={styles.emptyTitle}>No groups yet</div>
                <div style={styles.emptySub}>Create your first trip group!</div>
              </div>
            ) : (
              <div style={styles.grid}>
                {groups.map(g => (
                  <div key={g.id} style={styles.groupCard} onClick={() => { setActiveGroup(g); setView("expenses"); }}>
                    <div style={styles.gcIcon}>{["🏖️", "🏔️", "🌆", "🚗"][g.name.length % 4]}</div>
                    <div style={styles.gcName}>{g.name}</div>
                    <div style={styles.gcMeta}>{g.members.join(", ")}</div>
                    <div style={styles.gcFooter}>
                      <span style={styles.gcCount}>{g.members.length} members</span>
                      <span style={styles.gcArrow}>→</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ══ EXPENSES VIEW ══ */}
        {view === "expenses" && activeGroup && (
          <section style={styles.section}>
            <div style={styles.sectionHeader}>
              <div>
                <h1 style={styles.h1}>Expenses</h1>
                <p style={styles.sub}>{expenses.length} expenses · {fmt(balances?.total_expense || 0)} total</p>
              </div>
              <button style={styles.btnPrimary} onClick={() => setModal("expense")}>+ Add Expense</button>
            </div>

            {/* members strip */}
            <div style={styles.memberStrip}>
              {activeGroup.members.map(m => (
                <div key={m} style={styles.memberPill}>
                  <span style={styles.memberAvatar}>{m[0].toUpperCase()}</span>
                  <span>{m}</span>
                  <button style={styles.memberRemove} onClick={() => removeMember(m)}>×</button>
                </div>
              ))}
              <button style={styles.addMemberBtn} onClick={() => setModal("member")}>+ Add</button>
            </div>

            {expenses.length === 0 ? (
              <div style={styles.empty}>
                <div style={{ fontSize: 56 }}>🧾</div>
                <div style={styles.emptyTitle}>No expenses yet</div>
              </div>
            ) : (
              <div style={styles.expList}>
                {expenses.map(e => {
                  const perPerson = e.amount / activeGroup.members.length;
                  return (
                    <div key={e.id} style={styles.expCard}>
                      <div style={styles.expLeft}>
                        <div style={styles.expIcon}>{e.title.split(" ")[0]}</div>
                        <div>
                          <div style={styles.expTitle}>{e.title}</div>
                          <div style={styles.expMeta}>Paid by <b>{e.paid_by}</b> · {new Date(e.created_at).toLocaleDateString()}</div>
                          <div style={styles.expShare}>₹{perPerson.toFixed(2)} per person</div>
                        </div>
                      </div>
                      <div style={styles.expRight}>
                        <div style={styles.expAmount}>{fmt(e.amount)}</div>
                        <button style={styles.delBtn} onClick={() => deleteExpense(e.id)}>🗑</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ══ BALANCES VIEW ══ */}
        {view === "balances" && activeGroup && balances && (
          <section style={styles.section}>
            <h1 style={styles.h1}>Balance Sheet</h1>
            <p style={styles.sub}>Total group spend: <b>{fmt(balances.total_expense)}</b> · <span style={{color:"#10b981", fontSize:12}}>🟢 Live</span></p>

            <div style={styles.grid}>
              {activeGroup.members.map(m => {
                const net = balances.balances.net?.[m] || 0;
                const paid = balances.balances.paid?.[m] || 0;
                const share = balances.balances.share?.[m] || 0;
                const isPos = net >= 0;
                return (
                  <div key={m} style={styles.balCard}>
                    <div style={styles.balAvatar}>{m[0].toUpperCase()}</div>
                    <div style={styles.balName}>{m}</div>
                    <div style={styles.balRow}><span>Total Paid</span><b>{fmt(paid)}</b></div>
                    <div style={styles.balRow}><span>Fair Share</span><b>{fmt(share)}</b></div>
                    <div style={{ ...styles.balNet, color: isPos ? "#10b981" : "#ef4444" }}>
                      {net === 0
                        ? <span style={{color:"#10b981"}}>✅ Settled</span>
                        : isPos
                          ? `Gets back ${fmt(net)}`
                          : `Still owes ${fmt(Math.abs(net))}`}
                    </div>
                  </div>
                );
              })}
            </div>

            <h2 style={styles.h2}>Who Owes Whom</h2>
            {owes.length === 0 ? (
              <div style={styles.allSettled}>🎉 All settled up!</div>
            ) : (
              <div style={styles.oweList}>
                {owes.map((o, i) => {
                  const s = getSettlement(o.debtor, o.creditor);
                  const isInProgress = s && s.status === "pending_confirmation";
                  return (
                    <div key={i} style={{...styles.oweCard, opacity: isInProgress ? 0.5 : 1, position:"relative"}}>
                      <div style={styles.oweFlow}>
                        <span style={styles.owePerson}>{o.debtor}</span>
                        <div style={styles.oweArrow}>
                          <span style={styles.oweAmount}>{fmt(o.amount)}</span>
                          <div>→</div>
                        </div>
                        <span style={styles.owePerson}>{o.creditor}</span>
                      </div>
                      <div style={styles.oweLabel}>
                        {isInProgress
                          ? <span style={{color:"#f59e0b"}}>⏳ Payment in progress — awaiting {o.debtor}'s confirmation</span>
                          : <>{o.debtor} owes {o.creditor}</>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ══ SETTLEMENTS VIEW ══ */}
        {view === "settle" && activeGroup && (
          <section style={styles.section}>
            <h1 style={styles.h1}>Settlements</h1>
            <p style={styles.sub}>Initiate and confirm payments between members</p>

            {/* Step 1 — creditor marks received */}
            {owes.length > 0 && (
              <>
                <h2 style={styles.h2}>💸 Pending Settlements</h2>
                <p style={{...styles.sub, marginBottom: 12}}>Select <b>Dharshana</b> (or the receiver) to mark as received once payment is done.</p>
                <div style={styles.oweList}>
                  {owes.map((o, i) => (
                    <div key={i} style={styles.settleCard}>
                      <div style={styles.oweFlow}>
                        <span style={styles.owePerson}>{o.debtor}</span>
                        <div style={styles.oweArrow}>
                          <span style={styles.oweAmount}>{fmt(o.amount)}</span>
                          <div>→</div>
                        </div>
                        <span style={styles.owePerson}>{o.creditor}</span>
                      </div>
                      <div style={styles.settleActions}>
                        {activeUser === o.creditor ? (
                          <button style={styles.btnPay} onClick={() => initiateSettlement(o)}>
                            💰 Mark as Received
                          </button>
                        ) : activeUser === o.debtor ? (
                          <span style={styles.hintText}>
                            💸 Pay {o.creditor} {fmt(o.amount)}, then ask them to mark received
                          </span>
                        ) : (
                          <span style={styles.hintText}>{o.debtor} owes {o.creditor}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Step 2 — debtor confirms */}
            {awaitingConfirmation.length > 0 && (
              <>
                <h2 style={{...styles.h2, color:"#f59e0b"}}>⏳ Awaiting Your Confirmation</h2>
                <p style={{...styles.sub, marginBottom: 12}}>The receiver has marked these as received. The debtor must now confirm they paid.</p>
                <div style={styles.oweList}>
                  {awaitingConfirmation.map(s => (
                    <div key={s.id} style={{...styles.settleCard, border:"1px solid #f59e0b40", background:"#f59e0b08"}}>
                      <div style={styles.oweFlow}>
                        <span style={styles.owePerson}>{s.debtor}</span>
                        <div style={styles.oweArrow}>
                          <span style={styles.oweAmount}>{fmt(s.amount)}</span>
                          <div>→</div>
                        </div>
                        <span style={styles.owePerson}>{s.creditor}</span>
                      </div>
                      <div style={styles.settleActions}>
                        {activeUser === s.debtor ? (
                          <button style={styles.btnConfirm} onClick={() => settlementAction(s.id, "confirm")}>
                            ✅ Yes, I Paid
                          </button>
                        ) : (
                          <span style={{...styles.hintText, color:"#f59e0b"}}>
                            ⏳ Waiting for {s.debtor} to confirm
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {owes.length === 0 && awaitingConfirmation.length === 0 && (
              <div style={styles.allSettled}>🎉 All settled up!</div>
            )}

            {/* settlement history */}
            <h2 style={styles.h2}>Settlement History</h2>
            {settlements.length === 0 ? (
              <div style={styles.empty}><div style={{ fontSize: 40 }}>🤝</div><div>No settlements yet</div></div>
            ) : (
              <div style={styles.histList}>
                {settlements.map(s => {
                  const meta = STATUS[s.status];
                  return (
                    <div key={s.id} style={styles.histCard}>
                      <div style={styles.histLeft}>
                        <span style={{ fontSize: 24 }}>{meta.icon}</span>
                        <div>
                          <div style={styles.histDesc}>
                            <b>{s.debtor}</b> → <b>{s.creditor}</b>
                          </div>
                          <div style={styles.histMeta}>
                            {new Date(s.created_at).toLocaleDateString()}
                            {s.confirmed_at && ` · Confirmed ${new Date(s.confirmed_at).toLocaleDateString()}`}
                          </div>
                        </div>
                      </div>
                      <div style={styles.histRight}>
                        <div style={styles.histAmount}>{fmt(s.amount)}</div>
                        <div style={{ ...styles.histStatus, color: meta.color }}>{meta.label}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      {/* ══ MODALS ══ */}
      {modal && (
        <div style={styles.overlay} onClick={() => setModal(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>

            {modal === "group" && (
              <>
                <div style={styles.modalTitle}>🌍 Create New Group</div>
                <input style={styles.input} placeholder="Group name (e.g. Goa Trip)" value={gForm.name}
                  onChange={e => setGForm(p => ({ ...p, name: e.target.value }))} />
                <input style={styles.input} placeholder="Members (comma separated: Alice, Bob, Carol)"
                  value={gForm.membersRaw} onChange={e => setGForm(p => ({ ...p, membersRaw: e.target.value }))} />
                <div style={styles.modalActions}>
                  <button style={styles.btnGhost} onClick={() => setModal(null)}>Cancel</button>
                  <button style={styles.btnPrimary} onClick={createGroup}>Create Group</button>
                </div>
              </>
            )}

            {modal === "expense" && (
              <>
                <div style={styles.modalTitle}>💳 Add Expense</div>
                <div style={styles.catGrid}>
                  {CATS.map(c => (
                    <button key={c} style={{ ...styles.catBtn, ...(eForm.title === c ? styles.catBtnActive : {}) }}
                      onClick={() => setEForm(p => ({ ...p, title: c }))}>
                      {c}
                    </button>
                  ))}
                </div>
                <input style={styles.input} placeholder="Or custom title" value={eForm.title}
                  onChange={e => setEForm(p => ({ ...p, title: e.target.value }))} />
                <input style={styles.input} placeholder="Amount (₹)" type="number" value={eForm.amount}
                  onChange={e => setEForm(p => ({ ...p, amount: e.target.value }))} />
                <select style={styles.select} value={eForm.paid_by}
                  onChange={e => setEForm(p => ({ ...p, paid_by: e.target.value }))}>
                  <option value="">Paid by...</option>
                  {activeGroup?.members.map(m => <option key={m}>{m}</option>)}
                </select>
                {eForm.amount && activeGroup && (
                  <div style={styles.splitPreview}>
                    Split: {fmt(parseFloat(eForm.amount || 0) / activeGroup.members.length)} per person
                    among {activeGroup.members.length} members
                  </div>
                )}
                <div style={styles.modalActions}>
                  <button style={styles.btnGhost} onClick={() => setModal(null)}>Cancel</button>
                  <button style={styles.btnPrimary} onClick={addExpense}>Add Expense</button>
                </div>
              </>
            )}

            {modal === "member" && (
              <>
                <div style={styles.modalTitle}>👤 Add Member</div>
                <input style={styles.input} placeholder="Member name" value={memberInput}
                  onChange={e => setMemberInput(e.target.value)} />
                <div style={styles.modalActions}>
                  <button style={styles.btnGhost} onClick={() => setModal(null)}>Cancel</button>
                  <button style={styles.btnPrimary} onClick={addMember}>Add</button>
                </div>
              </>
            )}

          </div>
        </div>
      )}
      </div>
      )}
    </div>
  );
}

// ── STYLES ────────────────────────────────────────────────────────
const styles = {
  topNav: {
    display: "flex", gap: 0,
    background: "#0d0d1a",
    borderBottom: "2px solid #ffffff08",
    position: "sticky", top: 0, zIndex: 50,
  },
  topNavBtn: {
    flex: 1, padding: "14px 20px", border: "none",
    background: "transparent", color: "#8888a0",
    cursor: "pointer", fontSize: 14, fontWeight: 700,
    letterSpacing: "0.3px", transition: "all .2s",
    borderBottom: "2px solid transparent",
  },
  topNavActive: {
    color: "#e8e8f0", borderBottom: "2px solid #06b6d4",
    background: "#06b6d408",
  },
  topNavDivider: { width:"0.5px", background:"#ffffff10", flexShrink:0 },
  expensesWrapper: { display: "flex", flex: 1, flexDirection: "row", minHeight: 0, overflow: "hidden" },
  root: {
    display: "flex",
    flexDirection: "column",
    minHeight: "100vh",
    background: "#0a0a0f",
    color: "#e8e8f0",
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    position: "relative",
  },
  bgBlob1: {
    position: "fixed", top: -120, right: -120, width: 500, height: 500,
    borderRadius: "50%", background: "radial-gradient(circle, #6366f140 0%, transparent 70%)",
    pointerEvents: "none", zIndex: 0,
  },
  bgBlob2: {
    position: "fixed", bottom: -80, left: 100, width: 400, height: 400,
    borderRadius: "50%", background: "radial-gradient(circle, #10b98120 0%, transparent 70%)",
    pointerEvents: "none", zIndex: 0,
  },
  toast: {
    position: "fixed", top: 20, right: 20, zIndex: 9999,
    padding: "12px 20px", borderRadius: 12, color: "#fff",
    fontWeight: 600, fontSize: 14, boxShadow: "0 4px 20px #0008",
    animation: "fadeIn .2s ease",
  },
  // ── sidebar ──
  sidebar: {
    width: 260, flexShrink: 0, background: "#12121a",
    borderRight: "1px solid #ffffff0f", padding: "24px 16px",
    display: "flex", flexDirection: "column", gap: 16,
    position: "relative", zIndex: 1,
  },
  logo: { display: "flex", alignItems: "center", gap: 12, padding: "0 8px 16px", borderBottom: "1px solid #ffffff0f" },
  logoIcon: {
    width: 44, height: 44, borderRadius: 12,
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 22, fontWeight: 800, flexShrink: 0,
  },
  logoTitle: { fontWeight: 800, fontSize: 18, letterSpacing: "-0.5px" },
  logoSub: { fontSize: 11, color: "#8888a0" },
  activeGroupCard: {
    background: "linear-gradient(135deg, #6366f118, #8b5cf612)",
    border: "1px solid #6366f130", borderRadius: 12, padding: 14,
  },
  agLabel: { fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: "#6366f1", marginBottom: 4 },
  agName: { fontWeight: 700, fontSize: 16 },
  agMeta: { fontSize: 12, color: "#8888a0", marginTop: 4 },
  userBox: { display: "flex", flexDirection: "column", gap: 6 },
  userLabel: { fontSize: 11, color: "#8888a0", fontWeight: 600 },
  nav: { display: "flex", flexDirection: "column", gap: 4 },
  navBtn: {
    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
    borderRadius: 10, background: "transparent", border: "none",
    color: "#8888a0", cursor: "pointer", fontSize: 14, fontWeight: 500,
    transition: "all .15s", position: "relative",
  },
  navBtnActive: { background: "#6366f120", color: "#c4b5fd" },
  badge: {
    marginLeft: "auto", background: "#ef4444", color: "#fff",
    borderRadius: 20, fontSize: 11, fontWeight: 700,
    padding: "1px 7px", minWidth: 20, textAlign: "center",
  },
  backBtn: {
    marginTop: "auto", padding: "10px 12px", borderRadius: 10,
    background: "transparent", border: "1px solid #ffffff0f",
    color: "#8888a0", cursor: "pointer", fontSize: 13,
    transition: "all .15s",
  },
  select: {
    width: "100%", padding: "10px 12px", borderRadius: 10,
    background: "#1e1e2e", border: "1px solid #ffffff10",
    color: "#e8e8f0", fontSize: 14, outline: "none", cursor: "pointer",
  },
  // ── main ──
  main: { flex: 1, padding: "32px 40px", overflowY: "auto", position: "relative", zIndex: 1 },
  section: { maxWidth: 900, margin: "0 auto" },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 },
  h1: { fontSize: 32, fontWeight: 800, letterSpacing: "-1px", margin: 0 },
  h2: { fontSize: 20, fontWeight: 700, margin: "32px 0 16px", color: "#c4b5fd" },
  sub: { color: "#8888a0", fontSize: 14, marginTop: 4 },
  // ── grid & cards ──
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 },
  groupCard: {
    background: "#16161f", border: "1px solid #ffffff0a", borderRadius: 16,
    padding: "24px 20px", cursor: "pointer",
    transition: "transform .2s, border-color .2s",
  },
  gcIcon: { fontSize: 36, marginBottom: 12 },
  gcName: { fontWeight: 700, fontSize: 18, marginBottom: 6 },
  gcMeta: { fontSize: 12, color: "#8888a0", marginBottom: 16 },
  gcFooter: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  gcCount: {
    fontSize: 11, fontWeight: 700, background: "#6366f120",
    color: "#a5b4fc", padding: "3px 8px", borderRadius: 20,
  },
  gcArrow: { color: "#6366f1", fontWeight: 700, fontSize: 18 },
  // ── member strip ──
  memberStrip: {
    display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24,
    padding: 16, background: "#16161f", borderRadius: 12, border: "1px solid #ffffff0a",
  },
  memberPill: {
    display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
    background: "#1e1e2e", borderRadius: 20, fontSize: 13,
  },
  memberAvatar: {
    width: 24, height: 24, borderRadius: "50%",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 12, fontWeight: 700, color: "#fff",
  },
  memberRemove: {
    background: "none", border: "none", color: "#ef4444",
    cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1,
  },
  addMemberBtn: {
    padding: "6px 14px", borderRadius: 20, background: "transparent",
    border: "1px dashed #6366f160", color: "#6366f1",
    cursor: "pointer", fontSize: 13, fontWeight: 600,
  },
  // ── expense list ──
  expList: { display: "flex", flexDirection: "column", gap: 12 },
  expCard: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    background: "#16161f", border: "1px solid #ffffff0a", borderRadius: 14,
    padding: "16px 20px", transition: "border-color .2s",
  },
  expLeft: { display: "flex", alignItems: "center", gap: 16 },
  expIcon: {
    width: 48, height: 48, borderRadius: 12,
    background: "#1e1e2e", display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 24, flexShrink: 0,
  },
  expTitle: { fontWeight: 600, fontSize: 16, marginBottom: 2 },
  expMeta: { fontSize: 12, color: "#8888a0" },
  expShare: { fontSize: 12, color: "#6366f1", fontWeight: 600, marginTop: 2 },
  expRight: { display: "flex", alignItems: "center", gap: 16 },
  expAmount: { fontWeight: 800, fontSize: 20, letterSpacing: "-0.5px" },
  delBtn: { background: "none", border: "none", cursor: "pointer", fontSize: 18, opacity: 0.5 },
  // ── balance cards ──
  balCard: {
    background: "#16161f", border: "1px solid #ffffff0a", borderRadius: 16,
    padding: "20px", textAlign: "center",
  },
  balAvatar: {
    width: 52, height: 52, borderRadius: "50%",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 22, fontWeight: 800,
  },
  balName: { fontWeight: 700, fontSize: 16, marginBottom: 12 },
  balRow: {
    display: "flex", justifyContent: "space-between",
    fontSize: 13, color: "#8888a0", marginBottom: 6,
  },
  balNet: { fontWeight: 700, fontSize: 14, marginTop: 12, paddingTop: 12, borderTop: "1px solid #ffffff0a" },
  // ── owe cards ──
  oweList: { display: "flex", flexDirection: "column", gap: 12 },
  oweCard: {
    background: "#16161f", border: "1px solid #ffffff0a", borderRadius: 14,
    padding: "16px 20px",
  },
  settleCard: {
    background: "#16161f", border: "1px solid #ffffff0a", borderRadius: 14,
    padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  oweFlow: { display: "flex", alignItems: "center", gap: 16, marginBottom: 6 },
  owePerson: { fontWeight: 700, fontSize: 16 },
  oweArrow: {
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: 2, color: "#6366f1", flexShrink: 0,
  },
  oweAmount: { fontWeight: 800, fontSize: 14, color: "#ef4444" },
  oweLabel: { fontSize: 12, color: "#8888a0" },
  allSettled: {
    textAlign: "center", padding: "40px", fontSize: 18, fontWeight: 700,
    color: "#10b981", background: "#10b98110", borderRadius: 16,
  },
  settleActions: { display: "flex", alignItems: "center" },
  hintText: { fontSize: 12, color: "#8888a0", fontStyle: "italic" },
  // ── settlement history ──
  histList: { display: "flex", flexDirection: "column", gap: 10 },
  histCard: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    background: "#16161f", border: "1px solid #ffffff0a", borderRadius: 12, padding: "14px 18px",
  },
  histLeft: { display: "flex", alignItems: "center", gap: 14 },
  histDesc: { fontWeight: 600, fontSize: 14 },
  histMeta: { fontSize: 12, color: "#8888a0", marginTop: 2 },
  histRight: { textAlign: "right" },
  histAmount: { fontWeight: 700, fontSize: 16 },
  histStatus: { fontSize: 12, fontWeight: 600, marginTop: 4 },
  // ── empty ──
  empty: { textAlign: "center", padding: "60px 20px", color: "#8888a0" },
  emptyTitle: { fontWeight: 700, fontSize: 18, marginTop: 16, color: "#e8e8f0" },
  emptySub: { fontSize: 14, marginTop: 6 },
  // ── buttons ──
  btnPrimary: {
    padding: "10px 20px", borderRadius: 10, border: "none",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
    boxShadow: "0 4px 15px #6366f140",
  },
  btnGhost: {
    padding: "10px 20px", borderRadius: 10, border: "1px solid #ffffff10",
    background: "transparent", color: "#8888a0", fontWeight: 600, fontSize: 14, cursor: "pointer",
  },
  btnPay: {
    padding: "8px 16px", borderRadius: 8, border: "none",
    background: "linear-gradient(135deg, #f59e0b, #ef4444)",
    color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
  },
  btnConfirm: {
    padding: "8px 16px", borderRadius: 8, border: "none",
    background: "linear-gradient(135deg, #10b981, #059669)",
    color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
  },
  // ── modal ──
  overlay: {
    position: "fixed", inset: 0, background: "#00000080",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 100, backdropFilter: "blur(4px)",
  },
  modal: {
    background: "#16161f", border: "1px solid #ffffff10",
    borderRadius: 20, padding: 28, width: 420, maxWidth: "90vw",
    display: "flex", flexDirection: "column", gap: 14,
  },
  modalTitle: { fontWeight: 800, fontSize: 20, marginBottom: 4 },
  modalActions: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 },
  input: {
    width: "100%", padding: "11px 14px", borderRadius: 10,
    background: "#1e1e2e", border: "1px solid #ffffff10",
    color: "#e8e8f0", fontSize: 14, outline: "none", boxSizing: "border-box",
  },
  catGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  catBtn: {
    padding: "8px 12px", borderRadius: 8, border: "1px solid #ffffff10",
    background: "#1e1e2e", color: "#e8e8f0", cursor: "pointer", fontSize: 13,
    textAlign: "left", transition: "all .15s",
  },
  catBtnActive: { border: "1px solid #6366f1", background: "#6366f120", color: "#a5b4fc" },
  splitPreview: {
    padding: "10px 14px", borderRadius: 10, background: "#6366f110",
    border: "1px solid #6366f130", fontSize: 13, color: "#a5b4fc", fontWeight: 600,
  },
};