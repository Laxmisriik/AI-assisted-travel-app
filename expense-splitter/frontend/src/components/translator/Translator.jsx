import { useState, useRef, useEffect, useCallback } from "react";
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
  ta: "சாம்பார் சாதம் - ₹80\nதோசை - ₹60\nகாபி - ₹30",
  hi: "स्वागत है\nकृपया जूते बाहर उतारें\nधन्यवाद",
  ja: "本日のランチ\nラーメン ¥800\nチャーハン ¥700",
  zh: "欢迎光临\n今日特餐\n请保持安静",
  ko: "오늘의 메뉴\n비빔밥 ₩8,000\n된장찌개 ₩7,000",
  fr: "Bienvenue\nDéfense de fumer\nMerci de votre visite",
};

export default function Translator() {
  const [mode, setMode]           = useState("upload"); // upload | camera | text
  const [imagePreview, setImgPrev] = useState(null);
  const [imageB64, setImgB64]     = useState(null);
  const [manualText, setManual]   = useState("");
  const [sourceLang, setSrc]      = useState("auto");
  const [targetLang, setTgt]      = useState("en");
  const [result, setResult]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [langs, setLangs]         = useState(LANG_NAMES);
  const [ttsPlaying, setTts]      = useState(false);
  const [useCase, setUseCase]     = useState(null);
  const [dragOver, setDragOver]   = useState(false);
  const [copied, setCopied]       = useState(false);

  const fileRef    = useRef();
  const videoRef   = useRef();
  const canvasRef  = useRef();
  const streamRef  = useRef();

  useEffect(() => {
    get("/translate/languages").then(setLangs).catch(() => {});
    return () => stopCamera();
  }, []);

  // ── Camera ───────────────────────────────────────────────────
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch { setError("Camera access denied."); }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }

  function capturePhoto() {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const dataUrl = c.toDataURL("image/png");
    setImgPrev(dataUrl);
    setImgB64(dataUrl);
    stopCamera();
  }

  useEffect(() => {
    if (mode === "camera") startCamera();
    else stopCamera();
  }, [mode]);

  // ── File upload ──────────────────────────────────────────────
  function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) { setError("Please upload an image file."); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      // normalise to PNG via canvas so backend always gets clean bytes
      const img = new window.Image();
      img.onload = () => {
        const cvs = document.createElement("canvas");
        cvs.width = img.naturalWidth;
        cvs.height = img.naturalHeight;
        cvs.getContext("2d").drawImage(img, 0, 0);
        const png = cvs.toDataURL("image/png");
        setImgPrev(png);
        setImgB64(png);
        setResult(null);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }

  // ── Translate ────────────────────────────────────────────────
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

  // ── TTS ──────────────────────────────────────────────────────
  function speak(text, lang) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = lang === "auto" ? "en" : lang;
    utt.onstart = () => setTts(true);
    utt.onend   = () => setTts(false);
    window.speechSynthesis.speak(utt);
  }

  function copy(text) {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  function loadSample(langCode) {
    const sample = SAMPLE_TEXTS[langCode];
    if (sample) { setManual(sample); setSrc(langCode); setMode("text"); setResult(null); }
  }

  const detectedName = result?.detected_lang ? (langs[result.detected_lang] || result.detected_lang) : null;

  return (
    <div style={S.root}>
      {/* ── hero header ── */}
      <div style={S.hero}>
        <div style={S.heroGlow} />
        <div style={S.heroContent}>
          <div style={S.heroIcon}>🌐</div>
          <div>
            <h2 style={S.heroTitle}>Travel Translator</h2>
            <p style={S.heroSub}>Snap, upload or type — translate instantly</p>
          </div>
        </div>
        {/* use case chips */}
        <div style={S.chips}>
          {USE_CASES.map(u => (
            <button key={u.label}
              style={{ ...S.chip, ...(useCase === u.label ? S.chipActive : {}) }}
              onClick={() => setUseCase(useCase === u.label ? null : u.label)}>
              {u.icon} {u.label}
            </button>
          ))}
        </div>
      </div>

      <div style={S.body}>
        {/* ── left panel ── */}
        <div style={S.panel}>

          {/* mode tabs */}
          <div style={S.tabs}>
            {[["upload","📁","Upload"], ["camera","📷","Camera"], ["text","⌨️","Type Text"]].map(([m, ic, lb]) => (
              <button key={m} onClick={() => { setMode(m); setResult(null); setError(null); }}
                style={{ ...S.tab, ...(mode === m ? S.tabActive : {}) }}>
                <span>{ic}</span><span>{lb}</span>
              </button>
            ))}
          </div>

          {/* ── UPLOAD MODE ── */}
          {mode === "upload" && (
            <div style={{ ...S.dropzone, ...(dragOver ? S.dropzoneOver : {}) }}
              onClick={() => fileRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}>
              <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }}
                onChange={e => handleFile(e.target.files[0])} />
              {imagePreview ? (
                <div style={S.previewWrap}>
                  <img src={imagePreview} alt="preview" style={S.preview} />
                  <button style={S.clearBtn} onClick={e => { e.stopPropagation(); setImgPrev(null); setImgB64(null); setResult(null); }}>✕ Clear</button>
                </div>
              ) : (
                <div style={S.dropHint}>
                  <div style={S.dropIcon}>📁</div>
                  <div style={S.dropText}>Drop image here or click to browse</div>
                  <div style={S.dropSub}>Signs · Menus · Notices · Labels</div>
                </div>
              )}
            </div>
          )}

          {/* ── CAMERA MODE ── */}
          {mode === "camera" && (
            <div style={S.cameraWrap}>
              {imagePreview ? (
                <div style={S.previewWrap}>
                  <img src={imagePreview} alt="captured" style={S.preview} />
                  <button style={S.clearBtn} onClick={() => { setImgPrev(null); setImgB64(null); setResult(null); startCamera(); }}>🔄 Retake</button>
                </div>
              ) : (
                <>
                  <video ref={videoRef} autoPlay playsInline muted style={S.video} />
                  <canvas ref={canvasRef} style={{ display:"none" }} />
                  <button style={S.captureBtn} onClick={capturePhoto}>📸 Capture</button>
                  <div style={S.camHint}>Point camera at text to translate</div>
                </>
              )}
            </div>
          )}

          {/* ── TEXT MODE ── */}
          {mode === "text" && (
            <div style={S.textWrap}>
              <textarea style={S.textarea} rows={6}
                placeholder="Type or paste text to translate..."
                value={manualText} onChange={e => { setManual(e.target.value); setResult(null); }} />
              {/* sample texts */}
              <div style={S.sampleRow}>
                <span style={S.sampleLabel}>Try sample:</span>
                {Object.keys(SAMPLE_TEXTS).map(lc => (
                  <button key={lc} style={S.sampleBtn} onClick={() => loadSample(lc)}>
                    {LANG_NAMES[lc]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── language selectors ── */}
          <div style={S.langRow}>
            <div style={S.langBox}>
              <label style={S.langLabel}>FROM</label>
              <select style={S.langSel} value={sourceLang} onChange={e => setSrc(e.target.value)}>
                {Object.entries(langs).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <button style={S.swapBtn} onClick={() => {
              if (sourceLang !== "auto") { setSrc(targetLang); setTgt(sourceLang); }
            }}>⇄</button>
            <div style={S.langBox}>
              <label style={S.langLabel}>TO</label>
              <select style={S.langSel} value={targetLang} onChange={e => setTgt(e.target.value)}>
                {Object.entries(langs).filter(([k]) => k !== "auto").map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          {/* error */}
          {error && <div style={S.error}>⚠️ {error}</div>}

          {/* translate button */}
          <button style={S.translateBtn} onClick={translate} disabled={loading}>
            {loading ? (
              <span style={S.spinner}>⟳ Translating...</span>
            ) : (
              <><span>🌐</span><span>Translate</span></>
            )}
          </button>
        </div>

        {/* ── right panel: result ── */}
        <div style={S.resultPanel}>
          {!result && !loading && (
            <div style={S.resultEmpty}>
              <div style={S.emptyGlobe}>🌏</div>
              <div style={S.emptyTitle}>Translation will appear here</div>
              <div style={S.emptySub}>Upload an image, use camera, or type text</div>
            </div>
          )}

          {loading && (
            <div style={S.resultEmpty}>
              <div style={{ fontSize: 48, animation: "spin 1s linear infinite" }}>⟳</div>
              <div style={S.emptyTitle}>Extracting & Translating...</div>
              <div style={S.emptySub}>Reading text from your image</div>
            </div>
          )}

          {result && !loading && (
            <div style={S.resultContent}>
              {/* detected lang badge */}
              {detectedName && (
                <div style={S.detectedBadge}>
                  🔍 Detected: <b>{detectedName}</b>
                  {result.ocr_engine && <span style={S.engineBadge}>OCR: {result.ocr_engine}</span>}
                </div>
              )}

              {/* no text found */}
              {!result.original && (
                <div style={S.noText}>😶 No text detected in image. Try a clearer photo.</div>
              )}

              {result.original && (
                <>
                  {/* original */}
                  <div style={S.block}>
                    <div style={S.blockHeader}>
                      <span style={S.blockLabel}>📝 Original Text</span>
                      <div style={S.blockActions}>
                        <button style={S.iconBtn} onClick={() => speak(result.original, result.detected_lang)} title="Listen">
                          🔊
                        </button>
                        <button style={S.iconBtn} onClick={() => copy(result.original)} title="Copy">
                          📋
                        </button>
                      </div>
                    </div>
                    <div style={S.blockText}>{result.original}</div>
                  </div>

                  {/* arrow */}
                  <div style={S.arrow}>↓ {langs[result.target_lang] || result.target_lang}</div>

                  {/* translated */}
                  <div style={{ ...S.block, ...S.blockHighlight }}>
                    <div style={S.blockHeader}>
                      <span style={{ ...S.blockLabel, color:"#34d399" }}>✨ Translation</span>
                      <div style={S.blockActions}>
                        <button style={S.iconBtn} onClick={() => speak(result.translated, result.target_lang)} title="Listen">
                          {ttsPlaying ? "⏸" : "🔊"}
                        </button>
                        <button style={S.iconBtn} onClick={() => copy(result.translated)} title="Copy">
                          {copied ? "✓" : "📋"}
                        </button>
                      </div>
                    </div>
                    <div style={{ ...S.blockText, ...S.translatedText }}>{result.translated}</div>
                  </div>

                  {/* AR overlay hint */}
                  {imagePreview && mode !== "text" && (
                    <div style={S.arCard}>
                      <div style={S.arPreviewWrap}>
                        <img src={imagePreview} alt="original" style={S.arImg} />
                        <div style={S.arOverlay}>
                          <div style={S.arText}>{result.translated}</div>
                        </div>
                      </div>
                      <div style={S.arLabel}>🔮 AR Preview — translated text overlaid on image</div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}

// ── STYLES ─────────────────────────────────────────────────────────
const S = {
  root: {
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    color: "#e8e8f0",
    display: "flex", flexDirection: "column", gap: 0,
  },
  // hero
  hero: {
    background: "linear-gradient(135deg, #0d2137 0%, #0a1628 100%)",
    borderBottom: "1px solid #ffffff0a",
    padding: "28px 32px 20px",
    position: "relative", overflow: "hidden",
  },
  heroGlow: {
    position: "absolute", top: -60, right: -60, width: 300, height: 300,
    borderRadius: "50%", background: "radial-gradient(circle, #06b6d430 0%, transparent 70%)",
    pointerEvents: "none",
  },
  heroContent: { display: "flex", alignItems: "center", gap: 16, marginBottom: 16, position: "relative" },
  heroIcon: { fontSize: 40, filter: "drop-shadow(0 0 12px #06b6d4)" },
  heroTitle: { margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px", color: "#fff" },
  heroSub: { margin: 0, fontSize: 13, color: "#94a3b8" },
  chips: { display: "flex", flexWrap: "wrap", gap: 8, position: "relative" },
  chip: {
    padding: "5px 12px", borderRadius: 20, border: "1px solid #ffffff15",
    background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 12, fontWeight: 600,
    transition: "all .15s",
  },
  chipActive: { background: "#06b6d420", border: "1px solid #06b6d460", color: "#06b6d4" },
  // body
  body: {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0,
    minHeight: 520,
  },
  panel: {
    padding: "24px 28px", borderRight: "1px solid #ffffff0a",
    display: "flex", flexDirection: "column", gap: 16,
  },
  // tabs
  tabs: { display: "flex", gap: 6 },
  tab: {
    flex: 1, padding: "9px 8px", borderRadius: 10, border: "1px solid #ffffff0a",
    background: "transparent", color: "#8888a0", cursor: "pointer",
    fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
    transition: "all .15s",
  },
  tabActive: { background: "#06b6d420", border: "1px solid #06b6d440", color: "#06b6d4" },
  // dropzone
  dropzone: {
    border: "2px dashed #ffffff15", borderRadius: 14,
    minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", transition: "all .2s", background: "#ffffff03",
    overflow: "hidden",
  },
  dropzoneOver: { border: "2px dashed #06b6d4", background: "#06b6d408" },
  dropHint: { textAlign: "center", padding: 24 },
  dropIcon: { fontSize: 42, marginBottom: 10 },
  dropText: { fontWeight: 600, fontSize: 14, color: "#e8e8f0", marginBottom: 6 },
  dropSub: { fontSize: 12, color: "#8888a0" },
  previewWrap: { position: "relative", width: "100%", textAlign: "center" },
  preview: { width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 10 },
  clearBtn: {
    position: "absolute", top: 8, right: 8, padding: "4px 10px",
    background: "#00000099", border: "none", color: "#fff",
    borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600,
  },
  // camera
  cameraWrap: {
    borderRadius: 14, overflow: "hidden", background: "#0a0a14",
    border: "1px solid #ffffff0a", minHeight: 200, position: "relative",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
  },
  video: { width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 10 },
  captureBtn: {
    padding: "10px 24px", borderRadius: 24, border: "none",
    background: "linear-gradient(135deg, #06b6d4, #0891b2)",
    color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14,
  },
  camHint: { fontSize: 12, color: "#8888a0" },
  // text
  textWrap: { display: "flex", flexDirection: "column", gap: 10 },
  textarea: {
    width: "100%", padding: "12px 14px", borderRadius: 12,
    background: "#1a1a2e", border: "1px solid #ffffff10",
    color: "#e8e8f0", fontSize: 15, resize: "vertical", outline: "none",
    fontFamily: "inherit", lineHeight: 1.6, boxSizing: "border-box",
  },
  sampleRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  sampleLabel: { fontSize: 11, color: "#8888a0", fontWeight: 600 },
  sampleBtn: {
    padding: "3px 10px", borderRadius: 20, border: "1px solid #ffffff10",
    background: "transparent", color: "#8888a0", cursor: "pointer", fontSize: 11,
    transition: "all .15s",
  },
  // lang row
  langRow: { display: "flex", alignItems: "flex-end", gap: 8 },
  langBox: { flex: 1, display: "flex", flexDirection: "column", gap: 4 },
  langLabel: { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "#8888a0" },
  langSel: {
    padding: "9px 10px", borderRadius: 10,
    background: "#1a1a2e", border: "1px solid #ffffff10",
    color: "#e8e8f0", fontSize: 13, outline: "none", cursor: "pointer",
  },
  swapBtn: {
    padding: "9px 12px", borderRadius: 10, border: "1px solid #ffffff10",
    background: "transparent", color: "#06b6d4", cursor: "pointer", fontSize: 18,
    marginBottom: 0,
  },
  // translate btn
  translateBtn: {
    padding: "13px", borderRadius: 12, border: "none",
    background: "linear-gradient(135deg, #06b6d4, #0284c7)",
    color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    boxShadow: "0 4px 20px #06b6d440",
    transition: "opacity .15s",
  },
  spinner: { animation: "spin 1s linear infinite", display: "inline-block" },
  error: {
    padding: "10px 14px", borderRadius: 10,
    background: "#ef444420", border: "1px solid #ef444440",
    color: "#fca5a5", fontSize: 13,
  },
  // result panel
  resultPanel: {
    padding: "24px 28px", display: "flex", flexDirection: "column",
    background: "#0d0d1a",
  },
  resultEmpty: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center",
  },
  emptyGlobe: { fontSize: 56, filter: "grayscale(0.5)" },
  emptyTitle: { fontWeight: 700, fontSize: 16, color: "#e8e8f0" },
  emptySub: { fontSize: 13, color: "#8888a0" },
  resultContent: {
    display: "flex", flexDirection: "column", gap: 16,
    animation: "fadeUp .3s ease",
  },
  detectedBadge: {
    fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 8,
  },
  engineBadge: {
    padding: "2px 8px", borderRadius: 20, background: "#06b6d420",
    color: "#06b6d4", fontSize: 11, fontWeight: 600,
  },
  noText: {
    padding: "20px", textAlign: "center", color: "#8888a0",
    background: "#ffffff05", borderRadius: 12, fontSize: 14,
  },
  block: {
    background: "#16161f", border: "1px solid #ffffff0a",
    borderRadius: 14, padding: "14px 16px",
  },
  blockHighlight: {
    background: "linear-gradient(135deg, #064e3b20, #0d2137)",
    border: "1px solid #34d39930",
  },
  blockHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  blockLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#8888a0" },
  blockActions: { display: "flex", gap: 6 },
  iconBtn: {
    background: "none", border: "none", cursor: "pointer",
    fontSize: 16, padding: "3px 6px", borderRadius: 6,
    transition: "background .15s",
  },
  blockText: { fontSize: 15, lineHeight: 1.7, color: "#e8e8f0", whiteSpace: "pre-wrap" },
  translatedText: { fontSize: 17, fontWeight: 600, color: "#34d399" },
  arrow: {
    textAlign: "center", fontSize: 13, color: "#06b6d4",
    fontWeight: 700, letterSpacing: 0.5,
  },
  // AR overlay
  arCard: {
    borderRadius: 14, overflow: "hidden",
    border: "1px solid #7c3aed30", background: "#1a0a2e",
  },
  arPreviewWrap: { position: "relative" },
  arImg: { width: "100%", maxHeight: 180, objectFit: "cover", opacity: 0.6 },
  arOverlay: {
    position: "absolute", inset: 0, display: "flex",
    alignItems: "center", justifyContent: "center", padding: 16,
  },
  arText: {
    background: "#7c3aeddd", color: "#fff", padding: "8px 14px",
    borderRadius: 8, fontSize: 14, fontWeight: 700, textAlign: "center",
    boxShadow: "0 4px 20px #7c3aed60", backdropFilter: "blur(4px)",
    maxWidth: "90%", whiteSpace: "pre-wrap",
  },
  arLabel: { padding: "8px 14px", fontSize: 11, color: "#a78bfa", fontWeight: 600 },
};