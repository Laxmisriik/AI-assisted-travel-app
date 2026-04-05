import { useState, useRef, useEffect } from "react";
import { get, post } from "../../utils/api";

const LANG_NAMES = {
  auto:"Auto Detect", en:"English", ta:"Tamil", hi:"Hindi",
  ja:"Japanese", zh:"Chinese", ko:"Korean", fr:"French",
  de:"German", es:"Spanish", ar:"Arabic", ru:"Russian",
  pt:"Portuguese", it:"Italian",
};

const USE_CASES = [
  { icon: "🪧", label: "Sign Board" },
  { icon: "🏨", label: "Hotel Notice" },
  { icon: "🍽️", label: "Menu Card" },
  { icon: "📄", label: "Document" },
  { icon: "🛍️", label: "Product Label" },
];

const SAMPLE_TEXTS = {
  ta: "விலைப்பட்டியல்\nபூரி மசாலா - ₹30\nவடை - ₹6\nபொங்கல் - ₹30",
  hi: "स्वागत है\nकृपया जूते बाहर उतारें\nधन्यवाद",
  ja: "本日のランチ\nラーメン ¥800\nチャーハン ¥700",
  zh: "欢迎光临\n今日特餐",
  ko: "오늘의 메뉴\n비빔밥 ₩8,000",
  fr: "Bienvenue\nDéfense de fumer",
};

export default function Translator() {
  const [mode, setMode]            = useState("upload");
  const [imagePreview, setImgPrev] = useState(null);
  const [imageB64, setImgB64]      = useState(null);
  const [manualText, setManual]    = useState("");
  const [sourceLang, setSrc]       = useState("auto");
  const [targetLang, setTgt]       = useState("en");
  const [result, setResult]        = useState(null);
  const [loading, setLoading]      = useState(false);
  const [error, setError]          = useState(null);
  const [ttsPlaying, setTts]       = useState(false);
  const [copied, setCopied]        = useState(false);
  const [dragOver, setDragOver]    = useState(false);
  const [activeUseCase, setUseCase]= useState(null);
  const [langs, setLangs]          = useState(LANG_NAMES);

  const fileRef  = useRef();
  const videoRef = useRef();
  const canvasRef= useRef();
  const streamRef= useRef();

  useEffect(() => {
    get("/translate/languages").then(setLangs).catch(() => {});
    return () => stopCamera();
  }, []);

  async function startCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = s;
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch { setError("Camera access denied."); }
  }
  function stopCamera() {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
  }
  function capturePhoto() {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const png = c.toDataURL("image/png");
    setImgPrev(png); setImgB64(png); stopCamera();
  }
  useEffect(() => { if (mode === "camera") startCamera(); else stopCamera(); }, [mode]);

  function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) { setError("Please upload an image file."); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new window.Image();
      img.onload = () => {
        const cvs = document.createElement("canvas");
        cvs.width = img.naturalWidth; cvs.height = img.naturalHeight;
        cvs.getContext("2d").drawImage(img, 0, 0);
        const png = cvs.toDataURL("image/png");
        setImgPrev(png); setImgB64(png); setResult(null); setError(null);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function translate() {
    setError(null); setResult(null); setLoading(true);
    try {
      let res;
      if (mode === "text") {
        if (!manualText.trim()) { setError("Enter some text first."); setLoading(false); return; }
        res = await post("/translate/text", { text: manualText, source_lang: sourceLang, target_lang: targetLang });
      } else {
        if (!imageB64) { setError("Please provide an image first."); setLoading(false); return; }
        res = await post("/translate/image", { image_base64: imageB64, source_lang: sourceLang, target_lang: targetLang });
      }
      setResult(res);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  function speak(text, lang) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = lang === "auto" ? "en" : lang;
    utt.onstart = () => setTts(true); utt.onend = () => setTts(false);
    window.speechSynthesis.speak(utt);
  }
  function copy(text) {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  const hasResult = result && result.original;
  const detectedName = result?.detected_lang ? (langs[result.detected_lang] || result.detected_lang) : null;

  return (
    <div style={S.page}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .tr-tab:hover { background: var(--color-background-secondary) !important; }
        .tr-uc:hover { border-color: #1a73e8 !important; color: #1a73e8 !important; }
        .tr-action:hover { background: var(--color-background-secondary) !important; }
        .tr-sample:hover { color: #1a73e8 !important; border-color: #1a73e8 !important; }
        .tr-drop:hover { border-color: #1a73e8 !important; }
        .tr-swap:hover { background: var(--color-background-secondary) !important; }
        .tr-translate:hover:not(:disabled) { opacity: 0.88 !important; }
      `}</style>

      {/* header */}
      <div style={S.hdr}>
        <div style={S.hdrTop}>
          <div style={S.hdrIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </div>
          <div>
            <div style={S.hdrTitle}>Travel Translator</div>
            <div style={S.hdrSub}>Snap, upload or type text to translate instantly</div>
          </div>
        </div>
        <div style={S.ucRow}>
          {USE_CASES.map(u => (
            <button key={u.label} className="tr-uc"
              onClick={() => setUseCase(activeUseCase === u.label ? null : u.label)}
              style={{ ...S.ucChip, ...(activeUseCase === u.label ? S.ucActive : {}) }}>
              <span style={{ fontSize: 12 }}>{u.icon}</span>{u.label}
            </button>
          ))}
        </div>
      </div>

      {/* body */}
      <div style={S.body}>

        {/* LEFT */}
        <div style={S.left}>

          {/* tabs */}
          <div style={S.tabs}>
            {[["upload","Upload Image"],["camera","Camera"],["text","Type Text"]].map(([m,lb]) => (
              <button key={m} className="tr-tab"
                onClick={() => { setMode(m); setResult(null); setError(null); }}
                style={{ ...S.tab, ...(mode===m ? S.tabActive : {}) }}>
                {lb}
              </button>
            ))}
          </div>

          {/* upload */}
          {mode === "upload" && (
            <div className="tr-drop"
              style={{ ...S.drop, ...(dragOver ? S.dropOver : {}), cursor: imagePreview ? "default" : "pointer" }}
              onClick={() => !imagePreview && fileRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}>
              <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e => handleFile(e.target.files[0])} />
              {imagePreview ? (
                <div style={{ position:"relative" }}>
                  <img src={imagePreview} alt="preview" style={S.preview} />
                  <div style={S.previewActions}>
                    <button style={S.previewBtn} onClick={e => { e.stopPropagation(); setImgPrev(null); setImgB64(null); setResult(null); }}>Clear</button>
                    <button style={S.previewBtn} onClick={e => { e.stopPropagation(); fileRef.current.click(); }}>Change</button>
                  </div>
                </div>
              ) : (
                <div style={S.dropInner}>
                  <div style={S.dropIcon}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color:"var(--color-text-tertiary)" }}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  </div>
                  <div style={S.dropTitle}>Drop image here or click to browse</div>
                  <div style={S.dropSub}>PNG · JPG · AVIF — signs, menus, notices</div>
                </div>
              )}
            </div>
          )}

          {/* camera */}
          {mode === "camera" && (
            <div style={S.camBox}>
              {imagePreview ? (
                <div style={{ position:"relative" }}>
                  <img src={imagePreview} alt="captured" style={S.preview} />
                  <div style={S.previewActions}>
                    <button style={S.previewBtn} onClick={() => { setImgPrev(null); setImgB64(null); setResult(null); startCamera(); }}>Retake</button>
                  </div>
                </div>
              ) : (
                <div>
                  <video ref={videoRef} autoPlay playsInline muted style={{ width:"100%", display:"block", maxHeight:220, objectFit:"cover" }} />
                  <canvas ref={canvasRef} style={{ display:"none" }} />
                  <div style={{ padding:"12px", display:"flex", justifyContent:"center" }}>
                    <button style={S.captureBtn} onClick={capturePhoto}>Capture</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* text */}
          {mode === "text" && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <textarea style={S.ta} rows={6} placeholder="Type or paste text to translate..."
                value={manualText} onChange={e => { setManual(e.target.value); setResult(null); }} />
              <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                <span style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>Sample:</span>
                {Object.keys(SAMPLE_TEXTS).map(lc => (
                  <button key={lc} className="tr-sample" style={S.sampleBtn}
                    onClick={() => { setManual(SAMPLE_TEXTS[lc]); setSrc(lc); setResult(null); }}>
                    {LANG_NAMES[lc]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* lang bar */}
          <div style={S.langBar}>
            <div style={S.langGroup}>
              <div style={S.lgLabel}>FROM</div>
              <select style={S.sel} value={sourceLang} onChange={e => setSrc(e.target.value)}>
                {Object.entries(langs).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <button className="tr-swap" style={S.swapBtn}
              onClick={() => { if(sourceLang!=="auto"){ setSrc(targetLang); setTgt(sourceLang); } }}>
              ⇄
            </button>
            <div style={S.langGroup}>
              <div style={S.lgLabel}>TO</div>
              <select style={S.sel} value={targetLang} onChange={e => setTgt(e.target.value)}>
                {Object.entries(langs).filter(([k]) => k!=="auto").map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          {error && (
            <div style={S.errBox}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span style={{ fontSize:12 }}>{error}</span>
            </div>
          )}

          <button className="tr-translate" style={{ ...S.transBtn, opacity: loading ? 0.7 : 1 }} onClick={translate} disabled={loading}>
            {loading
              ? <><svg style={{ animation:"spin 0.8s linear infinite" }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Translating...</>
              : <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Translate</>
            }
          </button>
        </div>

        {/* RIGHT */}
        <div style={S.right}>
          {!hasResult && !loading && (
            <div style={S.empty}>
              <div style={S.emptyIcon}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ color:"var(--color-text-tertiary)" }}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              </div>
              <div style={S.emptyTitle}>Translation appears here</div>
              <div style={S.emptySub}>Upload an image, use your camera, or type text to get started</div>
              <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:16, alignSelf:"stretch", maxWidth:220 }}>
                {["Select source language", "Add image or type text", "Click Translate"].map((s,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={S.stepNum}>{i+1}</div>
                    <div style={{ fontSize:12, color:"var(--color-text-secondary)" }}>{s}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div style={S.empty}>
              <div style={{ ...S.emptyIcon, animation:"pulse 1.4s ease infinite" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color:"var(--color-text-tertiary)" }}><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10"/></svg>
              </div>
              <div style={S.emptyTitle}>Extracting &amp; translating...</div>
            </div>
          )}

          {hasResult && !loading && (
            <div style={{ animation:"fadeUp 0.2s ease", display:"flex", flexDirection:"column", gap:12 }}>
              {/* badges */}
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {detectedName && <div style={S.infoBadge}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Detected: {detectedName}</div>}
                {result.ocr_engine && <div style={S.grayBadge}>OCR · {result.ocr_engine}</div>}
                {result.trans_engine && <div style={S.grayBadge}>Translation · {result.trans_engine}</div>}
              </div>

              {/* original */}
              <div style={S.card}>
                <div style={S.cardHdr}>
                  <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <div style={{ width:6, height:6, borderRadius:"50%", background:"#94a3b8" }}/>
                    <span style={S.cardHdrTitle}>Original</span>
                    <span style={S.langTag}>{langs[result.detected_lang] || sourceLang}</span>
                  </div>
                  <div style={{ display:"flex", gap:3 }}>
                    <button className="tr-action" style={S.actionBtn} onClick={() => speak(result.original, result.detected_lang)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                    </button>
                    <button className="tr-action" style={S.actionBtn} onClick={() => copy(result.original)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </div>
                </div>
                <div style={S.cardBody}>{result.original}</div>
              </div>

              {/* arrow */}
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ flex:1, height:"0.5px", background:"var(--color-border-tertiary)" }}/>
                <div style={S.arrowBadge}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                  {langs[targetLang]}
                </div>
                <div style={{ flex:1, height:"0.5px", background:"var(--color-border-tertiary)" }}/>
              </div>

              {/* translated */}
              <div style={{ ...S.card, border:"0.5px solid var(--color-border-success)", background:"var(--color-background-success)" }}>
                <div style={S.cardHdr}>
                  <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <div style={{ width:6, height:6, borderRadius:"50%", background:"#22c55e" }}/>
                    <span style={S.cardHdrTitle}>Translation</span>
                    <span style={S.langTag}>{langs[targetLang]}</span>
                  </div>
                  <div style={{ display:"flex", gap:3 }}>
                    <button className="tr-action" style={S.actionBtn} onClick={() => speak(result.translated, targetLang)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                    </button>
                    <button className="tr-action" style={S.actionBtn} onClick={() => copy(result.translated)}>
                      {copied
                        ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      }
                    </button>
                  </div>
                </div>
                <div style={{ ...S.cardBody, fontSize:15, fontWeight:500, color:"var(--color-text-success)" }}>{result.translated}</div>
              </div>

              {/* AR */}
              {imagePreview && mode !== "text" && (
                <div style={{ borderRadius:"var(--border-radius-lg)", overflow:"hidden", border:"0.5px solid var(--color-border-tertiary)" }}>
                  <div style={{ padding:"8px 12px", fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", borderBottom:"0.5px solid var(--color-border-tertiary)", display:"flex", alignItems:"center", gap:6 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
                    AR preview — translation overlaid on image
                  </div>
                  <div style={{ position:"relative" }}>
                    <img src={imagePreview} alt="ar" style={{ width:"100%", maxHeight:160, objectFit:"cover", opacity:0.5, display:"block" }} />
                    <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
                      <div style={{ background:"rgba(26,115,232,0.9)", color:"#fff", padding:"8px 14px", borderRadius:"var(--border-radius-md)", fontSize:13, fontWeight:500, textAlign:"center", maxWidth:"90%", whiteSpace:"pre-wrap" }}>
                        {result.translated}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {result && !result.original && !loading && (
            <div style={S.empty}>
              <div style={S.emptyTitle}>No text detected</div>
              <div style={S.emptySub}>Try a clearer image with better lighting, or select the correct source language.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const S = {
  page: { display:"flex", flexDirection:"column", fontFamily:"var(--font-sans)", background:"var(--color-background-primary)", minHeight:"100vh" },
  hdr: { padding:"20px 28px 16px", borderBottom:"0.5px solid var(--color-border-tertiary)", display:"flex", flexDirection:"column", gap:12 },
  hdrTop: { display:"flex", alignItems:"center", gap:12 },
  hdrIcon: { width:38, height:38, borderRadius:"var(--border-radius-md)", background:"var(--color-background-info)", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--color-text-info)", flexShrink:0 },
  hdrTitle: { fontSize:15, fontWeight:500, color:"var(--color-text-primary)", letterSpacing:"-0.2px" },
  hdrSub: { fontSize:12, color:"var(--color-text-secondary)", marginTop:2 },
  ucRow: { display:"flex", flexWrap:"wrap", gap:6 },
  ucChip: { display:"flex", alignItems:"center", gap:5, padding:"4px 11px", borderRadius:20, border:"0.5px solid var(--color-border-secondary)", background:"transparent", color:"var(--color-text-secondary)", cursor:"pointer", fontSize:12, transition:"all .15s" },
  ucActive: { borderColor:"#1a73e8", color:"#1a73e8", background:"var(--color-background-info)" },
  body: { display:"grid", gridTemplateColumns:"1fr 1fr", flex:1 },
  left: { padding:"22px 26px", borderRight:"0.5px solid var(--color-border-tertiary)", display:"flex", flexDirection:"column", gap:13 },
  tabs: { display:"flex", border:"0.5px solid var(--color-border-tertiary)", borderRadius:"var(--border-radius-md)", overflow:"hidden" },
  tab: { flex:1, padding:"8px 10px", border:"none", borderRight:"0.5px solid var(--color-border-tertiary)", background:"transparent", color:"var(--color-text-secondary)", cursor:"pointer", fontSize:12, transition:"all .15s" },
  tabActive: { background:"var(--color-background-secondary)", color:"var(--color-text-primary)", fontWeight:500 },
  drop: { border:"0.5px dashed var(--color-border-secondary)", borderRadius:"var(--border-radius-lg)", minHeight:190, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", transition:"border-color .2s" },
  dropOver: { borderColor:"#1a73e8", background:"var(--color-background-info)" },
  dropInner: { textAlign:"center", padding:"28px 20px", display:"flex", flexDirection:"column", alignItems:"center", gap:7 },
  dropIcon: { width:52, height:52, borderRadius:"var(--border-radius-lg)", background:"var(--color-background-secondary)", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:4 },
  dropTitle: { fontSize:13, fontWeight:500, color:"var(--color-text-primary)" },
  dropSub: { fontSize:11, color:"var(--color-text-tertiary)" },
  preview: { width:"100%", maxHeight:230, objectFit:"contain", display:"block" },
  previewActions: { position:"absolute", top:8, right:8, display:"flex", gap:5 },
  previewBtn: { padding:"4px 10px", borderRadius:"var(--border-radius-md)", background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-secondary)", color:"var(--color-text-primary)", cursor:"pointer", fontSize:11 },
  camBox: { borderRadius:"var(--border-radius-lg)", overflow:"hidden", border:"0.5px solid var(--color-border-tertiary)", background:"var(--color-background-secondary)", minHeight:190 },
  captureBtn: { padding:"8px 20px", borderRadius:20, border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-primary)", color:"var(--color-text-primary)", cursor:"pointer", fontSize:13 },
  ta: { width:"100%", padding:"11px 13px", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-primary)", color:"var(--color-text-primary)", fontSize:13, resize:"vertical", outline:"none", fontFamily:"var(--font-sans)", lineHeight:1.6, boxSizing:"border-box" },
  sampleBtn: { padding:"3px 9px", borderRadius:20, border:"0.5px solid var(--color-border-tertiary)", background:"transparent", color:"var(--color-text-secondary)", cursor:"pointer", fontSize:11, transition:"all .15s" },
  langBar: { display:"flex", alignItems:"flex-end", gap:8, padding:"12px 14px", background:"var(--color-background-secondary)", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-tertiary)" },
  langGroup: { flex:1, display:"flex", flexDirection:"column", gap:5 },
  lgLabel: { fontSize:9, fontWeight:500, color:"var(--color-text-tertiary)", letterSpacing:"0.1em" },
  sel: { padding:"7px 9px", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-primary)", color:"var(--color-text-primary)", fontSize:12, outline:"none", cursor:"pointer" },
  swapBtn: { padding:"7px 10px", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-primary)", color:"var(--color-text-secondary)", cursor:"pointer", fontSize:15, transition:"all .15s", marginBottom:0 },
  errBox: { display:"flex", alignItems:"center", gap:7, padding:"9px 12px", borderRadius:"var(--border-radius-md)", background:"var(--color-background-danger)", border:"0.5px solid var(--color-border-danger)", color:"var(--color-text-danger)" },
  transBtn: { padding:"10px 0", borderRadius:"var(--border-radius-md)", border:"none", background:"#1a73e8", color:"#fff", fontWeight:500, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7, transition:"opacity .15s", letterSpacing:"-0.1px" },
  right: { padding:"22px 26px", background:"var(--color-background-secondary)", display:"flex", flexDirection:"column" },
  empty: { flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", padding:"40px 16px", gap:7 },
  emptyIcon: { width:60, height:60, borderRadius:"var(--border-radius-lg)", background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:6 },
  emptyTitle: { fontSize:14, fontWeight:500, color:"var(--color-text-primary)" },
  emptySub: { fontSize:12, color:"var(--color-text-secondary)", maxWidth:260, lineHeight:1.6 },
  stepNum: { width:20, height:20, borderRadius:"50%", background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-secondary)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:500, color:"var(--color-text-secondary)", flexShrink:0 },
  infoBadge: { display:"flex", alignItems:"center", gap:5, padding:"3px 9px", borderRadius:20, background:"var(--color-background-info)", color:"var(--color-text-info)", fontSize:11, fontWeight:500 },
  grayBadge: { padding:"3px 9px", borderRadius:20, background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", color:"var(--color-text-tertiary)", fontSize:11 },
  card: { background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:"var(--border-radius-lg)", overflow:"hidden" },
  cardHdr: { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 13px", borderBottom:"0.5px solid var(--color-border-tertiary)" },
  cardHdrTitle: { fontSize:11, fontWeight:500, color:"var(--color-text-secondary)" },
  langTag: { fontSize:10, padding:"2px 7px", borderRadius:20, background:"var(--color-background-secondary)", color:"var(--color-text-tertiary)", border:"0.5px solid var(--color-border-tertiary)" },
  actionBtn: { width:26, height:26, borderRadius:"var(--border-radius-md)", border:"none", background:"transparent", color:"var(--color-text-secondary)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all .15s" },
  cardBody: { padding:"11px 13px", fontSize:13, lineHeight:1.7, color:"var(--color-text-primary)", whiteSpace:"pre-wrap" },
  arrowBadge: { display:"flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:20, border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-primary)", color:"var(--color-text-secondary)", fontSize:11, whiteSpace:"nowrap" },
};