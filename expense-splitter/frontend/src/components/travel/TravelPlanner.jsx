import { useState, useRef, useEffect, useCallback } from "react";
import { get, post } from "../../utils/api";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const TRIP_TYPES = [
  { value:"solo",    icon:"🧍", label:"Solo" },
  { value:"couple",  icon:"👫", label:"Couple" },
  { value:"friends", icon:"👯", label:"Friends" },
  { value:"family",  icon:"👨‍👩‍👧‍👦", label:"Family" },
];

const fmt    = (n) => `₹${Number(n).toLocaleString("en-IN")}`;
const fmtK   = (n) => n >= 100000 ? `₹${(n/100000).toFixed(1)}L` : `₹${(n/1000).toFixed(0)}K`;
const CAT_COLOR = { budget:"#059669", standard:"#2563eb", premium:"#7c3aed" };
const CAT_BG    = { budget:"var(--color-background-success)", standard:"var(--color-background-info)", premium:"#f5f3ff" };
const TIER_COLOR= { Budget:"#059669", Standard:"#2563eb", Premium:"#7c3aed" };
const TAG_ICONS = { beach:"🏖️", nature:"🌿", culture:"🏛️", food:"🍜", adventure:"🧗", luxury:"💎", city:"🏙️", romantic:"❤️", heritage:"🏰", party:"🎉", shopping:"🛍️", snow:"❄️", desert:"🏜️", lake:"🏞️", aurora:"🌌", music:"🎵", backwater:"🚤", resort:"🏨" };

// Stable session ID for this browser session
const SESSION_ID = `sess_${Math.random().toString(36).slice(2,10)}`;

export default function TravelPlanner() {
  const [form, setForm] = useState({
    destination:"", originCity:"Hyderabad", travelMonth:"December",
    days:4, travelers:2, tripType:"friends", includeFlights:true,
  });
  const [suggestions, setSuggestions] = useState([]);
  const [showSug, setShowSug]         = useState(false);
  const [plan, setPlan]               = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [activeTab, setTab]           = useState(1);
  const [activeDay, setDay]           = useState(null);
  const [recs, setRecs]               = useState([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [history, setHistory]         = useState([]);
  const [rightTab, setRightTab]       = useState("plan"); // plan | recs | history
  const [profile, setProfile]         = useState(null);

  function setF(k, v) { setForm(p => ({ ...p, [k]: v })); }

  // Load recommendations on mount and when preferences change
  const loadRecs = useCallback(async (overrides = {}) => {
    setRecsLoading(true);
    try {
      const r = await post("/travel/recommendations", {
        session_id:          SESSION_ID,
        current_destination: form.destination || null,
        days:                form.days,
        travelers:           form.travelers,
        trip_type:           form.tripType,
        preferred_budget:    overrides.budget || "standard",
        ...overrides,
      });
      setRecs(r.recommendations || []);
      setProfile(r.profile || null);
    } catch {}
    setRecsLoading(false);
  }, [form.destination, form.days, form.travelers, form.tripType]);

  useEffect(() => { loadRecs(); }, []);

  async function fetchSuggestions(q) {
    if (!q) { setSuggestions([]); return; }
    try {
      const r = await get(`/travel/suggestions?q=${encodeURIComponent(q)}`);
      setSuggestions(r.suggestions || []);
    } catch {}
  }

  async function loadHistory() {
    try {
      const r = await get(`/travel/history/${SESSION_ID}`);
      setHistory(r.history || []);
      setProfile(r.profile || null);
    } catch {}
  }

  async function generate() {
    if (!form.destination.trim()) { setError("Please enter a destination."); return; }
    setError(null); setPlan(null); setLoading(true); setTab(1); setDay(null); setRightTab("plan");
    try {
      const result = await post("/travel/generate-plan", form);
      setPlan(result);
      // Track in history
      const category = result.budget_options?.[1]?.category || "standard";
      await post("/travel/history/add", {
        session_id:      SESSION_ID,
        destination:     form.destination,
        days:            form.days,
        travelers:       form.travelers,
        trip_type:       form.tripType,
        budget_category: category,
        include_flights: form.includeFlights,
      });
      // Refresh recommendations based on updated history
      loadRecs({ budget: category });
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  const option = plan?.budget_options?.[activeTab];
  const costRows = option ? [
    { label:"✈️  Flights",          val: option.flight_estimate_inr },
    { label:"🏨  Accommodation",    val: option.accommodation_estimate_inr },
    { label:"🚌  Local Transport",  val: option.transport_estimate_inr },
    { label:"🛬  Airport Transfer", val: option.airport_transfer_estimate_inr },
    { label:"🍽️  Food",             val: option.food_estimate_inr },
    { label:"🎭  Activities",       val: option.activities_estimate_inr },
    { label:"🛂  Visa",             val: option.visa_estimate_inr },
    { label:"📋  Taxes & Fees",     val: option.taxes_fees_estimate_inr },
    { label:"💼  Miscellaneous",    val: option.misc_estimate_inr },
  ] : [];

  return (
    <div style={S.page}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%,100%{opacity:.6}50%{opacity:1}}
        .tp-tab:hover{background:var(--color-background-secondary)!important}
        .tp-gen:hover:not(:disabled){opacity:.88!important}
        .tp-sug:hover{background:var(--color-background-secondary)!important;cursor:pointer}
        .tp-day:hover{background:var(--color-background-secondary)!important}
        .tp-opt:hover{border-color:#94a3b8!important}
        .tp-rec:hover{border-color:#1a73e8!important;transform:translateY(-1px)}
        .tp-rtab:hover{color:var(--color-text-primary)!important}
        .tp-hist:hover{background:var(--color-background-secondary)!important}
      `}</style>

      {/* ── HEADER ── */}
      <div style={S.hdr}>
        <div style={S.hdrLeft}>
          <div style={S.hdrIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 17l9-13 9 13"/><path d="M3 17h18"/></svg>
          </div>
          <div>
            <div style={S.hdrTitle}>Trip Budget Planner</div>
            <div style={S.hdrSub}>AI-powered cost estimation · Personalised recommendations</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {plan && (
            <div style={{
              ...S.demoBadge,
              ...(plan.source === "gemini"
                ? { background:"var(--color-background-success)", color:"var(--color-text-success)", border:"0.5px solid var(--color-border-success)" }
                : plan.ai_enhanced
                  ? { background:"var(--color-background-info)", color:"var(--color-text-info)", border:"0.5px solid var(--color-border-info)" }
                  : { background:"var(--color-background-secondary)", color:"var(--color-text-tertiary)", border:"0.5px solid var(--color-border-tertiary)" }
              )
            }}>
              {plan.source === "gemini"
                ? "✦ Full AI Plan by Gemini"
                : plan.ai_enhanced
                  ? "✦ AI Enhanced by Gemini"
                  : plan.note
                    ? "⚠ Unknown destination — regional estimate"
                    : "✦ Optimised offline estimate"}
            </div>
          )}
          {profile?.search_count > 0 && (
            <div style={S.histBadge}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              {profile.search_count} searches tracked
            </div>
          )}
        </div>
      </div>

      <div style={S.body}>
        {/* ═══ LEFT: form ═══ */}
        <div style={S.left}>
          <div style={S.section}>
            <div style={S.sLabel}>Destination</div>
            <div style={{ position:"relative" }}>
              <input style={S.input} placeholder="e.g. Dubai, Bali, Paris..."
                value={form.destination}
                onChange={e => { setF("destination", e.target.value); fetchSuggestions(e.target.value); setShowSug(true); }}
                onFocus={() => setShowSug(true)}
                onBlur={() => setTimeout(() => setShowSug(false), 150)}
              />
              {showSug && suggestions.length > 0 && (
                <div style={S.sugBox}>
                  {suggestions.map(s => (
                    <div key={s} className="tp-sug" style={S.sugItem}
                      onMouseDown={() => { setF("destination", s); setSuggestions([]); setShowSug(false); }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 14 8 14s8-8.75 8-14a8 8 0 0 0-8-8z"/></svg>
                      {s}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={S.section}>
            <div style={S.sLabel}>From</div>
            <input style={S.input} placeholder="Your city" value={form.originCity} onChange={e => setF("originCity", e.target.value)} />
          </div>

          <div style={S.row3}>
            <div style={S.section}>
              <div style={S.sLabel}>Month</div>
              <select style={S.sel} value={form.travelMonth} onChange={e => setF("travelMonth", e.target.value)}>
                {MONTHS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div style={S.section}>
              <div style={S.sLabel}>Days</div>
              <input style={S.input} type="number" min={1} max={30} value={form.days}
                onChange={e => setF("days", parseInt(e.target.value)||1)} />
            </div>
            <div style={S.section}>
              <div style={S.sLabel}>People</div>
              <input style={S.input} type="number" min={1} max={20} value={form.travelers}
                onChange={e => setF("travelers", parseInt(e.target.value)||1)} />
            </div>
          </div>

          <div style={S.section}>
            <div style={S.sLabel}>Trip type</div>
            <div style={S.tripGrid}>
              {TRIP_TYPES.map(t => (
                <button key={t.value} className="tp-tab"
                  onClick={() => setF("tripType", t.value)}
                  style={{ ...S.tripBtn, ...(form.tripType===t.value ? S.tripActive : {}) }}>
                  <span style={{ fontSize:16 }}>{t.icon}</span>
                  <span style={{ fontSize:11 }}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <label style={S.toggleRow}>
            <div>
              <div style={{ fontSize:13, fontWeight:500, color:"var(--color-text-primary)" }}>Include flights</div>
              <div style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>Round-trip from your city</div>
            </div>
            <div style={{ ...S.track, background: form.includeFlights ? "#1a73e8" : "var(--color-border-secondary)" }}
              onClick={() => setF("includeFlights", !form.includeFlights)}>
              <div style={{ ...S.thumb, transform: form.includeFlights ? "translateX(18px)" : "translateX(2px)" }}/>
            </div>
          </label>

          {error && (
            <div style={S.errBox}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span style={{ fontSize:12 }}>{error}</span>
            </div>
          )}

          <button className="tp-gen" style={{ ...S.genBtn, opacity:loading?0.7:1 }} onClick={generate} disabled={loading}>
            {loading
              ? <><svg style={{ animation:"spin 0.8s linear infinite" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Generating...</>
              : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Generate Plan</>
            }
          </button>

          {/* Profile insights */}
          {profile?.top_tags?.length > 0 && (
            <div style={S.profileBox}>
              <div style={S.profileTitle}>Your travel profile</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:8 }}>
                {profile.top_tags.map(t => (
                  <span key={t} style={S.profileTag}>
                    {TAG_ICONS[t] || "✦"} {t}
                  </span>
                ))}
              </div>
              <div style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>
                Avg budget: <b style={{ color:"var(--color-text-secondary)" }}>
                  {profile.avg_tier <= 1.5 ? "Budget" : profile.avg_tier <= 2.5 ? "Standard" : "Premium"}
                </b> · Favourite style: <b style={{ color:"var(--color-text-secondary)" }}>{profile.top_type}</b>
              </div>
            </div>
          )}

          {plan?.assumptions && (
            <div style={S.assumBox}>
              <div style={S.assumTitle}>Assumptions</div>
              {plan.assumptions.map((a,i) => (
                <div key={i} style={S.assumRow}>
                  <div style={S.dot}/><span>{a}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══ RIGHT: tabs ═══ */}
        <div style={S.right}>
          {/* right tab bar */}
          <div style={S.rTabBar}>
            {[["plan","📋","Plan & Budget"],["recs","✨","For You"],["history","🕑","History"]].map(([t,ic,lb])=>(
              <button key={t} className="tp-rtab"
                onClick={() => { setRightTab(t); if(t==="recs") loadRecs(); if(t==="history") loadHistory(); }}
                style={{ ...S.rTab, ...(rightTab===t ? S.rTabActive : {}) }}>
                {ic} {lb}
              </button>
            ))}
          </div>

          {/* ── PLAN TAB ── */}
          {rightTab === "plan" && (
            <>
              {!plan && !loading && (
                <div style={S.empty}>
                  <div style={S.emptyIcon}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ color:"var(--color-text-tertiary)" }}><path d="M3 17l9-13 9 13"/><path d="M3 17h18"/></svg>
                  </div>
                  <div style={S.emptyTitle}>Your travel plan appears here</div>
                  <div style={S.emptySub}>Fill in the details on the left and click Generate Plan</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:14, alignSelf:"stretch", maxWidth:240 }}>
                    {["Enter destination & travel details","Choose trip type & toggle flights","Get budget, standard & premium plans with day-wise itinerary"].map((s,i)=>(
                      <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
                        <div style={S.stepNum}>{i+1}</div>
                        <div style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.5 }}>{s}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {loading && (
                <div style={S.empty}>
                  <div style={{ ...S.emptyIcon, animation:"shimmer 1.4s ease infinite" }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ color:"var(--color-text-tertiary)" }}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  </div>
                  <div style={S.emptyTitle}>Generating your travel plan...</div>
                  <div style={S.emptySub}>Calculating costs for flights, hotels, food & activities</div>
                </div>
              )}

              {plan && !loading && (
                <div style={{ animation:"fadeUp 0.2s ease", display:"flex", flexDirection:"column", gap:14 }}>
                  {plan.note && (
                    <div style={{ padding:"10px 14px", borderRadius:"var(--border-radius-md)", background:"var(--color-background-warning)", border:"0.5px solid var(--color-border-warning)", color:"var(--color-text-warning)", fontSize:12, marginBottom:0 }}>
                      ⚠️ {plan.note}
                    </div>
                  )}
                  <div style={S.summaryCard}>
                    <div style={S.summaryDest}>{plan.normalized_destination}</div>
                    <div style={S.summarySub}>{plan.trip_summary}</div>
                  </div>

                  {/* plan option tabs */}
                  <div style={S.optRow}>
                    {plan.budget_options.map((opt,i)=>(
                      <button key={i} className="tp-opt"
                        onClick={() => { setTab(i); setDay(null); }}
                        style={{ ...S.optBtn, ...(activeTab===i ? { borderColor:CAT_COLOR[opt.category], background:CAT_BG[opt.category] } : {}) }}>
                        <div style={{ fontSize:10, fontWeight:500, color:activeTab===i ? CAT_COLOR[opt.category]:"var(--color-text-tertiary)", marginBottom:2 }}>
                          {opt.category.toUpperCase()}
                        </div>
                        <div style={{ fontSize:15, fontWeight:500, color:activeTab===i ? CAT_COLOR[opt.category]:"var(--color-text-primary)" }}>
                          {fmt(opt.total_estimate_inr)}
                        </div>
                        <div style={{ fontSize:10, color:"var(--color-text-tertiary)", marginTop:1 }}>{opt.range_label}</div>
                      </button>
                    ))}
                  </div>

                  {option && <>
                    <div style={S.planCard}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:8 }}>
                        <div>
                          <div style={{ fontSize:14, fontWeight:500, color:"var(--color-text-primary)" }}>{option.plan_name}</div>
                          <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginTop:3 }}>{option.best_for}</div>
                        </div>
                        <div style={{ ...S.totalBadge, background:CAT_BG[option.category], color:CAT_COLOR[option.category] }}>
                          {fmt(option.total_estimate_inr)}
                        </div>
                      </div>
                    </div>

                    {/* cost breakdown */}
                    <div style={S.card}>
                      <div style={S.cardTitle}>Cost breakdown</div>
                      {costRows.map(({label,val})=> val>0 && (
                        <div key={label} style={S.breakRow}>
                          <span style={{ fontSize:13, color:"var(--color-text-secondary)" }}>{label}</span>
                          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                            <div style={{ width:80, height:4, borderRadius:2, background:"var(--color-border-tertiary)", overflow:"hidden" }}>
                              <div style={{ height:"100%", borderRadius:2, background:CAT_COLOR[option.category], width:`${Math.min(100,(val/option.total_estimate_inr)*100*3)}%` }}/>
                            </div>
                            <span style={{ fontSize:13, fontWeight:500, color:"var(--color-text-primary)", minWidth:70, textAlign:"right" }}>{fmt(val)}</span>
                          </div>
                        </div>
                      ))}
                      <div style={{ ...S.breakRow, borderTop:"0.5px solid var(--color-border-secondary)", paddingTop:10, marginTop:4 }}>
                        <span style={{ fontSize:13, fontWeight:500 }}>Total</span>
                        <span style={{ fontSize:15, fontWeight:500, color:CAT_COLOR[option.category] }}>{fmt(option.total_estimate_inr)}</span>
                      </div>
                    </div>

                    {/* tips */}
                    {option.optimization_tips?.length > 0 && (
                      <div style={{ ...S.card, background:"var(--color-background-info)", border:"0.5px solid var(--color-border-info)" }}>
                        <div style={{ ...S.cardTitle, color:"var(--color-text-info)" }}>💡 Money-saving tips</div>
                        {option.optimization_tips.map((t,i)=>(
                          <div key={i} style={S.assumRow}><div style={{ ...S.dot, background:"#1a73e8" }}/><span style={{ fontSize:12 }}>{t}</span></div>
                        ))}
                      </div>
                    )}

                    {/* AI extras: hidden gems, local foods, best time */}
                    {plan.ai_enhanced && (plan.hidden_gems || plan.local_foods || plan.best_time_insight) && (
                      <div style={{ ...S.card, border:"0.5px solid var(--color-border-success)", background:"var(--color-background-success)" }}>
                        <div style={{ ...S.cardTitle, color:"var(--color-text-success)" }}>✦ AI Insights by Gemini</div>
                        {plan.best_time_insight && (
                          <div style={{ marginBottom:10 }}>
                            <div style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:4 }}>🗓 Best Time</div>
                            <div style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.6 }}>{plan.best_time_insight}</div>
                          </div>
                        )}
                        {plan.hidden_gems?.length > 0 && (
                          <div style={{ marginBottom:10 }}>
                            <div style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:4 }}>💎 Hidden Gems</div>
                            {plan.hidden_gems.map((g,i) => (
                              <div key={i} style={S.assumRow}><div style={S.dot}/><span style={{ fontSize:12 }}>{g}</span></div>
                            ))}
                          </div>
                        )}
                        {plan.local_foods?.length > 0 && (
                          <div>
                            <div style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:4 }}>🍜 Must-Try Food</div>
                            {plan.local_foods.map((f,i) => (
                              <div key={i} style={S.assumRow}><div style={S.dot}/><span style={{ fontSize:12 }}>{f}</span></div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* itinerary */}
                    <div style={S.card}>
                      <div style={S.cardTitle}>Day-wise itinerary</div>
                      {option.itinerary.map(day=>(
                        <div key={day.day_number}>
                          <div className="tp-day" style={{ ...S.dayRow, ...(activeDay===day.day_number ? { background:"var(--color-background-secondary)" } : {}) }}
                            onClick={()=>setDay(activeDay===day.day_number?null:day.day_number)}>
                            <div style={S.dayNum}>Day {day.day_number}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:13, fontWeight:500, color:"var(--color-text-primary)" }}>{day.title}</div>
                              <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:1 }}>{day.tourist_places.join(" · ")}</div>
                            </div>
                            <span style={{ fontSize:12, fontWeight:500, color:CAT_COLOR[option.category], flexShrink:0 }}>{fmt(day.estimated_day_cost_inr)}</span>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color:"var(--color-text-tertiary)", transform:activeDay===day.day_number?"rotate(180deg)":"none", transition:"transform .2s" }}>
                              <polyline points="6 9 12 15 18 9"/>
                            </svg>
                          </div>
                          {activeDay===day.day_number && (
                            <div style={S.dayDetail}>
                              {[["Places",day.tourist_places.join(", ")],["Transport",day.transport_mode],["Food",day.food_plan],["Summary",day.summary]].map(([l,v])=>(
                                <div key={l} style={S.detailRow}>
                                  <span style={S.detailLabel}>{l}</span><span style={{ fontSize:12, color:"var(--color-text-secondary)" }}>{v}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>}
                </div>
              )}
            </>
          )}

          {/* ── RECOMMENDATIONS TAB ── */}
          {rightTab === "recs" && (
            <div style={{ animation:"fadeUp 0.2s ease" }}>
              <div style={S.recHeader}>
                <div>
                  <div style={{ fontSize:14, fontWeight:500, color:"var(--color-text-primary)" }}>
                    {profile?.search_count > 0 ? "Picked for you" : "Popular destinations"}
                  </div>
                  <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginTop:2 }}>
                    {profile?.search_count > 0
                      ? `Based on your ${profile.search_count} search${profile.search_count>1?"es":""} — matching your ${profile.top_tags?.slice(0,2).join(" & ")} interests`
                      : "Generate a plan to get personalised recommendations"}
                  </div>
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  {["budget","standard","premium"].map(b=>(
                    <button key={b} className="tp-tab" style={S.budgetFilter}
                      onClick={() => loadRecs({ budget:b })}>
                      {b.charAt(0).toUpperCase()+b.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {recsLoading ? (
                <div style={{ ...S.empty, minHeight:200 }}>
                  <svg style={{ animation:"spin 0.8s linear infinite", color:"var(--color-text-tertiary)" }} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                </div>
              ) : (
                <div style={S.recGrid}>
                  {recs.map((r,i) => (
                    <div key={i} className="tp-rec" style={S.recCard}
                      onClick={() => { setF("destination", r.destination); setRightTab("plan"); }}>
                      <div style={S.recTop}>
                        <div style={{ flex:1 }}>
                          <div style={S.recDest}>{r.destination}</div>
                          <div style={S.recRegion}>{r.region}</div>
                        </div>
                        <div style={{ ...S.tierBadge, color:TIER_COLOR[r.budget_tier]||"#6b7280", background:r.budget_tier==="Budget"?"var(--color-background-success)":r.budget_tier==="Premium"?"#f5f3ff":"var(--color-background-info)" }}>
                          {r.budget_tier}
                        </div>
                      </div>
                      <div style={S.recTags}>
                        {r.tags.slice(0,3).map(t=>(
                          <span key={t} style={S.recTag}>{TAG_ICONS[t]||"✦"} {t}</span>
                        ))}
                      </div>
                      <div style={S.recBudget}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color:"var(--color-text-tertiary)" }}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                        {fmtK(r.est_low_inr)} – {fmtK(r.est_high_inr)} · {form.days}D {form.travelers}P
                      </div>
                      <div style={S.recWhy}>{r.why}</div>
                      <div style={S.recCta}>Plan this trip →</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── HISTORY TAB ── */}
          {rightTab === "history" && (
            <div style={{ animation:"fadeUp 0.2s ease", display:"flex", flexDirection:"column", gap:12 }}>
              <div style={{ fontSize:14, fontWeight:500, color:"var(--color-text-primary)" }}>Search history</div>
              {history.length === 0 ? (
                <div style={{ ...S.empty, minHeight:200 }}>
                  <div style={S.emptyTitle}>No searches yet</div>
                  <div style={S.emptySub}>Generate a plan to start tracking your searches</div>
                </div>
              ) : (
                history.slice().reverse().map((h,i) => (
                  <div key={i} className="tp-hist" style={S.histCard}
                    onClick={() => { setF("destination", h.destination); setRightTab("plan"); }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:500, color:"var(--color-text-primary)" }}>{h.destination}</div>
                        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:2 }}>
                          {h.days} days · {h.travelers} people · {h.trip_type}
                        </div>
                      </div>
                      <div style={{ ...S.tierBadge, fontSize:10, color:CAT_COLOR[h.budget_category]||"#6b7280", background:h.budget_category==="budget"?"var(--color-background-success)":h.budget_category==="premium"?"#f5f3ff":"var(--color-background-info)" }}>
                        {h.budget_category}
                      </div>
                    </div>
                    <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:6 }}>
                      {h.include_flights ? "✈️ With flights" : "🚗 No flights"} · {h.timestamp?.slice(0,10)}
                    </div>
                    <div style={{ fontSize:11, color:"#1a73e8", marginTop:4 }}>Click to plan again →</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const S = {
  page: { display:"flex", flexDirection:"column", fontFamily:"var(--font-sans)", background:"var(--color-background-primary)", minHeight:"100vh" },
  hdr: { padding:"16px 26px 12px", borderBottom:"0.5px solid var(--color-border-tertiary)", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 },
  hdrLeft: { display:"flex", alignItems:"center", gap:12 },
  hdrIcon: { width:36, height:36, borderRadius:"var(--border-radius-md)", background:"var(--color-background-warning)", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--color-text-warning)", flexShrink:0 },
  hdrTitle: { fontSize:14, fontWeight:500, color:"var(--color-text-primary)", letterSpacing:"-0.2px" },
  hdrSub: { fontSize:11, color:"var(--color-text-secondary)", marginTop:1 },
  demoBadge: { padding:"3px 9px", borderRadius:20, background:"var(--color-background-warning)", color:"var(--color-text-warning)", fontSize:11, fontWeight:500 },
  histBadge: { display:"flex", alignItems:"center", gap:5, padding:"3px 9px", borderRadius:20, background:"var(--color-background-secondary)", border:"0.5px solid var(--color-border-tertiary)", color:"var(--color-text-secondary)", fontSize:11 },
  body: { display:"grid", gridTemplateColumns:"300px 1fr", flex:1, alignItems:"start" },
  left: { padding:"18px 20px", borderRight:"0.5px solid var(--color-border-tertiary)", display:"flex", flexDirection:"column", gap:13, position:"sticky", top:0, maxHeight:"calc(100vh - 60px)", overflowY:"auto" },
  right: { padding:"18px 22px", overflowY:"auto" },
  section: { display:"flex", flexDirection:"column", gap:4 },
  sLabel: { fontSize:10, fontWeight:500, color:"var(--color-text-tertiary)", letterSpacing:"0.08em", textTransform:"uppercase" },
  input: { padding:"8px 10px", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-primary)", color:"var(--color-text-primary)", fontSize:13, outline:"none", width:"100%", boxSizing:"border-box" },
  sel: { padding:"8px 10px", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-primary)", color:"var(--color-text-primary)", fontSize:13, outline:"none", cursor:"pointer", width:"100%" },
  row3: { display:"grid", gridTemplateColumns:"1fr 70px 70px", gap:8 },
  sugBox: { position:"absolute", top:"100%", left:0, right:0, zIndex:99, background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-secondary)", borderRadius:"var(--border-radius-md)", marginTop:2, boxShadow:"0 4px 12px #0001" },
  sugItem: { padding:"8px 12px", fontSize:13, color:"var(--color-text-primary)", display:"flex", alignItems:"center", gap:7, transition:"background .1s" },
  tripGrid: { display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:5 },
  tripBtn: { display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"8px 4px", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-tertiary)", background:"transparent", cursor:"pointer", transition:"all .15s" },
  tripActive: { border:"0.5px solid #1a73e8", background:"var(--color-background-info)", color:"#1a73e8" },
  toggleRow: { display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" },
  track: { width:38, height:22, borderRadius:11, position:"relative", cursor:"pointer", transition:"background .2s", flexShrink:0 },
  thumb: { position:"absolute", top:2, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"transform .2s", boxShadow:"0 1px 3px #0003" },
  errBox: { display:"flex", alignItems:"center", gap:7, padding:"8px 11px", borderRadius:"var(--border-radius-md)", background:"var(--color-background-danger)", border:"0.5px solid var(--color-border-danger)", color:"var(--color-text-danger)" },
  genBtn: { padding:"10px 0", borderRadius:"var(--border-radius-md)", border:"none", background:"#1a73e8", color:"#fff", fontWeight:500, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7, transition:"opacity .15s" },
  profileBox: { padding:"11px 13px", borderRadius:"var(--border-radius-md)", background:"linear-gradient(135deg, var(--color-background-info), var(--color-background-secondary))", border:"0.5px solid var(--color-border-info)" },
  profileTitle: { fontSize:10, fontWeight:500, color:"var(--color-text-info)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:7 },
  profileTag: { padding:"3px 8px", borderRadius:20, background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-secondary)", color:"var(--color-text-secondary)", fontSize:11 },
  assumBox: { padding:"11px 13px", borderRadius:"var(--border-radius-md)", background:"var(--color-background-secondary)", border:"0.5px solid var(--color-border-tertiary)" },
  assumTitle: { fontSize:10, fontWeight:500, color:"var(--color-text-tertiary)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:7 },
  assumRow: { display:"flex", alignItems:"flex-start", gap:7, marginBottom:5, fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.5 },
  dot: { width:5, height:5, borderRadius:"50%", background:"#94a3b8", marginTop:5, flexShrink:0 },
  rTabBar: { display:"flex", borderBottom:"0.5px solid var(--color-border-tertiary)", marginBottom:16, gap:0 },
  rTab: { padding:"9px 14px", border:"none", background:"transparent", color:"var(--color-text-secondary)", cursor:"pointer", fontSize:12, fontWeight:400, borderBottom:"2px solid transparent", transition:"all .15s" },
  rTabActive: { color:"var(--color-text-primary)", fontWeight:500, borderBottom:"2px solid #1a73e8" },
  empty: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", padding:"50px 20px", gap:8, minHeight:350 },
  emptyIcon: { width:60, height:60, borderRadius:"var(--border-radius-lg)", background:"var(--color-background-secondary)", border:"0.5px solid var(--color-border-tertiary)", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:8 },
  emptyTitle: { fontSize:14, fontWeight:500, color:"var(--color-text-primary)" },
  emptySub: { fontSize:12, color:"var(--color-text-secondary)", maxWidth:280, lineHeight:1.6 },
  stepNum: { width:20, height:20, borderRadius:"50%", background:"var(--color-background-secondary)", border:"0.5px solid var(--color-border-secondary)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:500, color:"var(--color-text-secondary)", flexShrink:0, marginTop:1 },
  summaryCard: { padding:"13px 15px", borderRadius:"var(--border-radius-lg)", background:"var(--color-background-secondary)", border:"0.5px solid var(--color-border-tertiary)" },
  summaryDest: { fontSize:18, fontWeight:500, color:"var(--color-text-primary)", letterSpacing:"-0.3px" },
  summarySub: { fontSize:12, color:"var(--color-text-secondary)", marginTop:3, lineHeight:1.5 },
  optRow: { display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 },
  optBtn: { padding:"11px 8px", borderRadius:"var(--border-radius-lg)", border:"0.5px solid var(--color-border-tertiary)", background:"var(--color-background-primary)", cursor:"pointer", textAlign:"center", transition:"all .15s" },
  planCard: { padding:"13px 15px", borderRadius:"var(--border-radius-lg)", background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)" },
  totalBadge: { padding:"4px 11px", borderRadius:20, fontSize:12, fontWeight:500 },
  card: { padding:"13px 15px", borderRadius:"var(--border-radius-lg)", background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)" },
  cardTitle: { fontSize:10, fontWeight:500, color:"var(--color-text-tertiary)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10, display:"flex", alignItems:"center", gap:5 },
  breakRow: { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 0", borderBottom:"0.5px solid var(--color-border-tertiary)" },
  dayRow: { display:"flex", alignItems:"center", gap:9, padding:"9px 10px", borderRadius:"var(--border-radius-md)", cursor:"pointer", transition:"background .15s" },
  dayNum: { fontSize:10, fontWeight:500, color:"var(--color-text-tertiary)", width:34, flexShrink:0 },
  dayDetail: { padding:"8px 10px 8px 44px", display:"flex", flexDirection:"column", gap:5, borderBottom:"0.5px solid var(--color-border-tertiary)", marginBottom:2 },
  detailRow: { display:"flex", gap:10 },
  detailLabel: { fontSize:11, fontWeight:500, color:"var(--color-text-tertiary)", minWidth:64, flexShrink:0 },
  // recommendations
  recHeader: { display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14, flexWrap:"wrap", gap:10 },
  budgetFilter: { padding:"4px 10px", borderRadius:20, border:"0.5px solid var(--color-border-secondary)", background:"transparent", color:"var(--color-text-secondary)", cursor:"pointer", fontSize:11, transition:"all .15s" },
  recGrid: { display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(200px,1fr))", gap:10 },
  recCard: { padding:"13px 14px", borderRadius:"var(--border-radius-lg)", border:"0.5px solid var(--color-border-tertiary)", background:"var(--color-background-primary)", cursor:"pointer", transition:"all .2s", display:"flex", flexDirection:"column", gap:8 },
  recTop: { display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 },
  recDest: { fontSize:14, fontWeight:500, color:"var(--color-text-primary)" },
  recRegion: { fontSize:11, color:"var(--color-text-tertiary)", marginTop:1 },
  tierBadge: { padding:"2px 8px", borderRadius:20, fontSize:10, fontWeight:500, flexShrink:0 },
  recTags: { display:"flex", flexWrap:"wrap", gap:4 },
  recTag: { padding:"2px 7px", borderRadius:20, background:"var(--color-background-secondary)", color:"var(--color-text-secondary)", fontSize:11 },
  recBudget: { display:"flex", alignItems:"center", gap:5, fontSize:11, color:"var(--color-text-secondary)" },
  recWhy: { fontSize:11, color:"var(--color-text-tertiary)", lineHeight:1.4, fontStyle:"italic" },
  recCta: { fontSize:11, color:"#1a73e8", fontWeight:500, marginTop:"auto" },
  // history
  histCard: { padding:"12px 14px", borderRadius:"var(--border-radius-lg)", border:"0.5px solid var(--color-border-tertiary)", background:"var(--color-background-primary)", cursor:"pointer", transition:"background .15s" },
};