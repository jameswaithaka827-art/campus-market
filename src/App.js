import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://uqddiaefhzlmyyfvukvy.supabase.co";
const SUPABASE_KEY = "sb_publishable_mClM2coz01LJWVKT81fzSA_do3zD2VL";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const OWNER = {
  mpesa: "0702284988",
  whatsapp: "254702284988",
  name: "CampusMarket",
  commissionRate: 5,
  adPlans: [
    { id: "basic", label: "🚀 Basic Boost", price: 200, days: 3, description: "Top of listings for 3 days" },
    { id: "standard", label: "⭐ Standard", price: 500, days: 7, description: "Featured badge + 7 days top placement" },
    { id: "premium", label: "👑 Premium", price: 1000, days: 14, description: "14 days + priority + homepage spotlight" },
  ],
};

const COLORS = {
  primary: "#6c47ff", grad1: "#6c47ff", grad2: "#ff6b9d",
  accent: "#ffbe0b", danger: "#ff4757", success: "#2ed573",
  bg: "#f0f0f7", card: "#ffffff", text: "#1a1a2e", muted: "#8892a4",
  border: "#e8e8f0", mpesa: "#00a651",
};

const CATEGORIES = [
  { id: "books", label: "Books & Notes", icon: "📚", color: "#6c47ff", bg: "#f0ebff" },
  { id: "electronics", label: "Electronics", icon: "💻", color: "#0088ff", bg: "#e6f3ff" },
  { id: "fashion", label: "Fashion", icon: "👟", color: "#ff6b9d", bg: "#fff0f5" },
  { id: "food", label: "Food & Drinks", icon: "🍔", color: "#ff9f43", bg: "#fff5e6" },
  { id: "housing", label: "Housing", icon: "🏠", color: "#2ed573", bg: "#e8fff2" },
  { id: "services", label: "Services", icon: "🛠️", color: "#5352ed", bg: "#eeeeff" },
  { id: "jobs", label: "Jobs", icon: "💼", color: "#1e90ff", bg: "#e6f4ff" },
  { id: "events", label: "Events", icon: "🎉", color: "#ff4757", bg: "#fff0f0" },
  { id: "lostfound", label: "Lost & Found", icon: "🔍", color: "#e67e22", bg: "#fff4e6" },
];

const SERVICE_TYPE_LABELS = {
  salon: "💇 Salon / Hair", barber: "✂️ Barber", laundry: "🧺 Laundry", tutoring: "📖 Tutoring",
  repair: "🔧 Repair / Tech", photography: "📸 Photography", cleaning: "🧹 Cleaning", other: "✨ Other",
};

const CONDITION_LABELS = {
  new: "🆕 Brand New", like_new: "✨ Like New", good: "👍 Used - Good", fair: "🔧 Used - Fair", refurbished: "♻️ Refurbished",
};

const MEAL_TYPE_LABELS = {
  breakfast: "🍳 Breakfast", lunch: "🍛 Lunch", dinner: "🍽️ Dinner", snacks: "🍟 Snacks", drinks: "🥤 Drinks", baked: "🧁 Baked Goods",
};

const DELIVERY_LABELS = { pickup: "🚶 Pickup only", delivery: "🛵 Delivery available", both: "🔁 Delivery or Pickup" };

function formatPrice(p) { return p === 0 ? "FREE" : "KSh " + Number(p).toLocaleString(); }
function formatKsh(p) { return "KSh " + Number(p).toLocaleString(); }
function timeAgo(d) {
  const diff = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (diff === 0) return "Today"; if (diff === 1) return "Yesterday"; return diff + "d ago";
}
function commission(price) { return Math.round(price * OWNER.commissionRate / 100); }
function formatWhatsApp(num) {
  if (!num) return num;
  num = num.replace(/\s+/g, "").replace(/[^0-9]/g, "");
  if (num.startsWith("0")) num = "254" + num.slice(1);
  if (!num.startsWith("254")) num = "254" + num;
  return num;
}

// ── M-Pesa auto-verification & fraud detection ─────────────────────
// NOTE ON HOW THIS WORKS:
// Safaricom pushes a confirmation to your `mpesa-c2b-confirmation` Edge
// Function the instant someone pays your till/paybill. That function saves
// the real transaction (code, amount, phone) into `mpesa_confirmations`.
// verifyMpesaCode() below checks the code the user typed against THAT table
// — i.e. against what Safaricom itself confirmed, not just what the user says.
// If the `mpesa_confirmations` table is empty/not set up yet (C2B not
// registered), it automatically falls back to format + duplicate checking
// so the app still works during setup/testing.
const MPESA_CODE_REGEX = /^[A-Z0-9]{9,12}$/;

async function verifyMpesaCode({ code, amount, type, listingId, userId }) {
  const clean = (code || "").trim().toUpperCase();
  if (!MPESA_CODE_REGEX.test(clean)) {
    return { ok: false, reason: "invalid_format" };
  }

  // Already used? Always blocked, regardless of which verification mode is active.
  const { data: existing } = await supabase.from("payments").select("id").eq("mpesa_code", clean).maybeSingle();
  if (existing) {
    await supabase.from("fraud_reports").insert({
      listing_id: listingId || null,
      reporter_id: userId || null,
      reason: "Duplicate M-Pesa code reuse",
      details: `Code ${clean} was submitted again for a ${type} payment (KSh ${amount}) but was already used previously.`,
      status: "pending",
      auto: true,
    });
    return { ok: false, reason: "duplicate" };
  }

  // Try real Safaricom-side confirmation first.
  const { data: confirmation } = await supabase.from("mpesa_confirmations").select("*").eq("trans_id", clean).maybeSingle();
  const { count: confirmationsSetUp } = await supabase.from("mpesa_confirmations").select("*", { count: "exact", head: true });

  if (confirmationsSetUp && confirmationsSetUp > 0) {
    // C2B webhook is live — require a real match.
    if (!confirmation) {
      return { ok: false, reason: "not_confirmed" };
    }
    if (Number(confirmation.amount) < Number(amount)) {
      return { ok: false, reason: "amount_mismatch" };
    }
  }
  // else: webhook not set up yet — fall back to format+duplicate check only (dev/testing mode).

  const { error } = await supabase.from("payments").insert({
    listing_id: listingId || null, user_id: userId || null, type, amount, mpesa_code: clean,
    status: confirmation ? "confirmed_by_safaricom" : "verified",
  });
  if (error) return { ok: false, reason: "error" };
  return { ok: true, code: clean };
}

function Pill({ color, bg, children }) {
  return <span style={{ background: bg || color + "22", color, borderRadius: 30, padding: "3px 12px", fontSize: 11, fontWeight: 800, display: "inline-block" }}>{children}</span>;
}

async function uploadImage(file) {
  const ext = file.name.split(".").pop();
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from("listing-images").upload(fileName, file);
  if (error) return null;
  const { data: urlData } = supabase.storage.from("listing-images").getPublicUrl(fileName);
  return urlData.publicUrl;
}

async function uploadToBucket(file, bucket) {
  const ext = file.name.split(".").pop();
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(fileName, file);
  if (error) { console.error(`upload to ${bucket} error:`, error); return null; }
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fileName);
  return urlData.publicUrl;
}

// ── Image Gallery ─────────────────────────────────────────────────
function ImageGallery({ images, icon, onImageTap }) {
  const [current, setCurrent] = useState(0);
  const imgs = images?.filter(Boolean) || [];
  if (imgs.length === 0) return <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 52 }}>{icon || "📦"}</div>;
  return (
    <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
      <img src={imgs[current]} alt="" onClick={onImageTap ? (e => { e.stopPropagation(); onImageTap(current); }) : undefined} style={{ width: "100%", height: "100%", objectFit: "cover", cursor: onImageTap ? "zoom-in" : "default" }} />
      {imgs.length > 1 && <>
        <button onClick={e => { e.stopPropagation(); setCurrent(p => (p - 1 + imgs.length) % imgs.length); }}
          style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", background: "#0006", color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 14 }}>‹</button>
        <button onClick={e => { e.stopPropagation(); setCurrent(p => (p + 1) % imgs.length); }}
          style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "#0006", color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 14 }}>›</button>
        <div style={{ position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 4 }}>
          {imgs.map((_, i) => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === current ? "#fff" : "#ffffff88" }} />)}
        </div>
      </>}
    </div>
  );
}

// ── Fullscreen Image Lightbox ───────────────────────────────────────
function ImageLightbox({ images, startIndex, onClose }) {
  const [current, setCurrent] = useState(startIndex || 0);
  const imgs = images?.filter(Boolean) || [];
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000e", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "#fff2", color: "#fff", border: "none", width: 38, height: 38, borderRadius: "50%", fontSize: 18, cursor: "pointer", zIndex: 1 }}>✕</button>
      <img src={imgs[current]} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: "94vw", maxHeight: "88vh", objectFit: "contain", borderRadius: 8 }} />
      {imgs.length > 1 && <>
        <button onClick={e => { e.stopPropagation(); setCurrent(p => (p - 1 + imgs.length) % imgs.length); }}
          style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", background: "#fff2", color: "#fff", border: "none", borderRadius: "50%", width: 40, height: 40, cursor: "pointer", fontSize: 20 }}>‹</button>
        <button onClick={e => { e.stopPropagation(); setCurrent(p => (p + 1) % imgs.length); }}
          style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "#fff2", color: "#fff", border: "none", borderRadius: "50%", width: 40, height: 40, cursor: "pointer", fontSize: 20 }}>›</button>
        <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>
          {imgs.map((_, i) => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: i === current ? "#fff" : "#ffffff55" }} />)}
        </div>
      </>}
    </div>
  );
}

// ── Notifications Panel ───────────────────────────────────────────
function NotificationsPanel({ notifications, onClose, onMarkRead }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 2000, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: "24px 24px 0 0", maxWidth: 500, width: "100%", maxHeight: "80vh", overflowY: "auto", padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 4, background: "#e8e8f0", borderRadius: 4, margin: "0 auto 20px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>🔔 Notifications</div>
          <button onClick={onMarkRead} style={{ background: "#f0f0f7", border: "none", borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: COLORS.primary }}>Mark all read</button>
        </div>
        {notifications.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: COLORS.muted }}>
            <div style={{ fontSize: 40 }}>🔔</div>
            <div style={{ fontWeight: 700, marginTop: 12 }}>No notifications yet</div>
          </div>
        ) : notifications.map(n => (
          <div key={n.id} style={{ padding: "12px 0", borderBottom: `1px solid ${COLORS.border}`, background: n.read ? "#fff" : "#f5f0ff", borderRadius: 8, paddingLeft: n.read ? 0 : 10, marginBottom: 4 }}>
            <div style={{ fontSize: 13, color: COLORS.text, fontWeight: n.read ? 400 : 700 }}>{n.message}</div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 4 }}>{timeAgo(n.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Active Users Panel ────────────────────────────────────────────
function ActiveUsersPanel({ onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchActive = async () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data } = await supabase.from("profiles").select("name, email, last_seen, is_online").gte("last_seen", fiveMinAgo).order("last_seen", { ascending: false });
      if (data) setUsers(data);
      setLoading(false);
    };
    fetchActive();
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 2000, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: "24px 24px 0 0", maxWidth: 500, width: "100%", maxHeight: "80vh", overflowY: "auto", padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 4, background: "#e8e8f0", borderRadius: 4, margin: "0 auto 20px" }} />
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 16 }}>
          🟢 Active Users <span style={{ fontSize: 14, color: COLORS.success }}>({users.length} online)</span>
        </div>
        {loading ? <div style={{ textAlign: "center", padding: 40, color: COLORS.muted }}>Loading...</div> :
          users.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: COLORS.muted }}>
              <div style={{ fontSize: 40 }}>👥</div>
              <div style={{ fontWeight: 700, marginTop: 12 }}>No active users right now</div>
            </div>
          ) : users.map((u, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${COLORS.border}` }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: COLORS.primary, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: 16, position: "relative" }}>
                {(u.name || u.email)?.[0]?.toUpperCase()}
                <div style={{ position: "absolute", bottom: 0, right: 0, width: 12, height: 12, borderRadius: "50%", background: COLORS.success, border: "2px solid #fff" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name || u.email?.split("@")[0]}</div>
                <div style={{ fontSize: 11, color: COLORS.muted }}>Active {timeAgo(u.last_seen)}</div>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ── M-Pesa Modal ──────────────────────────────────────────────────
function MpesaModal({ amount, reason, onClose, onConfirm, listingId, userId, type }) {
  const [ref, setRef] = useState(""); const [step, setStep] = useState(1);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    if (ref.length < 6 || verifying) return;
    setVerifying(true); setError("");
    const result = await verifyMpesaCode({ code: ref, amount, type, listingId, userId });
    setVerifying(false);
    if (!result.ok) {
      if (result.reason === "duplicate") {
        setError("⚠️ This code has already been used for another payment. This attempt has been flagged and reported for review.");
      } else if (result.reason === "invalid_format") {
        setError("That doesn't look like a valid M-Pesa code — double-check your confirmation SMS and try again.");
      } else if (result.reason === "not_confirmed") {
        setError("We haven't received Safaricom's confirmation for this code yet. If you just paid, wait a few seconds and try again.");
      } else if (result.reason === "amount_mismatch") {
        setError("The confirmed payment amount doesn't match what's required. Please check and try again.");
      } else {
        setError("Couldn't verify that payment right now. Please try again.");
      }
      return;
    }
    onConfirm(result.code);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 24, maxWidth: 400, width: "100%", padding: 28 }} onClick={e => e.stopPropagation()}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 52 }}>📱</div>
          <div style={{ fontWeight: 900, fontSize: 22, color: COLORS.mpesa }}>M-Pesa Payment</div>
          <div style={{ color: COLORS.muted, fontSize: 13 }}>{reason}</div>
        </div>
        <div style={{ background: "#f0fdf4", border: `2px solid ${COLORS.mpesa}`, borderRadius: 16, padding: 16, textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: COLORS.mpesa, fontWeight: 800, textTransform: "uppercase" }}>Send to</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: COLORS.mpesa }}>{OWNER.mpesa}</div>
          <div style={{ fontSize: 13, color: COLORS.muted }}>CampusMarket</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: COLORS.text, marginTop: 8 }}>{formatKsh(amount)}</div>
        </div>
        {step === 1 ? <>
          <div style={{ background: "#f8fafc", borderRadius: 12, padding: 14, marginBottom: 16 }}>
            {["Open M-Pesa on your phone", "Send Money → Enter: " + OWNER.mpesa, "Amount: KSh " + amount.toLocaleString(), "Complete & note your transaction code"].map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, fontSize: 13 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: COLORS.mpesa, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 11, flexShrink: 0 }}>{i + 1}</div>
                {s}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a href={`https://wa.me/${OWNER.whatsapp}?text=Hi! I paid KSh ${amount} for ${reason}. Please confirm.`} target="_blank" rel="noreferrer"
              style={{ flex: 1, background: "#25d366", color: "#fff", border: "none", borderRadius: 12, padding: "11px 0", fontWeight: 700, fontSize: 13, cursor: "pointer", textDecoration: "none", textAlign: "center" }}>
              💬 WhatsApp
            </a>
            <button onClick={() => setStep(2)} style={{ flex: 1, background: COLORS.mpesa, color: "#fff", border: "none", borderRadius: 12, padding: "11px 0", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>I've Paid →</button>
          </div>
        </> : <>
          <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 8 }}>Enter M-Pesa code</label>
          <input value={ref} onChange={e => { setRef(e.target.value.toUpperCase()); setError(""); }} placeholder="e.g. QHX7YZ1234"
            style={{ width: "100%", padding: "14px", borderRadius: 12, border: `2px solid ${error ? COLORS.danger : COLORS.mpesa}`, fontSize: 18, fontWeight: 800, letterSpacing: 3, boxSizing: "border-box", textAlign: "center", outline: "none", marginBottom: error ? 8 : 12 }} />
          {error && <div style={{ background: "#fff0f0", color: COLORS.danger, borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 700, marginBottom: 12 }}>{error}</div>}
          <button onClick={handleConfirm} disabled={ref.length < 6 || verifying}
            style={{ width: "100%", background: ref.length >= 6 && !verifying ? COLORS.mpesa : "#d1fae5", color: ref.length >= 6 && !verifying ? "#fff" : COLORS.mpesa, border: "none", borderRadius: 12, padding: "13px 0", fontWeight: 900, fontSize: 15, cursor: ref.length >= 6 && !verifying ? "pointer" : "default" }}>
            {verifying ? "🔍 Verifying…" : "✅ Confirm Payment"}
          </button>
          <button onClick={() => { setStep(1); setError(""); }} style={{ width: "100%", background: "none", border: "none", color: COLORS.muted, fontSize: 13, marginTop: 10, cursor: "pointer" }}>← Back</button>
        </>}
      </div>
    </div>
  );
}

// ── Auth Screen ───────────────────────────────────────────────────
function AuthScreen({ onAuth, onGuest, onClose }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", whatsapp: "", account_type: "student", business_name: "", business_location: "" });
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [idFile, setIdFile] = useState(null);
  const [idPreview, setIdPreview] = useState(null);
  const [wantVerify, setWantVerify] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isBusiness = form.account_type === "business";
  const isStudent = form.account_type === "student";

  const handleLogin = async () => {
    setError(""); setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
    if (error) { setError(error.message); setLoading(false); return; }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).single();
    await supabase.from("profiles").update({ last_seen: new Date().toISOString(), is_online: true }).eq("id", data.user.id);
    onAuth({ ...data.user, ...profile });
    setLoading(false);
  };

  const handleSignup = async () => {
    setError("");
    if (!form.name.trim()) return setError("Enter your name.");
    if (isBusiness && !form.business_name.trim()) return setError("Enter your business name.");
    if (isBusiness && !form.business_location.trim()) return setError("Enter your business location.");
    if (isStudent && wantVerify && !idFile) return setError("Upload a photo of your school ID, or turn off verification to join without it.");
    if (form.password.length < 6) return setError("Password must be at least 6 characters.");
    if (form.password !== form.confirm) return setError("Passwords don't match!");
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email: form.email, password: form.password });
    if (error) { setError(error.message); setLoading(false); return; }
    const wa = formatWhatsApp(form.whatsapp);
    let avatarUrl = null;
    if (avatarFile) avatarUrl = await uploadImage(avatarFile);
    const referredBy = new URLSearchParams(window.location.search).get("ref") || null;
    const profileData = {
      id: data.user.id, name: form.name, email: form.email, whatsapp: wa, role: "student", account_type: form.account_type,
      business_name: isBusiness ? form.business_name.trim() : null,
      business_location: isBusiness ? form.business_location.trim() : null,
      avatar_url: avatarUrl, verified: false, referred_by: referredBy && referredBy !== data.user.id ? referredBy : null,
      last_seen: new Date().toISOString(), is_online: true,
    };
    await supabase.from("profiles").insert(profileData);
    if (isStudent && wantVerify && idFile) {
      const idUrl = await uploadToBucket(idFile, "id-verifications");
      if (idUrl) {
        await supabase.from("verifications").insert({ user_id: data.user.id, id_image_url: idUrl, status: "pending" });
      }
    }
    onAuth({ ...data.user, ...profileData });
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", fontFamily: "'Segoe UI', system-ui, sans-serif", background: `linear-gradient(135deg, ${COLORS.grad1} 0%, ${COLORS.grad2} 100%)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ textAlign: "center", marginBottom: 28, color: "#fff" }}>
        <div style={{ fontSize: 56 }}>🎓</div>
        <div style={{ fontWeight: 900, fontSize: 32, letterSpacing: -1, marginTop: 4 }}>CampusMarket</div>
        <div style={{ fontSize: 15, opacity: 0.9, marginTop: 6, fontStyle: "italic" }}>Built by students, for students 🔥</div>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
          {["📚 Buy & Sell", "💼 Find Jobs", "🎉 Discover Events", "💬 WhatsApp Connect"].map(t => (
            <div key={t} style={{ background: "rgba(255,255,255,0.2)", borderRadius: 30, padding: "6px 16px", fontSize: 12, fontWeight: 700 }}>{t}</div>
          ))}
        </div>
      </div>
      <div style={{ background: "#fff", borderRadius: 24, width: "100%", maxWidth: 420, padding: 28, boxShadow: "0 30px 80px #0005", position: "relative" }}>
        {onClose && <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "#f0f0f7", border: "none", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 15 }}>✕</button>}
        <div style={{ display: "flex", background: "#f0f0f7", borderRadius: 14, padding: 4, marginBottom: 24 }}>
          {[["login", "Sign In"], ["signup", "Join Free"]].map(([m, l]) => (
            <button key={m} onClick={() => { setMode(m); setError(""); }} style={{ flex: 1, padding: "10px 0", borderRadius: 11, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 14, background: mode === m ? `linear-gradient(135deg, ${COLORS.grad1}, ${COLORS.grad2})` : "transparent", color: mode === m ? "#fff" : COLORS.muted }}>
              {l}
            </button>
          ))}
        </div>
        {error && <div style={{ background: "#fff0f0", borderRadius: 12, padding: "10px 14px", color: COLORS.danger, fontSize: 13, fontWeight: 700, marginBottom: 14 }}>⚠️ {error}</div>}
        {mode === "signup" && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>Your Name</label>
            <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. James Waithaka" style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", outline: "none" }} />
          </div>
        )}
        {mode === "signup" && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>I am a...</label>
            <div style={{ display: "flex", gap: 6 }}>
              {[["student", "🎓 Student"], ["business", "🏪 Business Owner"], ["customer", "🛍️ Customer"]].map(([v, l]) => (
                <div key={v} onClick={() => set("account_type", v)} style={{ flex: 1, textAlign: "center", padding: "9px 4px", borderRadius: 11, border: `2px solid ${form.account_type === v ? COLORS.primary : COLORS.border}`, background: form.account_type === v ? "#f5f0ff" : "#fff", color: form.account_type === v ? COLORS.primary : COLORS.muted, fontWeight: 800, fontSize: 11, cursor: "pointer" }}>{l}</div>
              ))}
            </div>
            {form.account_type === "customer" && <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 6 }}>Customers can browse and buy, but can't post listings.</div>}
          </div>
        )}
        {mode === "signup" && isBusiness && (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>Business Name</label>
              <input value={form.business_name} onChange={e => set("business_name", e.target.value)} placeholder="e.g. TechHub Kenya" style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", outline: "none" }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>Business Location</label>
              <input value={form.business_location} onChange={e => set("business_location", e.target.value)} placeholder="e.g. Zetech University, Ruiru Branch" style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", outline: "none" }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>Business Photo / Logo <span style={{ fontWeight: 400, color: COLORS.muted }}>(optional — add now or later)</span></label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, border: `2px dashed ${COLORS.border}`, borderRadius: 12, padding: "10px 14px", cursor: "pointer" }}>
                {avatarPreview
                  ? <img src={avatarPreview} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover" }} />
                  : <span style={{ fontSize: 20 }}>🏪</span>}
                <span style={{ fontSize: 13, color: COLORS.muted, fontWeight: 700 }}>{avatarPreview ? "Change photo" : "Upload a photo"}</span>
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                  const file = e.target.files[0];
                  if (file) { setAvatarFile(file); setAvatarPreview(URL.createObjectURL(file)); }
                }} />
              </label>
            </div>
          </>
        )}
        {mode === "signup" && isStudent && (
          <div style={{ marginBottom: 14, border: `2px solid ${wantVerify ? "#f6c945" : COLORS.border}`, borderRadius: 14, padding: 14, background: wantVerify ? "#fffbe8" : "#fafafd" }}>
            <div onClick={() => setWantVerify(v => !v)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <div style={{ width: 22, height: 22, borderRadius: 7, border: `2px solid ${wantVerify ? "#d4a017" : COLORS.border}`, background: wantVerify ? "#f6c945" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{wantVerify ? "✓" : ""}</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 13 }}>🥇 Get Verified Student badge</div>
                <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>Optional — upload your school ID now for a gold badge on your listings. Skip this and join normally if you'd rather not.</div>
              </div>
            </div>
            {wantVerify && (
              <label style={{ display: "flex", alignItems: "center", gap: 10, border: `2px dashed #d4a017`, borderRadius: 12, padding: "10px 14px", cursor: "pointer", marginTop: 12, background: "#fff" }}>
                {idPreview
                  ? <img src={idPreview} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }} />
                  : <span style={{ fontSize: 20 }}>🪪</span>}
                <span style={{ fontSize: 13, color: "#92750f", fontWeight: 700 }}>{idPreview ? "Change ID photo" : "Upload a photo of your school ID"}</span>
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                  const file = e.target.files[0];
                  if (file) { setIdFile(file); setIdPreview(URL.createObjectURL(file)); }
                }} />
              </label>
            )}
            {wantVerify && <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 8 }}>An admin reviews this before your badge appears — usually quick. Your ID photo isn't shown publicly.</div>}
          </div>
        )}
        {[["Email Address", "email", "email", "you@university.edu"], ["Password", "password", "password", "At least 6 characters"]].map(([l, k, t, ph]) => (
          <div key={k} style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>{l}</label>
            <input value={form[k]} onChange={e => set(k, e.target.value)} type={t} placeholder={ph} style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", outline: "none" }} />
          </div>
        ))}
        {mode === "signup" && <>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>Confirm Password</label>
            <input value={form.confirm} onChange={e => set("confirm", e.target.value)} type="password" placeholder="Repeat your password" style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", outline: "none" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>WhatsApp Number (optional)</label>
            <input value={form.whatsapp} onChange={e => set("whatsapp", e.target.value)} placeholder="e.g. 0702284988" style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", outline: "none" }} />
          </div>
        </>}
        <button onClick={mode === "login" ? handleLogin : handleSignup} disabled={loading}
          style={{ width: "100%", background: `linear-gradient(135deg, ${COLORS.grad1}, ${COLORS.grad2})`, color: "#fff", border: "none", borderRadius: 14, padding: "14px 0", fontWeight: 900, fontSize: 16, cursor: "pointer", marginTop: 4, opacity: loading ? 0.7 : 1 }}>
          {loading ? "Please wait..." : mode === "login" ? "Let's Go 🚀" : "Join the Marketplace 🎓"}
        </button>
        <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: COLORS.muted }}>
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }} style={{ background: "none", border: "none", color: COLORS.primary, fontWeight: 800, cursor: "pointer", fontSize: 13 }}>
            {mode === "login" ? "Join free →" : "Sign in →"}
          </button>
        </div>
        {onGuest && (
          <button onClick={onGuest} style={{ width: "100%", background: "none", border: "none", color: COLORS.muted, fontSize: 13, fontWeight: 700, marginTop: 14, cursor: "pointer", textDecoration: "underline" }}>
            👀 Just browsing — continue without an account
          </button>
        )}
        {mode === "signup" && (
          <div style={{ textAlign: "center", fontSize: 11, color: COLORS.muted, marginTop: 14 }}>
            By joining, you agree to our{" "}
            <button onClick={() => setShowTerms(true)} style={{ background: "none", border: "none", color: COLORS.primary, fontWeight: 700, cursor: "pointer", fontSize: 11, textDecoration: "underline", padding: 0 }}>Terms & Privacy Policy</button>
          </div>
        )}
      </div>
      <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 20, textAlign: "center" }}>
        🔒 Safe & secure · 💸 Free to join · 📱 WhatsApp connected
      </div>
      {showTerms && <TermsModal onClose={() => setShowTerms(false)} />}
    </div>
  );
}

// ── Post Form ─────────────────────────────────────────────────────
function PostForm({ onSubmit, onClose, initial }) {
  const [form, setForm] = useState(initial || { title: "", price: "", category: "books", location: "", description: "", whatsapp: "", lf_status: "lost", job_type: "part-time", pay_rate: "per month", requirements: "", deadline: "", service_type: "", service_rate: "per session", meal_type: "", delivery_option: "pickup", condition: "", brand: "", rooms: "", rent_period: "monthly", deposit_required: "" });
  const [loading, setLoading] = useState(false);
  const [imageFiles, setImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState(initial?.images || []);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isLF = form.category === "lostfound";
  const isJob = form.category === "jobs";
  const isService = form.category === "services";
  const isFood = form.category === "food";
  const isFashion = form.category === "fashion";
  const isHousing = form.category === "housing";
  const showsCondition = ["electronics", "fashion", "books", "housing"].includes(form.category);
  const JOB_TYPES = ["Part-time", "Full-time", "Gig / One-off", "Internship"];
  const PAY_RATES = ["per hour", "per day", "per job", "per month"];
  const SERVICE_TYPES = [["salon", "💇 Salon / Hair"], ["barber", "✂️ Barber"], ["laundry", "🧺 Laundry"], ["tutoring", "📖 Tutoring"], ["repair", "🔧 Repair / Tech"], ["photography", "📸 Photography"], ["cleaning", "🧹 Cleaning"], ["other", "✨ Other"]];
  const SERVICE_RATES = ["per session", "per hour", "per item", "fixed price"];
  const CONDITIONS = [["new", "🆕 Brand New"], ["like_new", "✨ Like New"], ["good", "👍 Used - Good"], ["fair", "🔧 Used - Fair"], ["refurbished", "♻️ Refurbished"]];
  const MEAL_TYPES = [["breakfast", "🍳 Breakfast"], ["lunch", "🍛 Lunch"], ["dinner", "🍽️ Dinner"], ["snacks", "🍟 Snacks"], ["drinks", "🥤 Drinks"], ["baked", "🧁 Baked Goods"]];
  const RENT_PERIODS = ["monthly", "termly", "yearly"];
  const DELIVERY_OPTIONS = [["pickup", "🚶 Pickup only"], ["delivery", "🛵 Delivery available"], ["both", "🔁 Both"]];

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files).slice(0, 5 - imagePreviews.length);
    setImageFiles(p => [...p, ...files]);
    setImagePreviews(p => [...p, ...files.map(f => URL.createObjectURL(f))]);
  };

  const removeImage = (index) => {
    setImageFiles(p => p.filter((_, i) => i !== index));
    setImagePreviews(p => p.filter((_, i) => i !== index));
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: "24px 24px 0 0", maxWidth: 500, width: "100%", maxHeight: "92vh", overflowY: "auto", padding: 24 }}>
        <div style={{ width: 40, height: 4, background: "#e8e8f0", borderRadius: 4, margin: "0 auto 20px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontWeight: 900, fontSize: 20 }}>{initial ? "✏️ Edit Listing" : "📦 New Listing"}</div>
          <button onClick={onClose} style={{ background: "#f0f0f7", border: "none", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>📸 Add Photos (up to 5)</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {imagePreviews.map((src, i) => (
              <div key={i} style={{ position: "relative", width: 80, height: 80 }}>
                <img src={src} alt="" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 10 }} />
                <button onClick={() => removeImage(i)} style={{ position: "absolute", top: -6, right: -6, background: COLORS.danger, color: "#fff", border: "none", borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: 12 }}>✕</button>
              </div>
            ))}
            {imagePreviews.length < 5 && (
              <div onClick={() => document.getElementById("imgInput").click()}
                style={{ width: 80, height: 80, border: `2px dashed ${COLORS.border}`, borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "#f8fafc" }}>
                <div style={{ fontSize: 24 }}>📷</div>
                <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 2 }}>Add</div>
              </div>
            )}
          </div>
          <input id="imgInput" type="file" accept="image/*" multiple onChange={handleImageChange} style={{ display: "none" }} />
          <div style={{ fontSize: 11, color: COLORS.muted }}>{imagePreviews.length}/5 photos added</div>
        </div>
        {isLF && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Is this item...</label>
            <div style={{ display: "flex", gap: 8 }}>
              <div onClick={() => set("lf_status", "lost")} style={{ flex: 1, textAlign: "center", padding: "10px 0", borderRadius: 12, border: `2px solid ${form.lf_status === "lost" ? COLORS.danger : COLORS.border}`, background: form.lf_status === "lost" ? "#fff0f0" : "#fff", color: form.lf_status === "lost" ? COLORS.danger : COLORS.text, fontWeight: 800, cursor: "pointer" }}>😢 Lost</div>
              <div onClick={() => set("lf_status", "found")} style={{ flex: 1, textAlign: "center", padding: "10px 0", borderRadius: 12, border: `2px solid ${form.lf_status === "found" ? COLORS.success : COLORS.border}`, background: form.lf_status === "found" ? "#f0fdf4" : "#fff", color: form.lf_status === "found" ? COLORS.success : COLORS.text, fontWeight: 800, cursor: "pointer" }}>🎉 Found</div>
            </div>
          </div>
        )}
        {isJob && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Job Type</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {JOB_TYPES.map(t => (
                  <div key={t} onClick={() => set("job_type", t.toLowerCase())} style={{ padding: "8px 14px", borderRadius: 30, border: `2px solid ${form.job_type === t.toLowerCase() ? COLORS.primary : COLORS.border}`, background: form.job_type === t.toLowerCase() ? "#f5f0ff" : "#fff", color: form.job_type === t.toLowerCase() ? COLORS.primary : COLORS.text, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{t}</div>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Pay Rate</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {PAY_RATES.map(r => (
                  <div key={r} onClick={() => set("pay_rate", r)} style={{ padding: "8px 14px", borderRadius: 30, border: `2px solid ${form.pay_rate === r ? COLORS.primary : COLORS.border}`, background: form.pay_rate === r ? "#f5f0ff" : "#fff", color: form.pay_rate === r ? COLORS.primary : COLORS.text, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{r}</div>
                ))}
              </div>
            </div>
          </>
        )}
        {isFood && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Meal Type</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {MEAL_TYPES.map(([id, label]) => (
                  <div key={id} onClick={() => set("meal_type", id)} style={{ padding: "8px 14px", borderRadius: 30, border: `2px solid ${form.meal_type === id ? COLORS.primary : COLORS.border}`, background: form.meal_type === id ? "#f5f0ff" : "#fff", color: form.meal_type === id ? COLORS.primary : COLORS.text, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{label}</div>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Delivery / Pickup</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {DELIVERY_OPTIONS.map(([id, label]) => (
                  <div key={id} onClick={() => set("delivery_option", id)} style={{ padding: "8px 14px", borderRadius: 30, border: `2px solid ${form.delivery_option === id ? COLORS.primary : COLORS.border}`, background: form.delivery_option === id ? "#f5f0ff" : "#fff", color: form.delivery_option === id ? COLORS.primary : COLORS.text, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{label}</div>
                ))}
              </div>
            </div>
          </>
        )}
        {isService && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>What kind of service?</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {SERVICE_TYPES.map(([id, label]) => (
                <div key={id} onClick={() => set("service_type", id)} style={{ padding: "8px 14px", borderRadius: 30, border: `2px solid ${form.service_type === id ? COLORS.primary : COLORS.border}`, background: form.service_type === id ? "#f5f0ff" : "#fff", color: form.service_type === id ? COLORS.primary : COLORS.text, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{label}</div>
              ))}
            </div>
          </div>
        )}
        {[["What are you selling?", "title", "text", "e.g. Chemistry Textbook"], ["Price in KSh (0 = free)", "price", "number", "e.g. 2000"], ["Where on campus?", "location", "text", "e.g. Main Gate / Library"], ["Your WhatsApp (e.g. 0702284988)", "whatsapp", "text", "e.g. 0702284988"]]
          .filter(([, k]) => !(isLF && k === "price"))
          .map(([l, k, t, ph]) => (
          <div key={k} style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>
              {isLF && k === "title" ? "What's the item?" : isLF && k === "location" ? (form.lf_status === "lost" ? "Where did you lose it?" : "Where did you find it?")
                : isJob && k === "title" ? "Job Title" : isJob && k === "price" ? `Pay (KSh, ${form.pay_rate})` : isJob && k === "location" ? "Location"
                : isService && k === "title" ? "Service Name" : isService && k === "price" ? `Price (KSh, ${form.service_rate})`
                : isFood && k === "title" ? "Item Name" : l}
            </label>
            <input value={form[k]} onChange={e => set(k, e.target.value)} type={t} placeholder={isJob && k === "title" ? "e.g. Weekend Cashier Needed" : isService && k === "title" ? "e.g. Home Haircuts & Trims" : isFood && k === "title" ? "e.g. Homemade Chapati & Beans" : ph} style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", outline: "none", fontFamily: "inherit" }} />
          </div>
        ))}
        {isService && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Rate</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {SERVICE_RATES.map(r => (
                <div key={r} onClick={() => set("service_rate", r)} style={{ padding: "8px 14px", borderRadius: 30, border: `2px solid ${form.service_rate === r ? COLORS.primary : COLORS.border}`, background: form.service_rate === r ? "#f5f0ff" : "#fff", color: form.service_rate === r ? COLORS.primary : COLORS.text, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{r}</div>
              ))}
            </div>
          </div>
        )}
        {isJob && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Requirements / Qualifications</label>
              <textarea value={form.requirements} onChange={e => set("requirements", e.target.value)} rows={2} placeholder="e.g. Must be available weekends, good with customers"
                style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", outline: "none" }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Application Deadline (optional)</label>
              <input value={form.deadline} onChange={e => set("deadline", e.target.value)} type="date"
                style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", outline: "none", fontFamily: "inherit" }} />
            </div>
          </>
        )}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Category</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {CATEGORIES.map(c => (
              <div key={c.id} onClick={() => set("category", c.id)} style={{ padding: "10px 14px", borderRadius: 12, border: `2px solid ${form.category === c.id ? c.color : COLORS.border}`, background: form.category === c.id ? c.bg : "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13, color: form.category === c.id ? c.color : COLORS.text }}>
                {c.icon} {c.label}
              </div>
            ))}
          </div>
        </div>
        {showsCondition && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Condition</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {CONDITIONS.map(([id, label]) => (
                <div key={id} onClick={() => set("condition", id)} style={{ padding: "8px 14px", borderRadius: 30, border: `2px solid ${form.condition === id ? COLORS.primary : COLORS.border}`, background: form.condition === id ? "#f5f0ff" : "#fff", color: form.condition === id ? COLORS.primary : COLORS.text, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{label}</div>
              ))}
            </div>
          </div>
        )}
        {isFashion && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Brand (optional)</label>
            <input value={form.brand} onChange={e => set("brand", e.target.value)} placeholder="e.g. Nike, Zara, Adidas"
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", outline: "none", fontFamily: "inherit" }} />
          </div>
        )}
        {isHousing && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Number of Rooms</label>
              <input value={form.rooms} onChange={e => set("rooms", e.target.value)} type="number" placeholder="e.g. 1"
                style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", outline: "none", fontFamily: "inherit" }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Rent Period</label>
              <div style={{ display: "flex", gap: 8 }}>
                {RENT_PERIODS.map(p => (
                  <div key={p} onClick={() => set("rent_period", p)} style={{ flex: 1, textAlign: "center", padding: "9px 0", borderRadius: 30, border: `2px solid ${form.rent_period === p ? COLORS.primary : COLORS.border}`, background: form.rent_period === p ? "#f5f0ff" : "#fff", color: form.rent_period === p ? COLORS.primary : COLORS.text, fontWeight: 700, fontSize: 12, cursor: "pointer", textTransform: "capitalize" }}>{p}</div>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Deposit Required?</label>
              <div style={{ display: "flex", gap: 8 }}>
                <div onClick={() => set("deposit_required", "yes")} style={{ flex: 1, textAlign: "center", padding: "9px 0", borderRadius: 12, border: `2px solid ${form.deposit_required === "yes" ? COLORS.danger : COLORS.border}`, background: form.deposit_required === "yes" ? "#fff0f0" : "#fff", color: form.deposit_required === "yes" ? COLORS.danger : COLORS.text, fontWeight: 700, cursor: "pointer" }}>Yes</div>
                <div onClick={() => set("deposit_required", "no")} style={{ flex: 1, textAlign: "center", padding: "9px 0", borderRadius: 12, border: `2px solid ${form.deposit_required === "no" ? COLORS.success : COLORS.border}`, background: form.deposit_required === "no" ? "#f0fdf4" : "#fff", color: form.deposit_required === "no" ? COLORS.success : COLORS.text, fontWeight: 700, cursor: "pointer" }}>No</div>
              </div>
            </div>
          </>
        )}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Description</label>
          <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} placeholder="Describe what you're selling…" style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", outline: "none" }} />
        </div>
        {!isLF && (
          <div style={{ background: "#fffbeb", borderRadius: 12, padding: 12, marginBottom: 16, fontSize: 13, color: "#92400e", fontWeight: 600 }}>
            💡 A {OWNER.commissionRate}% fee applies when your item sells. Pay via M-Pesa to {OWNER.mpesa}.
          </div>
        )}
        {isLF && (
          <div style={{ background: "#fff4e6", borderRadius: 12, padding: 12, marginBottom: 16, fontSize: 13, color: "#92400e", fontWeight: 600 }}>
            🔍 Lost & Found posts are free. Use the in-app chat to arrange handover safely.
          </div>
        )}
        <button onClick={async () => {
          setLoading(true);
          let uploadedUrls = imagePreviews.filter(p => p.startsWith("http"));
          for (const file of imageFiles) {
            const url = await uploadImage(file);
            if (url) uploadedUrls.push(url);
          }
          const payload = { ...form, whatsapp: formatWhatsApp(form.whatsapp), images: uploadedUrls, image_url: uploadedUrls[0] || null };
          if (isLF) { payload.price = 0; } else { payload.lf_status = null; }
          if (!isJob) { payload.job_type = null; payload.pay_rate = null; payload.requirements = null; payload.deadline = null; }
          if (!isService) { payload.service_type = null; payload.service_rate = null; }
          if (!isFood) { payload.meal_type = null; payload.delivery_option = null; }
          if (!showsCondition) { payload.condition = null; }
          if (!isFashion) { payload.brand = null; }
          if (!isHousing) { payload.rooms = null; payload.rent_period = null; payload.deposit_required = null; }
          await onSubmit(payload);
          setLoading(false);
        }} disabled={loading}
          style={{ width: "100%", background: `linear-gradient(135deg, ${COLORS.grad1}, ${COLORS.grad2})`, color: "#fff", border: "none", borderRadius: 14, padding: "14px 0", fontWeight: 900, fontSize: 16, cursor: "pointer" }}>
          {loading ? `Uploading ${imageFiles.length} photo(s)...` : initial ? "Save Changes ✅" : "Post Listing 🚀"}
        </button>
      </div>
    </div>
  );
}

// ── Listing Card ──────────────────────────────────────────────────
function ListingCard({ listing, onOpen, currentUser, onDelete, onEdit, onBoost, onMarkSold, onLike, likedIds, onToggleWatch, watchlistIds }) {
  const cat = CATEGORIES.find(c => c.id === listing.category);
  const isOwner = currentUser?.id === listing.seller_id || currentUser?.role === "admin";
  const isLiked = likedIds?.includes(listing.id);
  const isWatched = watchlistIds?.includes(listing.id);
  const images = listing.images || (listing.image_url ? [listing.image_url] : []);
  return (
    <div onClick={() => onOpen(listing)} style={{ background: "#fff", borderRadius: 20, overflow: "hidden", cursor: "pointer", boxShadow: listing.sponsored ? `0 0 0 3px ${COLORS.primary}, 0 8px 30px #6c47ff22` : "0 2px 12px #0001", position: "relative", opacity: listing.sold ? 0.65 : 1 }}>
      {listing.sponsored && <div style={{ position: "absolute", top: 10, left: 10, zIndex: 2, background: `linear-gradient(135deg, ${COLORS.grad1}, ${COLORS.grad2})`, color: "#fff", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 800 }}>⭐ Featured</div>}
      {listing.sold && <div style={{ position: "absolute", top: 10, right: 10, zIndex: 2, background: COLORS.success, color: "#fff", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 800 }}>✅ Sold</div>}
      {!listing.sold && onToggleWatch && (
        <button onClick={e => { e.stopPropagation(); onToggleWatch(listing.id); }} style={{ position: "absolute", top: 10, right: 10, zIndex: 2, background: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 13, boxShadow: "0 2px 8px #0002" }}>
          {isWatched ? "🔖" : "📑"}
        </button>
      )}
      <div style={{ height: 130, overflow: "hidden", background: cat?.bg || "#f5f5ff" }}>
        <ImageGallery images={images} icon={cat?.icon} />
      </div>
      <div style={{ padding: "12px 14px 14px" }}>
        <div style={{ marginBottom: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
          <Pill color={cat?.color} bg={cat?.bg}>{cat?.icon} {cat?.label}</Pill>
          {listing.category === "jobs" && listing.job_type && <Pill color="#1e90ff" bg="#e6f4ff">{listing.job_type}</Pill>}
          {listing.category === "services" && listing.service_type && <Pill color="#5352ed" bg="#eeeeff">{SERVICE_TYPE_LABELS[listing.service_type]}</Pill>}
          {listing.category === "food" && listing.meal_type && <Pill color="#ff9f43" bg="#fff5e6">{MEAL_TYPE_LABELS[listing.meal_type]}</Pill>}
          {listing.condition && <Pill color={COLORS.success} bg="#f0fdf4">{CONDITION_LABELS[listing.condition]}</Pill>}
          {listing.category === "fashion" && listing.brand && <Pill color="#ff6b9d" bg="#fff0f5">🏷️ {listing.brand}</Pill>}
          {listing.category === "housing" && listing.rooms && <Pill color="#2ed573" bg="#e8fff2">🛏️ {listing.rooms} room{Number(listing.rooms) !== 1 ? "s" : ""}</Pill>}
        </div>
        <div style={{ fontWeight: 800, fontSize: 14, color: COLORS.text, lineHeight: 1.3, marginBottom: 4 }}>{listing.title}</div>
        <div style={{ fontWeight: 900, fontSize: 18, color: COLORS.primary, marginBottom: 6 }}>
          {listing.category === "lostfound"
            ? (listing.lf_status === "found" ? <span style={{ color: COLORS.success }}>🎉 FOUND</span> : <span style={{ color: COLORS.danger }}>😢 LOST</span>)
            : listing.category === "jobs"
            ? <>{formatPrice(listing.price)} <span style={{ fontSize: 11, color: COLORS.muted, fontWeight: 600 }}>{listing.pay_rate}</span></>
            : listing.category === "services"
            ? <>{formatPrice(listing.price)} <span style={{ fontSize: 11, color: COLORS.muted, fontWeight: 600 }}>{listing.service_rate}</span></>
            : listing.category === "housing" && listing.rent_period
            ? <>{formatPrice(listing.price)} <span style={{ fontSize: 11, color: COLORS.muted, fontWeight: 600 }}>/{listing.rent_period}</span></>
            : formatPrice(listing.price)}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: COLORS.muted, marginBottom: 4 }}>
          <span>📍 {listing.location}</span>
          <span>🕐 {timeAgo(listing.created_at)}</span>
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 12, color: COLORS.muted }}>
          <span>👁 {listing.views || 0}</span>
          <button onClick={e => { e.stopPropagation(); onLike(listing.id); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: isLiked ? COLORS.danger : COLORS.muted, fontWeight: isLiked ? 800 : 400, padding: 0 }}>
            {isLiked ? "❤️" : "🤍"} {listing.likes || 0}
          </button>
          {images.length > 1 && <span>🖼 {images.length}</span>}
        </div>
        {isOwner && !listing.sold && (
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
            <button onClick={() => onEdit(listing)} style={{ flex: 1, minWidth: 55, padding: "6px 0", borderRadius: 10, border: `1.5px solid ${COLORS.primary}`, background: "#fff", color: COLORS.primary, fontWeight: 800, fontSize: 11, cursor: "pointer" }}>✏️ Edit</button>
            <button onClick={() => onBoost(listing)} style={{ flex: 1, minWidth: 55, padding: "6px 0", borderRadius: 10, border: `1.5px solid ${COLORS.accent}`, background: "#fff", color: "#b45309", fontWeight: 800, fontSize: 11, cursor: "pointer" }}>🚀 Boost</button>
            <button onClick={() => onMarkSold(listing)} style={{ flex: 1, minWidth: 55, padding: "6px 0", borderRadius: 10, border: `1.5px solid ${COLORS.success}`, background: "#fff", color: "#059669", fontWeight: 800, fontSize: 11, cursor: "pointer" }}>✅ Sold</button>
            <button onClick={() => onDelete(listing.id)} style={{ flex: 1, minWidth: 55, padding: "6px 0", borderRadius: 10, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontWeight: 800, fontSize: 11, cursor: "pointer" }}>🗑️</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Listing Modal ─────────────────────────────────────────────────
function ListingModal({ listing, onClose, currentUser, onBoost, onMarkSold, onLike, likedIds, onReport, onToggleWatch, watchlistIds, onOpenChat, onMarkResolved, requireLogin }) {
  const [revealed, setRevealed] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const cat = CATEGORIES.find(c => c.id === listing.category);
  const isOwner = currentUser?.id === listing.seller_id || currentUser?.role === "admin";
  const isLiked = likedIds?.includes(listing.id);
  const isWatched = watchlistIds?.includes(listing.id);
  const images = listing.images || (listing.image_url ? [listing.image_url] : []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: "24px 24px 0 0", maxWidth: 500, width: "100%", maxHeight: "92vh", overflowY: "auto", padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 4, background: "#e8e8f0", borderRadius: 4, margin: "0 auto 20px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <Pill color={cat?.color} bg={cat?.bg}>{cat?.icon} {cat?.label}</Pill>
          <div style={{ display: "flex", gap: 8 }}>
            {!listing.sold && onToggleWatch && (
              <button onClick={() => onToggleWatch(listing.id)} style={{ background: isWatched ? "#fff8e1" : "#f0f0f7", border: "none", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 15 }}>{isWatched ? "🔖" : "📑"}</button>
            )}
            <button onClick={onClose} style={{ background: "#f0f0f7", border: "none", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
        </div>
        <div style={{ height: 220, overflow: "hidden", background: cat?.bg || "#f5f5ff", borderRadius: 16, marginBottom: 16 }}>
          <ImageGallery images={images} icon={cat?.icon} onImageTap={images.length ? (i => setLightboxIndex(i)) : undefined} />
        </div>
        {lightboxIndex !== null && <ImageLightbox images={images} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />}
        <h2 style={{ margin: "0 0 6px", color: COLORS.text, fontSize: 22 }}>{listing.title}</h2>
        {listing.category === "jobs" && listing.job_type && <div style={{ marginBottom: 8 }}><Pill color="#1e90ff" bg="#e6f4ff">💼 {listing.job_type}</Pill></div>}
        {listing.category === "services" && listing.service_type && <div style={{ marginBottom: 8 }}><Pill color="#5352ed" bg="#eeeeff">{SERVICE_TYPE_LABELS[listing.service_type]}</Pill></div>}
        {listing.category === "food" && (listing.meal_type || listing.delivery_option) && (
          <div style={{ marginBottom: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {listing.meal_type && <Pill color="#ff9f43" bg="#fff5e6">{MEAL_TYPE_LABELS[listing.meal_type]}</Pill>}
            {listing.delivery_option && <Pill color="#ff9f43" bg="#fff5e6">{DELIVERY_LABELS[listing.delivery_option]}</Pill>}
          </div>
        )}
        {listing.condition && <div style={{ marginBottom: 8 }}><Pill color={COLORS.success} bg="#f0fdf4">{CONDITION_LABELS[listing.condition]}</Pill></div>}
        {listing.category === "fashion" && listing.brand && <div style={{ marginBottom: 8 }}><Pill color="#ff6b9d" bg="#fff0f5">🏷️ {listing.brand}</Pill></div>}
        {listing.category === "housing" && (listing.rooms || listing.deposit_required) && (
          <div style={{ marginBottom: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {listing.rooms && <Pill color="#2ed573" bg="#e8fff2">🛏️ {listing.rooms} room{Number(listing.rooms) !== 1 ? "s" : ""}</Pill>}
            {listing.deposit_required && <Pill color={listing.deposit_required === "yes" ? COLORS.danger : COLORS.success} bg={listing.deposit_required === "yes" ? "#fff0f0" : "#f0fdf4"}>{listing.deposit_required === "yes" ? "💰 Deposit required" : "✅ No deposit"}</Pill>}
          </div>
        )}
        <div style={{ fontWeight: 900, fontSize: 28, color: COLORS.primary, marginBottom: 6 }}>
          {listing.category === "lostfound"
            ? (listing.lf_status === "found" ? <span style={{ color: COLORS.success }}>🎉 FOUND</span> : <span style={{ color: COLORS.danger }}>😢 LOST</span>)
            : listing.category === "jobs"
            ? <>{formatPrice(listing.price)} <span style={{ fontSize: 14, color: COLORS.muted, fontWeight: 600 }}>{listing.pay_rate}</span></>
            : listing.category === "services"
            ? <>{formatPrice(listing.price)} <span style={{ fontSize: 14, color: COLORS.muted, fontWeight: 600 }}>{listing.service_rate}</span></>
            : listing.category === "housing" && listing.rent_period
            ? <>{formatPrice(listing.price)} <span style={{ fontSize: 14, color: COLORS.muted, fontWeight: 600 }}>/{listing.rent_period}</span></>
            : formatPrice(listing.price)}
        </div>
        {listing.price > 0 && listing.category !== "jobs" && listing.category !== "services" && <div style={{ background: "#fffbeb", borderRadius: 10, padding: "6px 12px", fontSize: 12, color: "#92400e", marginBottom: 12, display: "inline-block", fontWeight: 700 }}>
          💡 Platform fee on sale: {formatKsh(commission(listing.price))} ({OWNER.commissionRate}%)
        </div>}
        <p style={{ color: COLORS.muted, fontSize: 14, lineHeight: 1.7, marginBottom: 12 }}>{listing.description}</p>
        {listing.category === "jobs" && (listing.requirements || listing.deadline) && (
          <div style={{ background: "#f8fafc", borderRadius: 14, padding: 14, marginBottom: 14 }}>
            {listing.requirements && (
              <div style={{ marginBottom: listing.deadline ? 10 : 0 }}>
                <div style={{ fontWeight: 800, fontSize: 12, color: COLORS.muted, marginBottom: 4 }}>📋 REQUIREMENTS</div>
                <div style={{ fontSize: 13, color: COLORS.text }}>{listing.requirements}</div>
              </div>
            )}
            {listing.deadline && (
              <div>
                <div style={{ fontWeight: 800, fontSize: 12, color: COLORS.muted, marginBottom: 4 }}>⏰ APPLY BY</div>
                <div style={{ fontSize: 13, color: COLORS.text, fontWeight: 700 }}>{new Date(listing.deadline).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
              </div>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 16, fontSize: 13, color: COLORS.muted, flexWrap: "wrap", marginBottom: 8 }}>
          <span>📍 {listing.location}</span>
          <span>🕐 {timeAgo(listing.created_at)}</span>
          <span>👁 {listing.views || 0} views</span>
        </div>
        <button onClick={() => onLike(listing.id)} style={{ background: isLiked ? "#fff0f0" : "#f8fafc", border: `1.5px solid ${isLiked ? COLORS.danger : COLORS.border}`, borderRadius: 20, padding: "6px 16px", fontSize: 14, cursor: "pointer", marginBottom: 14, fontWeight: 700, color: isLiked ? COLORS.danger : COLORS.muted }}>
          {isLiked ? "❤️ Liked" : "🤍 Like"} · {listing.likes || 0}
        </button>
        {!listing.sold && (
          <div style={{ background: "#f8fafc", borderRadius: 16, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              {listing.seller_account_type === "business" && listing.seller_avatar_url
                ? <img src={listing.seller_avatar_url} alt="" style={{ width: 42, height: 42, borderRadius: 12, objectFit: "cover" }} />
                : <div style={{ width: 42, height: 42, borderRadius: 12, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{listing.seller_account_type === "business" ? "🏪" : "👤"}</div>}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: COLORS.text, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {listing.seller_account_type === "business" && listing.seller_business_name ? listing.seller_business_name : listing.seller_name}
                  {listing.seller_account_type === "business" && <span style={{ background: "#fff4e6", color: "#b45309", borderRadius: 20, padding: "2px 8px", fontSize: 10, fontWeight: 800 }}>🏪 Business</span>}
                  {listing.seller_verified && <span style={{ background: "#fffbe8", color: "#92750f", borderRadius: 20, padding: "2px 8px", fontSize: 10, fontWeight: 800 }}>🥇 Verified Student</span>}
                </div>
                {listing.seller_account_type === "business" && listing.seller_business_location && (
                  <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>📍 {listing.seller_business_location}</div>
                )}
              </div>
            </div>
            {!isOwner && (
              <button onClick={() => onOpenChat(listing)} style={{ width: "100%", background: "#fff", border: `2px solid ${COLORS.primary}`, color: COLORS.primary, borderRadius: 12, padding: "11px 0", fontWeight: 800, fontSize: 14, cursor: "pointer", marginBottom: 8 }}>💬 Message Seller (in-app)</button>
            )}
            {!revealed
              ? <>
                  <button onClick={() => { if (requireLogin && !requireLogin()) return; setRevealed(true); }} style={{ width: "100%", background: `linear-gradient(135deg, ${COLORS.grad1}, ${COLORS.grad2})`, color: "#fff", border: "none", borderRadius: 12, padding: "12px 0", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>💬 Contact Seller</button>
                  {listing.whatsapp && <div style={{ textAlign: "center", fontSize: 11, color: COLORS.muted, marginTop: 6 }}>Number: {listing.whatsapp.slice(0, 5)}•••{listing.whatsapp.slice(-2)}</div>}
                </>
              : <a href={`https://wa.me/${listing.whatsapp}`} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#25d366", color: "#fff", padding: "12px 0", borderRadius: 12, fontWeight: 800, fontSize: 15, textDecoration: "none" }}>💬 Chat on WhatsApp</a>
            }
          </div>
        )}
        {isOwner && !listing.sold && listing.category !== "lostfound" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { onBoost(listing); onClose(); }} style={{ flex: 1, background: "#f5f0ff", color: COLORS.primary, border: "none", borderRadius: 12, padding: "11px 0", fontWeight: 800, cursor: "pointer" }}>🚀 Boost</button>
            <button onClick={() => { onMarkSold(listing); onClose(); }} style={{ flex: 1, background: "#f0fdf4", color: COLORS.success, border: "none", borderRadius: 12, padding: "11px 0", fontWeight: 800, cursor: "pointer" }}>✅ Mark Sold</button>
          </div>
        )}
        {isOwner && !listing.sold && listing.category === "lostfound" && (
          <button onClick={() => { onMarkResolved(listing.id); onClose(); }} style={{ width: "100%", background: "#f0fdf4", color: COLORS.success, border: "none", borderRadius: 12, padding: "11px 0", fontWeight: 800, cursor: "pointer" }}>
            ✅ Mark as {listing.lf_status === "found" ? "Returned to Owner" : "Recovered"}
          </button>
        )}
        <button onClick={() => {
          const url = `${window.location.origin}${window.location.pathname}?listing=${listing.id}`;
          const text = `Check out "${listing.title}"${listing.price ? ` — ${formatPrice(listing.price)}` : ""} on CampusMarket: ${url}`;
          if (navigator.share) { navigator.share({ title: listing.title, text, url }).catch(() => {}); }
          else { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank"); }
        }} style={{ width: "100%", background: "#f8fafc", color: COLORS.text, border: `1.5px solid ${COLORS.border}`, borderRadius: 12, padding: "11px 0", fontWeight: 800, fontSize: 13, cursor: "pointer", marginTop: 10 }}>
          📤 Share this listing
        </button>
        {!isOwner && (
          <button onClick={() => onReport(listing)} style={{ display: "block", margin: "14px auto 0", background: "none", border: "none", color: COLORS.muted, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
            🚩 Report this listing
          </button>
        )}
      </div>
    </div>
  );
}

// ── Boost Modal ───────────────────────────────────────────────────
function BoostModal({ listing, onClose, onBoost, currentUser }) {
  const [plan, setPlan] = useState(null); const [pay, setPay] = useState(false);
  if (pay && plan) return <MpesaModal amount={plan.price} reason={`Boost: "${listing.title}"`} listingId={listing.id} userId={currentUser?.id} type="boost" onClose={onClose} onConfirm={ref => { onBoost(listing.id, plan, ref); onClose(); }} />;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 24, maxWidth: 420, width: "100%", padding: 28 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 4 }}>🚀 Boost Your Listing</div>
        <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 20 }}>"{listing.title}"</div>
        {OWNER.adPlans.map(p => (
          <div key={p.id} onClick={() => setPlan(p)} style={{ border: `2px solid ${plan?.id === p.id ? COLORS.primary : COLORS.border}`, borderRadius: 16, padding: 16, marginBottom: 10, cursor: "pointer", background: plan?.id === p.id ? "#f5f0ff" : "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{p.label}</div>
              <div style={{ fontWeight: 900, fontSize: 18, color: COLORS.primary }}>{formatKsh(p.price)}</div>
            </div>
            <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 4 }}>{p.description} · {p.days} days</div>
          </div>
        ))}
        <button onClick={() => plan && setPay(true)} style={{ width: "100%", background: plan ? `linear-gradient(135deg, ${COLORS.grad1}, ${COLORS.grad2})` : "#e8e8f0", color: plan ? "#fff" : COLORS.muted, border: "none", borderRadius: 14, padding: "14px 0", fontWeight: 900, fontSize: 15, cursor: plan ? "pointer" : "default", marginTop: 8 }}>
          {plan ? `Pay ${formatKsh(plan.price)} via M-Pesa →` : "Select a plan"}
        </button>
      </div>
    </div>
  );
}

// ── Sale Modal ────────────────────────────────────────────────────
function SaleModal({ listing, onClose, onMarkSold, currentUser }) {
  const [pay, setPay] = useState(false); const fee = commission(listing.price);
  if (pay) return <MpesaModal amount={fee} reason={`Commission — "${listing.title}"`} listingId={listing.id} userId={currentUser?.id} type="sale" onClose={onClose} onConfirm={ref => { onMarkSold(listing.id, ref); onClose(); }} />;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 24, maxWidth: 400, width: "100%", padding: 28 }} onClick={e => e.stopPropagation()}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 52 }}>🎊</div>
          <div style={{ fontWeight: 900, fontSize: 22, color: COLORS.success }}>Congrats on the sale!</div>
        </div>
        <div style={{ background: "#f0fdf4", borderRadius: 16, padding: 16, marginBottom: 20 }}>
          {[["Sale Price", formatPrice(listing.price), COLORS.text], [`Platform Fee (${OWNER.commissionRate}%)`, `− ${formatKsh(fee)}`, COLORS.danger], ["You Receive 🎉", formatKsh(listing.price - fee), COLORS.success]].map(([l, v, c], i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < 2 ? `1px solid #d1fae5` : "none" }}>
              <span style={{ fontSize: 14, color: COLORS.muted }}>{l}</span>
              <span style={{ fontWeight: i === 2 ? 900 : 700, fontSize: i === 2 ? 18 : 14, color: c }}>{v}</span>
            </div>
          ))}
        </div>
        <button onClick={() => setPay(true)} style={{ width: "100%", background: COLORS.mpesa, color: "#fff", border: "none", borderRadius: 14, padding: "14px 0", fontWeight: 900, fontSize: 15, cursor: "pointer" }}>
          📱 Pay {formatKsh(fee)} via M-Pesa
        </button>
      </div>
    </div>
  );
}

// ── Report Listing Modal ──────────────────────────────────────────
const REPORT_REASONS = ["Scam / seller won't deliver", "Fake or misleading listing", "Already sold elsewhere", "Inappropriate content", "Other"];

function ReportModal({ listing, currentUser, onClose, onSubmit }) {
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    const ok = await onSubmit({ listing_id: listing.id, reporter_id: currentUser?.id || null, reason, details, status: "pending", auto: false });
    setSubmitting(false);
    if (ok === false) return; // error toast already shown by onSubmit; let the person retry
    setSent(true);
    setTimeout(onClose, 1500);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 24, maxWidth: 420, width: "100%", padding: 28 }} onClick={e => e.stopPropagation()}>
        {sent ? (
          <div style={{ textAlign: "center", padding: 10 }}>
            <div style={{ fontSize: 48 }}>🚩</div>
            <div style={{ fontWeight: 900, fontSize: 18, marginTop: 10 }}>Report submitted</div>
            <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 6 }}>Thanks — our team will review this listing.</div>
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 4 }}>🚩 Report Listing</div>
            <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 18 }}>"{listing.title}"</div>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 8 }}>What's wrong?</label>
            {REPORT_REASONS.map(r => (
              <div key={r} onClick={() => setReason(r)} style={{ border: `2px solid ${reason === r ? COLORS.danger : COLORS.border}`, background: reason === r ? "#fff0f0" : "#fff", borderRadius: 12, padding: "10px 14px", marginBottom: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, color: reason === r ? COLORS.danger : COLORS.text }}>
                {r}
              </div>
            ))}
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, margin: "10px 0 8px" }}>Details (optional)</label>
            <textarea value={details} onChange={e => setDetails(e.target.value)} rows={3} placeholder="Anything else we should know?"
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", outline: "none", marginBottom: 16 }} />
            <button onClick={submit} disabled={submitting}
              style={{ width: "100%", background: COLORS.danger, color: "#fff", border: "none", borderRadius: 14, padding: "13px 0", fontWeight: 900, fontSize: 15, cursor: submitting ? "default" : "pointer" }}>
              {submitting ? "Sending…" : "🚩 Submit Report"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Chat Modal (in-app messaging) ─────────────────────────────────
function ChatModal({ listing, currentUser, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const isMatchChat = !listing.id;
  const otherId = currentUser?.id === listing.seller_id ? listing.other_user_id : listing.seller_id;
  const bottomRef = useRef(null);

  useEffect(() => {
    let channel;
    const load = async () => {
      let query = supabase.from("messages").select("*")
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${currentUser.id})`)
        .order("created_at", { ascending: true });
      query = isMatchChat ? query.is("listing_id", null) : query.eq("listing_id", listing.id);
      const { data } = await query;
      if (data) setMessages(data);
      setLoading(false);
      let markRead = supabase.from("messages").update({ read: true }).eq("receiver_id", currentUser.id).eq("sender_id", otherId);
      markRead = isMatchChat ? markRead.is("listing_id", null) : markRead.eq("listing_id", listing.id);
      await markRead;
    };
    load();
    channel = supabase.channel(`chat-${listing.id || "match"}-${otherId}-${currentUser.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: isMatchChat ? `listing_id=is.null` : `listing_id=eq.${listing.id}` }, payload => {
        const m = payload.new;
        const belongs = (m.sender_id === currentUser.id && m.receiver_id === otherId) || (m.sender_id === otherId && m.receiver_id === currentUser.id);
        if (belongs) setMessages(p => (p.some(msg => msg.id === m.id) ? p : [...p, m]));
      })
      .subscribe();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [listing.id, otherId, currentUser.id, isMatchChat]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    if (!text.trim()) return;
    const body = text.trim();
    setText("");
    const { data, error } = await supabase.from("messages")
      .insert({ listing_id: listing.id || null, sender_id: currentUser.id, receiver_id: otherId, content: body, read: false })
      .select().single();
    if (error) {
      console.error("send message error:", error);
      setText(body); // restore what they typed so they don't lose it
      return;
    }
    // Show it immediately — don't wait on the realtime round-trip.
    setMessages(p => (p.some(msg => msg.id === data.id) ? p : [...p, data]));
    await supabase.from("notifications").insert({ user_id: otherId, message: isMatchChat ? `💬 New message from ${currentUser.name || "someone"}` : `💬 New message about "${listing.title}"`, read: false });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 2500, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: "24px 24px 0 0", maxWidth: 500, width: "100%", height: "80vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 15 }}>💬 {isMatchChat ? listing.other_user_name : listing.title}</div>
            <div style={{ fontSize: 11, color: COLORS.muted }}>{isMatchChat ? "Campus Connect" : `with ${listing.other_user_name || "seller"}`}</div>
          </div>
          <button onClick={onClose} style={{ background: "#f0f0f7", border: "none", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {loading ? <div style={{ textAlign: "center", color: COLORS.muted, padding: 20 }}>Loading…</div> :
            messages.length === 0 ? <div style={{ textAlign: "center", color: COLORS.muted, padding: 20 }}>Say hi 👋 — start the conversation.</div> :
            messages.map(m => (
              <div key={m.id} style={{ alignSelf: m.sender_id === currentUser.id ? "flex-end" : "flex-start", maxWidth: "75%" }}>
                <div style={{ background: m.sender_id === currentUser.id ? COLORS.primary : "#f0f0f7", color: m.sender_id === currentUser.id ? "#fff" : COLORS.text, borderRadius: 16, padding: "9px 14px", fontSize: 14 }}>{m.content}</div>
                <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 2, textAlign: m.sender_id === currentUser.id ? "right" : "left" }}>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            ))
          }
          <div ref={bottomRef} />
        </div>
        <div style={{ padding: 12, borderTop: `1px solid ${COLORS.border}`, display: "flex", gap: 8 }}>
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Type a message…"
            style={{ flex: 1, padding: "11px 14px", borderRadius: 20, border: `2px solid ${COLORS.border}`, fontSize: 14, outline: "none", fontFamily: "inherit" }} />
          <button onClick={send} style={{ background: COLORS.primary, color: "#fff", border: "none", borderRadius: "50%", width: 42, height: 42, cursor: "pointer", fontSize: 16 }}>➤</button>
        </div>
      </div>
    </div>
  );
}

// ── Mini Bar Chart (no dependencies, pure SVG) ─────────────────────
function MiniBarChart({ data, height = 140 }) {
  const max = Math.max(1, ...data.map(d => d.value));
  const barW = 100 / data.length;
  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, overflow: "visible" }}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 24);
          return (
            <g key={i}>
              <rect x={i * barW + barW * 0.15} y={height - 20 - h} width={barW * 0.7} height={h} rx="2" fill={d.color || COLORS.primary} />
              <text x={i * barW + barW * 0.5} y={height - 6} fontSize="4.5" textAnchor="middle" fill={COLORS.muted}>{d.label}</text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {data.map((d, i) => <div key={i} style={{ fontSize: 10, fontWeight: 800, color: d.color || COLORS.primary }}>{d.value}</div>)}
      </div>
    </div>
  );
}

// ── Admin MFA Gate (TOTP 2FA required for admin access) ────────────
function AdminMFAGate({ onVerified }) {
  const [stage, setStage] = useState("loading"); // loading | enroll | verify | error
  const [qrCode, setQrCode] = useState(null);
  const [secret, setSecret] = useState(null);
  const [factorId, setFactorId] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) { setStage("error"); setError(error.message); return; }
      const verified = data?.totp?.find(f => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setStage("verify");
        return;
      }
      // Clean up any leftover unverified factors from a previous failed attempt
      // (these block re-enrolling with the same friendly name).
      const stale = data?.totp?.filter(f => f.status !== "verified") || [];
      for (const f of stale) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `admin-2fa-${Date.now()}`,
      });
      if (enrollError) { setStage("error"); setError(enrollError.message); return; }
      setFactorId(enrollData.id);
      setQrCode(enrollData.totp.qr_code);
      setSecret(enrollData.totp.secret);
      setStage("enroll");
    })();
  }, []);

  const doVerify = async () => {
    setBusy(true); setError("");
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) { setError(challengeError.message); setBusy(false); return; }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
    setBusy(false);
    if (verifyError) { setError("Incorrect code — try again."); return; }
    onVerified();
  };

  if (stage === "loading") return <div style={{ textAlign: "center", padding: 40, color: COLORS.muted }}>🔐 Checking admin security…</div>;
  if (stage === "error") return <div style={{ background: "#fff0f0", color: COLORS.danger, borderRadius: 14, padding: 20, fontSize: 13 }}>⚠️ {error}</div>;

  return (
    <div style={{ background: "#fff", borderRadius: 20, padding: 24, textAlign: "center" }}>
      <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>🔐 {stage === "enroll" ? "Set Up Admin 2FA" : "Admin Verification"}</div>
      <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 16 }}>
        {stage === "enroll" ? "Scan with Google Authenticator, Authy, or any TOTP app. Required once for admin accounts." : "Enter the 6-digit code from your authenticator app."}
      </div>
      {stage === "enroll" && qrCode && <img src={qrCode} alt="Scan for 2FA" style={{ margin: "0 auto 14px", maxWidth: 180, width: "100%", display: "block" }} />}
      {stage === "enroll" && secret && <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 16, wordBreak: "break-all" }}>Manual key: {secret}</div>}
      <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="6-digit code" maxLength={6}
        style={{ width: "100%", padding: 12, borderRadius: 12, border: `2px solid ${COLORS.border}`, textAlign: "center", fontSize: 18, letterSpacing: 4, boxSizing: "border-box", marginBottom: 12, outline: "none" }} />
      {error && <div style={{ color: COLORS.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <button onClick={doVerify} disabled={busy || code.length < 6}
        style={{ width: "100%", background: code.length >= 6 ? COLORS.primary : "#f0f0f7", color: code.length >= 6 ? "#fff" : COLORS.muted, border: "none", borderRadius: 12, padding: "12px 0", fontWeight: 800, cursor: code.length >= 6 ? "pointer" : "default" }}>
        {busy ? "Verifying…" : stage === "enroll" ? "Enable 2FA" : "Verify"}
      </button>
    </div>
  );
}

// ── Campus Connect (matching: roommates / study buddies / friends) ─
const MATCH_TYPES = [
  { id: "roommate", label: "Roommate", icon: "🏠", color: "#2ed573", bg: "#e8fff2" },
  { id: "study", label: "Study Buddy", icon: "📚", color: "#6c47ff", bg: "#f0ebff" },
  { id: "friend", label: "Just Friends", icon: "👋", color: "#ff6b9d", bg: "#fff0f5" },
];

function MatchProfileForm({ onClose, onSubmit, initial }) {
  const [types, setTypes] = useState(initial?.types || []);
  const [bio, setBio] = useState(initial?.bio || "");
  const [course, setCourse] = useState(initial?.course || "");
  const [interests, setInterests] = useState(initial?.interests || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(initial?.avatar_url || null);
  const [saving, setSaving] = useState(false);
  const toggleType = (t) => setTypes(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 2200, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: "24px 24px 0 0", maxWidth: 500, width: "100%", maxHeight: "90vh", overflowY: "auto", padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 4, background: "#e8e8f0", borderRadius: 4, margin: "0 auto 20px" }} />
        <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 4 }}>🤝 Campus Connect</div>
        <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 18 }}>Let others find you for roommates, study groups, or just to connect.</div>

        <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 8 }}>Photo (optional)</label>
        <label style={{ display: "flex", alignItems: "center", gap: 12, border: `2px dashed ${COLORS.border}`, borderRadius: 14, padding: 12, cursor: "pointer", marginBottom: 16 }}>
          {photoPreview ? <img src={photoPreview} alt="" style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover" }} /> : <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#f5f0ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🙂</div>}
          <span style={{ fontSize: 13, color: COLORS.muted, fontWeight: 700 }}>{photoPreview ? "Change photo" : "Add a photo"}</span>
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
            const file = e.target.files[0];
            if (file) { setPhotoFile(file); setPhotoPreview(URL.createObjectURL(file)); }
          }} />
        </label>

        <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 8 }}>What are you looking for? (pick any)</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {MATCH_TYPES.map(t => (
            <div key={t.id} onClick={() => toggleType(t.id)} style={{ border: `2px solid ${types.includes(t.id) ? t.color : COLORS.border}`, background: types.includes(t.id) ? t.bg : "#fff", color: types.includes(t.id) ? t.color : COLORS.text, borderRadius: 30, padding: "8px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
              {t.icon} {t.label}
            </div>
          ))}
        </div>

        <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>About you</label>
        <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} placeholder="e.g. Second-year CS student, quiet, into gaming and coffee..."
          style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", outline: "none", marginBottom: 14 }} />

        <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Course (optional)</label>
        <input value={course} onChange={e => setCourse(e.target.value)} placeholder="e.g. BSc Computer Science"
          style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", outline: "none", marginBottom: 14 }} />

        <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Interests (optional)</label>
        <input value={interests} onChange={e => setInterests(e.target.value)} placeholder="e.g. football, music, hiking"
          style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", outline: "none", marginBottom: 20 }} />

        <button onClick={async () => {
          setSaving(true);
          let avatarUrl = initial?.avatar_url || null;
          if (photoFile) avatarUrl = await uploadImage(photoFile);
          await onSubmit({ types, bio, course, interests, avatar_url: avatarUrl });
          setSaving(false);
        }} disabled={saving || types.length === 0}
          style={{ width: "100%", background: types.length ? `linear-gradient(135deg, ${COLORS.grad1}, ${COLORS.grad2})` : "#f0f0f7", color: types.length ? "#fff" : COLORS.muted, border: "none", borderRadius: 14, padding: "13px 0", fontWeight: 900, fontSize: 15, cursor: types.length ? "pointer" : "default" }}>
          {saving ? "Saving…" : initial ? "Update My Profile" : "🤝 Post My Profile"}
        </button>
        {initial && <button onClick={onClose} style={{ width: "100%", background: "none", border: "none", color: COLORS.muted, fontSize: 13, marginTop: 10, cursor: "pointer" }}>Cancel</button>}
      </div>
    </div>
  );
}

function MatchCard({ profile, onConnect }) {
  return (
    <div style={{ background: "#fff", borderRadius: 18, padding: 16, marginBottom: 12, boxShadow: "0 2px 10px #0001" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt="" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
            : <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#f5f0ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🙂</div>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {profile.name}
              {profile.account_type === "business" && <Pill color="#b45309" bg="#fff4e6">🏪</Pill>}
              {profile.verified && <Pill color="#92750f" bg="#fffbe8">🥇</Pill>}
            </div>
            {profile.course && <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>🎓 {profile.course}</div>}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
        {(profile.types || []).map(t => {
          const mt = MATCH_TYPES.find(x => x.id === t);
          return mt ? <Pill key={t} color={mt.color} bg={mt.bg}>{mt.icon} {mt.label}</Pill> : null;
        })}
      </div>
      {profile.bio && <div style={{ fontSize: 13, color: COLORS.text, marginBottom: 8 }}>{profile.bio}</div>}
      {profile.interests && <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 12 }}>✨ {profile.interests}</div>}
      <button onClick={() => onConnect(profile)} style={{ width: "100%", background: "#f5f0ff", color: COLORS.primary, border: "none", borderRadius: 12, padding: "10px 0", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>💬 Connect</button>
    </div>
  );
}

// ── Delete Account ──────────────────────────────────────────────
function DeleteAccountModal({ onClose, onConfirm }) {
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const canDelete = confirmText.trim().toUpperCase() === "DELETE";

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 4100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 24, maxWidth: 400, width: "100%", padding: 26 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 44, textAlign: "center" }}>⚠️</div>
        <div style={{ fontWeight: 900, fontSize: 19, textAlign: "center", marginTop: 8 }}>Delete Your Account</div>
        <div style={{ color: COLORS.muted, fontSize: 13, textAlign: "center", marginTop: 10, lineHeight: 1.6 }}>
          This is <b>permanent</b>. Your listings, chats, Campus Connect profile, watchlist, and account will all be removed. This cannot be undone.
        </div>
        <label style={{ display: "block", fontWeight: 700, fontSize: 12, color: COLORS.muted, margin: "18px 0 8px" }}>Type DELETE to confirm</label>
        <input value={confirmText} onChange={e => { setConfirmText(e.target.value); setError(""); }} placeholder="DELETE"
          style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 15, boxSizing: "border-box", outline: "none", textAlign: "center", fontWeight: 800, letterSpacing: 2, marginBottom: error ? 8 : 16 }} />
        {error && <div style={{ background: "#fff0f0", color: COLORS.danger, borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 700, marginBottom: 12 }}>{error}</div>}
        <button onClick={async () => {
          if (!canDelete) return;
          setDeleting(true); setError("");
          const ok = await onConfirm();
          setDeleting(false);
          if (!ok) setError("Something went wrong. Please try again, or contact support if this keeps happening.");
        }} disabled={!canDelete || deleting}
          style={{ width: "100%", background: canDelete ? COLORS.danger : "#f0f0f7", color: canDelete ? "#fff" : COLORS.muted, border: "none", borderRadius: 14, padding: "13px 0", fontWeight: 900, fontSize: 15, cursor: canDelete ? "pointer" : "default" }}>
          {deleting ? "Deleting…" : "🗑️ Permanently Delete My Account"}
        </button>
        <button onClick={onClose} style={{ width: "100%", background: "none", border: "none", color: COLORS.muted, fontSize: 13, marginTop: 10, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

// ── Terms & Privacy ──────────────────────────────────────────────
function TermsModal({ onClose }) {
  const [tab, setTab] = useState("terms");
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 4000, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: "24px 24px 0 0", maxWidth: 560, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "20px 24px 0" }}>
          <div style={{ width: 40, height: 4, background: "#e8e8f0", borderRadius: 4, margin: "0 auto 16px" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontWeight: 900, fontSize: 19 }}>📜 Terms & Privacy</div>
            <button onClick={onClose} style={{ background: "#f0f0f7", border: "none", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
            <button onClick={() => setTab("terms")} style={{ flex: 1, padding: "9px 0", borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 13, background: tab === "terms" ? COLORS.primary : "#f0f0f7", color: tab === "terms" ? "#fff" : COLORS.muted }}>Terms of Service</button>
            <button onClick={() => setTab("privacy")} style={{ flex: 1, padding: "9px 0", borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 13, background: tab === "privacy" ? COLORS.primary : "#f0f0f7", color: tab === "privacy" ? "#fff" : COLORS.muted }}>Privacy Policy</button>
          </div>
        </div>
        <div style={{ padding: "16px 24px 28px", overflowY: "auto", fontSize: 13, lineHeight: 1.7, color: COLORS.text }}>
          {tab === "terms" ? (
            <>
              <p style={{ color: COLORS.muted, fontSize: 12 }}>Last updated: {new Date().toLocaleDateString()}</p>
              <h4>1. What CampusMarket Is</h4>
              <p>CampusMarket is a student marketplace connecting buyers and sellers, job postings, campus events, Lost & Found, and a "Campus Connect" feature for finding roommates, study partners, and friends. We provide the platform; we are not a party to any sale, rental, job, or agreement made between users.</p>
              <h4>2. Who Can Use It</h4>
              <p>You must create an honest account with accurate information. Guest browsing is allowed without an account; buying, selling, chatting, or posting requires a registered account. You're responsible for keeping your login secure.</p>
              <h4>3. Listings & Conduct</h4>
              <p>You agree not to post anything illegal, fraudulent, counterfeit, stolen, dangerous, or that violates university rules. You're solely responsible for the accuracy of your listings and for fulfilling any sale, service, or job you post. We may remove any listing or account that violates these terms, with or without notice.</p>
              <h4>4. Fees & Payments</h4>
              <p>Selling may involve a platform commission on completed sales, and optional paid "boosts" to feature a listing, as shown in the app at the time of the transaction. Payments are made via M-Pesa. We use automated checks to detect fraudulent or duplicate payment codes, but we don't guarantee any transaction between users — always meet safely and verify items before paying.</p>
              <h4>5. Verified Badges</h4>
              <p>"Verified Student" and "Business" badges reflect that an admin reviewed submitted documents at a point in time. They are not a guarantee of a user's ongoing trustworthiness or conduct.</p>
              <h4>6. Safety</h4>
              <p>We are not responsible for interactions, meetups, or transactions between users. Meet in safe public places, verify items in person, and report suspicious activity using the in-app Report feature. Never send money for something you haven't seen or verified.</p>
              <h4>7. Account Suspension</h4>
              <p>We may suspend or ban accounts that violate these terms, receive credible fraud reports, or pose a risk to other users, at our discretion.</p>
              <h4>8. Limitation of Liability</h4>
              <p>CampusMarket is provided "as is." We are not liable for losses arising from transactions, meetups, listing accuracy, or user conduct. Use the platform at your own judgment and discretion.</p>
              <h4>9. Changes</h4>
              <p>We may update these terms as the platform grows. Continued use after changes means you accept the updated terms.</p>
              <h4>10. Contact</h4>
              <p>Questions about these terms? Reach out via the contact details shown in the app.</p>
            </>
          ) : (
            <>
              <p style={{ color: COLORS.muted, fontSize: 12 }}>Last updated: {new Date().toLocaleDateString()}</p>
              <h4>1. Information We Collect</h4>
              <p>• Account info: name, email, WhatsApp number, account type (Student/Business/Customer)<br/>
              • Content you post: listings, photos, chat messages, Campus Connect profiles<br/>
              • Verification documents: a photo of your school ID, only if you opt into Verified Student status<br/>
              • Payment records: M-Pesa transaction codes and amounts, to detect fraud and confirm payments — we do not collect your M-Pesa PIN or full financial account details<br/>
              • Usage info: listings viewed, online status, device/browser basics</p>
              <h4>2. How We Use It</h4>
              <p>To run the marketplace (matching buyers/sellers, showing listings, enabling chat), to verify payments and reduce fraud, to review Verified Student applications, to send you notifications about your activity, and to keep the platform safe (reviewing reports, banning abusive accounts).</p>
              <h4>3. Who Can See What</h4>
              <p>Your name, listings, and Campus Connect profile (if posted) are visible to other users. Your ID verification photo is visible only to admins reviewing your request. Chat messages are visible only to you and the other participant. Your email is never shown publicly.</p>
              <h4>4. Data Storage</h4>
              <p>Data is stored securely with our backend provider (Supabase). We apply access rules so users can only read and modify data they're authorized to see.</p>
              <h4>5. Third Parties</h4>
              <p>We use Safaricom M-Pesa to process and confirm payments, and may use AI services to power optional features like smart search. We do not sell your personal data to advertisers or third parties.</p>
              <h4>6. Your Choices</h4>
              <p>You can edit or delete your own listings and Campus Connect profile at any time. To request account deletion or a copy of your data, contact us via the details in the app.</p>
              <h4>7. Data Retention</h4>
              <p>We retain account and transaction data as long as your account is active, and as needed to resolve disputes or fraud reports.</p>
              <h4>8. Changes</h4>
              <p>We may update this policy as the platform evolves. We'll note the "last updated" date above when we do.</p>
              <h4>9. Contact</h4>
              <p>Questions about your data? Reach out via the contact details shown in the app.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [listings, setListings] = useState([]);
  const [likedIds, setLikedIds] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [activeUsers, setActiveUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [selectedListing, setSelectedListing] = useState(null);
  const [showPostForm, setShowPostForm] = useState(false);
  const [editingListing, setEditingListing] = useState(null);
  const [boostTarget, setBoostTarget] = useState(null);
  const [saleTarget, setSaleTarget] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showActiveUsers, setShowActiveUsers] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [toast, setToast] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showTermsFooter, setShowTermsFooter] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [fraudReports, setFraudReports] = useState([]);
  const [watchlistIds, setWatchlistIds] = useState([]);
  const [chatTarget, setChatTarget] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [smartSearchOn, setSmartSearchOn] = useState(false);
  const [smartSearching, setSmartSearching] = useState(false);
  const [smartResultIds, setSmartResultIds] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [userSearch, setUserSearch] = useState("");
  const [revenueStats, setRevenueStats] = useState({ total: 0, boost: 0, sale: 0, count: 0, byDay: [] });
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [pendingVerifications, setPendingVerifications] = useState([]);
  const [matchProfiles, setMatchProfiles] = useState([]);
  const [myMatchProfile, setMyMatchProfile] = useState(null);
  const [showMatchForm, setShowMatchForm] = useState(false);
  const [matchFilter, setMatchFilter] = useState("all");
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [adminSection, setAdminSection] = useState("dashboard");
  const [mfaVerified, setMfaVerified] = useState(false);
  const intervalRef = useRef(null);
  const deepLinkHandled = useRef(false);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    if (currentUser?.role !== "admin") return;
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (data?.currentLevel === "aal2") setMfaVerified(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.role]);

  useEffect(() => {
    if (currentUser?.role !== "admin" || activeTab !== "admin") return;
    if (adminSection === "reports") fetchFraudReports();
    if (adminSection === "users") fetchAllUsers();
    if (adminSection === "earnings") fetchRevenue();
    if (adminSection === "verify") fetchPendingVerifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, adminSection, currentUser?.role]);

  useEffect(() => {
    if (!currentUser?.id || activeTab !== "match") return;
    fetchMatchProfiles(currentUser.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id || activeTab !== "chats") return;
    fetchConversations(currentUser.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentUser?.id]);

  useEffect(() => {
    if (deepLinkHandled.current || listings.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get("listing");
    if (sharedId) {
      const shared = listings.find(l => l.id === sharedId);
      if (shared) { setSelectedListing(shared); deepLinkHandled.current = true; }
    }
  }, [listings]);

  useEffect(() => {
    fetchListings();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        supabase.from("profiles").select("*").eq("id", session.user.id).single().then(({ data }) => {
          setCurrentUser({ ...session.user, ...data });
          fetchLikes(session.user.id);
          fetchNotifications(session.user.id);
          fetchWatchlist(session.user.id);
          fetchConversations(session.user.id);
          updateOnlineStatus(session.user.id);
          if (typeof Notification !== "undefined" && Notification.permission === "default") {
            Notification.requestPermission();
          }
        });
      }
      setLoading(false);
    });
    fetchActiveUsers();
    intervalRef.current = setInterval(() => {
      fetchActiveUsers();
    }, 30000);
    return () => clearInterval(intervalRef.current);
  }, []);

  // Real-time in-app alerts: fires the instant a new notification row is inserted for this user
  useEffect(() => {
    if (!currentUser?.id) return;
    const channel = supabase.channel(`notifs-${currentUser.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${currentUser.id}` }, payload => {
        const n = payload.new;
        setNotifications(p => [n, ...p]);
        showToast(n.message);
        if (n.message?.includes("New message")) fetchConversations(currentUser.id);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("CampusMarket", { body: n.message });
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser?.id]);

  const updateOnlineStatus = async (userId) => {
    await supabase.from("profiles").update({ last_seen: new Date().toISOString(), is_online: true }).eq("id", userId);
    setInterval(async () => {
      await supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", userId);
    }, 60000);
  };

  const fetchActiveUsers = async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true }).gte("last_seen", fiveMinAgo);
    if (count !== null) setActiveUsers(count);
  };

  const inviteFriends = () => {
    const link = `${window.location.origin}${window.location.pathname}?ref=${currentUser.id}`;
    const text = `Join me on CampusMarket — buy, sell, and connect with other students! ${link}`;
    if (navigator.share) { navigator.share({ title: "CampusMarket", text, url: link }).catch(() => {}); }
    else { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank"); }
  };

  const fetchListings = async () => {
    const { data } = await supabase.from("listings").select("*").order("created_at", { ascending: false });
    if (!data) return;
    // Boosts auto-expire after 7 days: any listing still marked sponsored
    // past its boosted_until date gets quietly un-featured.
    const now = new Date();
    const expiredIds = data.filter(l => l.sponsored && l.boosted_until && new Date(l.boosted_until) < now).map(l => l.id);
    if (expiredIds.length) {
      await supabase.from("listings").update({ sponsored: false }).in("id", expiredIds);
      data.forEach(l => { if (expiredIds.includes(l.id)) l.sponsored = false; });
    }
    setListings(data);
  };

  // AI Smart Search: calls a Supabase Edge Function (see supabase/functions/smart-search)
  // which holds the Anthropic API key server-side. Falls back to normal keyword
  // search automatically if the function isn't deployed or errors out.
  const runSmartSearch = async (query) => {
    if (!query.trim()) { setSmartResultIds(null); return; }
    setSmartSearching(true);
    try {
      const pool = listings.slice(0, 60).map(l => ({ id: l.id, title: l.title, description: l.description, category: l.category, price: l.price }));
      const { data, error } = await supabase.functions.invoke("smart-search", { body: { query, listings: pool } });
      if (error || !data?.ids) throw error || new Error("no ids returned");
      setSmartResultIds(data.ids);
    } catch (e) {
      showToast("✨ Smart search unavailable — showing keyword results instead");
      setSmartResultIds(null);
    }
    setSmartSearching(false);
  };

  const fetchLikes = async (userId) => {
    const { data } = await supabase.from("listing_likes").select("listing_id").eq("user_id", userId);
    if (data) setLikedIds(data.map(l => l.listing_id));
  };

  const fetchNotifications = async (userId) => {
    const { data } = await supabase.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
    if (data) setNotifications(data);
  };

  const fetchWatchlist = async (userId) => {
    const { data } = await supabase.from("watchlist").select("listing_id").eq("user_id", userId);
    if (data) setWatchlistIds(data.map(w => w.listing_id));
  };

  const toggleWatchlist = async (listingId) => {
    if (!currentUser) return;
    const isWatched = watchlistIds.includes(listingId);
    if (isWatched) {
      await supabase.from("watchlist").delete().eq("listing_id", listingId).eq("user_id", currentUser.id);
      setWatchlistIds(p => p.filter(id => id !== listingId));
    } else {
      await supabase.from("watchlist").insert({ listing_id: listingId, user_id: currentUser.id });
      setWatchlistIds(p => [...p, listingId]);
      showToast("🔖 Saved to your watchlist");
    }
  };

  const fetchConversations = async (userId) => {
    const { data, error } = await supabase.from("messages").select("*")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`).order("created_at", { ascending: false });
    if (error) { console.error("fetchConversations error:", error); return; }
    if (!data) return;
    const seen = new Map();
    for (const m of data) {
      const otherId = m.sender_id === userId ? m.receiver_id : m.sender_id;
      const key = `${m.listing_id || "match"}-${otherId}`;
      if (!seen.has(key)) seen.set(key, { listing_id: m.listing_id, other_id: otherId, last: m.content, at: m.created_at, unread: m.receiver_id === userId && !m.read });
    }
    const convos = Array.from(seen.values());
    const listingIds = [...new Set(convos.map(c => c.listing_id).filter(Boolean))];
    const otherIds = [...new Set(convos.map(c => c.other_id))];
    let listingsById = {}, profilesById = {};
    if (listingIds.length) {
      const { data: ls } = await supabase.from("listings").select("id, title").in("id", listingIds);
      listingsById = Object.fromEntries((ls || []).map(l => [l.id, l]));
    }
    if (otherIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, name").in("id", otherIds);
      profilesById = Object.fromEntries((profs || []).map(p => [p.id, p]));
    }
    setConversations(convos.map(c => ({
      ...c,
      title: c.listing_id ? (listingsById[c.listing_id]?.title || "Listing") : `🤝 ${profilesById[c.other_id]?.name || "Campus Connect"}`,
      other_name: profilesById[c.other_id]?.name || "them",
    })));
  };

  const openChatFromConversation = (c) => {
    setChatTarget({ id: c.listing_id, title: c.title, seller_id: c.other_id, other_user_id: c.other_id, other_user_name: c.other_name || "them" });
  };

  const openChatFromListing = (listing) => {
    setChatTarget({ ...listing, other_user_id: listing.seller_id, other_user_name: listing.seller_name });
  };

  const fetchMatchProfiles = async (userId) => {
    const { data, error } = await supabase.from("match_profiles").select("*").order("created_at", { ascending: false });
    if (error) { console.error("fetchMatchProfiles error:", error); showToast("⚠️ Couldn't load Campus Connect: " + error.message); return; }
    if (!data) return;
    const userIds = [...new Set(data.map(m => m.user_id))];
    let profilesById = {};
    if (userIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, name, account_type, verified").in("id", userIds);
      profilesById = Object.fromEntries((profs || []).map(p => [p.id, p]));
    }
    const mapped = data.map(m => {
      const p = profilesById[m.user_id];
      return { ...m, name: p?.name, account_type: p?.account_type, verified: p?.verified };
    });
    setMatchProfiles(mapped.filter(m => m.user_id !== userId));
    setMyMatchProfile(mapped.find(m => m.user_id === userId) || null);
  };

  const saveMatchProfile = async (form) => {
    const { error } = await supabase.from("match_profiles").upsert({ user_id: currentUser.id, ...form }, { onConflict: "user_id" });
    if (error) { console.error("saveMatchProfile error:", error); showToast("⚠️ Failed: " + error.message); return; }
    showToast("🤝 Your Campus Connect profile is live!");
    setShowMatchForm(false);
    fetchMatchProfiles(currentUser.id);
    findAndNotifyMatches(form);
  };

  // Auto-match: after posting/updating a profile, find others who share a
  // type (roommate/study/friend) or the same course, and notify both sides.
  const findAndNotifyMatches = async (myForm) => {
    const { data: others } = await supabase.from("match_profiles").select("user_id, types, course").neq("user_id", currentUser.id);
    if (!others?.length) return;
    const myCourse = (myForm.course || "").trim().toLowerCase();
    const matches = others.filter(o => {
      const sameType = (o.types || []).some(t => (myForm.types || []).includes(t));
      const sameCourse = myCourse && (o.course || "").trim().toLowerCase() === myCourse;
      return sameType || sameCourse;
    }).slice(0, 5); // cap so an active period doesn't spam notifications
    if (!matches.length) return;
    const rows = matches.map(m => ({ user_id: m.user_id, message: `🤝 New possible match on Campus Connect! Check out ${currentUser.name || "a new profile"}.`, read: false }));
    rows.push({ user_id: currentUser.id, message: `🤝 Found ${matches.length} possible match${matches.length > 1 ? "es" : ""} on Campus Connect!`, read: false });
    await supabase.from("notifications").insert(rows);
  };

  const connectWithMatch = (profile) => {
    setChatTarget({ id: null, seller_id: profile.user_id, other_user_id: profile.user_id, other_user_name: profile.name });
  };

  const markAllRead = async () => {
    if (!currentUser) return;
    await supabase.from("notifications").update({ read: true }).eq("user_id", currentUser.id);
    setNotifications(p => p.map(n => ({ ...n, read: true })));
  };

  const handleLike = async (listingId) => {
    if (!currentUser) return;
    const isLiked = likedIds.includes(listingId);
    const listing = listings.find(l => l.id === listingId);
    if (isLiked) {
      await supabase.from("listing_likes").delete().eq("listing_id", listingId).eq("user_id", currentUser.id);
      await supabase.from("listings").update({ likes: Math.max((listing?.likes || 1) - 1, 0) }).eq("id", listingId);
      setLikedIds(p => p.filter(id => id !== listingId));
    } else {
      await supabase.from("listing_likes").insert({ listing_id: listingId, user_id: currentUser.id });
      await supabase.from("listings").update({ likes: (listing?.likes || 0) + 1 }).eq("id", listingId);
      setLikedIds(p => [...p, listingId]);
      if (listing?.seller_id && listing.seller_id !== currentUser.id) {
        await supabase.from("notifications").insert({ user_id: listing.seller_id, message: `❤️ ${currentUser.name || "Someone"} liked your listing "${listing.title}"`, read: false });
      }
    }
    fetchListings();
  };

  const handleOpenListing = async (listing) => {
    setSelectedListing(listing);
    await supabase.from("listings").update({ views: (listing.views || 0) + 1 }).eq("id", listing.id);
    fetchListings();
  };

  const handlePost = async (form) => {
    if (!currentUser) { setShowAuth(true); return; }
    if (editingListing) {
      await supabase.from("listings").update({ ...form, price: Number(form.price) }).eq("id", editingListing.id);
      showToast("Updated! ✅");
    } else {
      await supabase.from("listings").insert({ ...form, price: Number(form.price), seller_id: currentUser.id, seller_name: currentUser.name || currentUser.email, seller_account_type: currentUser.account_type || "student", seller_business_name: currentUser.business_name || null, seller_business_location: currentUser.business_location || null, seller_avatar_url: currentUser.avatar_url || null, seller_verified: currentUser.verified || false, sponsored: false, sold: false, views: 0, likes: 0 });
      showToast("Listing posted! 🚀");
    }
    fetchListings();
    setShowPostForm(false); setEditingListing(null);
  };

  const handleDelete = async (id) => {
    const { error } = await supabase.from("listings").delete().eq("id", id);
    if (error) { console.error("delete error:", error); showToast("⚠️ Delete failed: " + error.message); return; }
    setListings(p => p.filter(l => l.id !== id));
    setSelectedListing(null);
    showToast("Deleted!");
  };

  const handleBoost = async (id, plan, ref) => {
    const until = new Date(Date.now() + (plan.days || 7) * 86400000).toISOString();
    await supabase.from("listings").update({ sponsored: true, boosted_until: until }).eq("id", id);
    const listing = listings.find(l => l.id === id);
    if (listing?.seller_id) {
      await supabase.from("notifications").insert({ user_id: listing.seller_id, message: `🚀 Your listing "${listing.title}" has been boosted for ${plan.days} days!`, read: false });
    }
    fetchListings();
    showToast("🚀 Boosted! Ref: " + ref);
  };

  const handleMarkSold = async (id, ref) => {
    await supabase.from("listings").update({ sold: true }).eq("id", id);
    fetchListings();
    showToast("🎊 Sold! Ref: " + ref);
  };

  const handleMarkResolved = async (id) => {
    await supabase.from("listings").update({ sold: true }).eq("id", id);
    fetchListings();
    showToast("✅ Marked as resolved — thanks for closing the loop!");
  };

  const fetchFraudReports = async () => {
    const { data, error } = await supabase.from("fraud_reports").select("*").order("created_at", { ascending: false });
    if (error) { console.error("fetchFraudReports error:", error); showToast("⚠️ Couldn't load reports — check console"); return; }
    if (!data) return;
    const listingIds = [...new Set(data.map(r => r.listing_id).filter(Boolean))];
    let listingsById = {};
    if (listingIds.length) {
      const { data: relatedListings } = await supabase.from("listings").select("id, title, seller_id, seller_name").in("id", listingIds);
      listingsById = Object.fromEntries((relatedListings || []).map(l => [l.id, l]));
    }
    setFraudReports(data.map(r => ({ ...r, listings: listingsById[r.listing_id] || null })));
  };

  const handleReport = async (payload) => {
    const { error } = await supabase.from("fraud_reports").insert(payload);
    if (error) {
      console.error("report insert error:", error);
      showToast("⚠️ Report failed: " + error.message);
      return false;
    }
    showToast("🚩 Report submitted. Thank you!");
    return true;
  };

  const resolveReport = async (id, status) => {
    await supabase.from("fraud_reports").update({ status }).eq("id", id);
    fetchFraudReports();
  };

  const banSeller = async (sellerId, reportId) => {
    await supabase.from("profiles").update({ banned: true }).eq("id", sellerId);
    await resolveReport(reportId, "seller_banned");
    showToast("🚫 Seller banned");
  };

  const fetchAllUsers = async () => {
    const { data } = await supabase.from("profiles").select("*").order("last_seen", { ascending: false });
    if (data) setAllUsers(data);
  };

  const fetchPendingVerifications = async () => {
    const { data, error } = await supabase.from("verifications").select("*").eq("status", "pending").order("created_at", { ascending: true });
    if (error) { console.error("fetchPendingVerifications error:", error); showToast("⚠️ Couldn't load verifications: " + error.message); return; }
    if (!data?.length) { setPendingVerifications([]); return; }
    const userIds = [...new Set(data.map(v => v.user_id))];
    const { data: profs } = await supabase.from("profiles").select("id, name, email").in("id", userIds);
    const byId = Object.fromEntries((profs || []).map(p => [p.id, p]));
    setPendingVerifications(data.map(v => ({ ...v, profile: byId[v.user_id] || null })));
  };

  const approveVerification = async (v) => {
    const { error: e1 } = await supabase.from("profiles").update({ verified: true }).eq("id", v.user_id);
    const { error: e2 } = await supabase.from("verifications").update({ status: "approved" }).eq("id", v.id);
    if (e1 || e2) { showToast("⚠️ Failed: " + (e1 || e2).message); return; }
    showToast("🥇 Student verified!");
    fetchPendingVerifications();
  };

  const rejectVerification = async (v) => {
    const { error } = await supabase.from("verifications").update({ status: "rejected" }).eq("id", v.id);
    if (error) { showToast("⚠️ Failed: " + error.message); return; }
    showToast("Verification rejected");
    fetchPendingVerifications();
  };

  const toggleAdmin = async (userId, makeAdmin) => {
    const { error } = await supabase.from("profiles").update({ role: makeAdmin ? "admin" : "student" }).eq("id", userId);
    if (error) { console.error("toggleAdmin error:", error); showToast("⚠️ Failed: " + error.message); return; }
    fetchAllUsers();
    showToast(makeAdmin ? "🛡️ Promoted to admin" : "Removed admin access");
  };

  const toggleBanUser = async (userId, ban) => {
    const { error } = await supabase.from("profiles").update({ banned: ban }).eq("id", userId);
    if (error) { console.error("toggleBanUser error:", error); showToast("⚠️ Failed: " + error.message); return; }
    fetchAllUsers();
    showToast(ban ? "🚫 User banned" : "✅ User unbanned");
  };

  const fetchRevenue = async () => {
    const { data } = await supabase.from("payments").select("*");
    if (!data) return;
    const total = data.reduce((s, p) => s + Number(p.amount || 0), 0);
    const boost = data.filter(p => p.type === "boost").reduce((s, p) => s + Number(p.amount || 0), 0);
    const sale = data.filter(p => p.type === "sale").reduce((s, p) => s + Number(p.amount || 0), 0);
    const byDay = Array.from({ length: 7 }).map((_, i) => {
      const day = new Date(Date.now() - (6 - i) * 86400000);
      const label = day.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2);
      const val = data.filter(p => new Date(p.created_at).toDateString() === day.toDateString()).reduce((s, p) => s + Number(p.amount || 0), 0);
      return { label, value: val, color: COLORS.success };
    });
    setRevenueStats({ total, boost, sale, count: data.length, byDay });
  };

  const sendBroadcast = async () => {
    if (!broadcastMsg.trim()) return;
    setBroadcastSending(true);
    const { data: users } = await supabase.from("profiles").select("id");
    if (users?.length) {
      const rows = users.map(u => ({ user_id: u.id, message: `📢 ${broadcastMsg.trim()}`, read: false }));
      const { error } = await supabase.from("notifications").insert(rows);
      if (error) { console.error("broadcast error:", error); showToast("⚠️ Broadcast failed: " + error.message); setBroadcastSending(false); return; }
    }
    setBroadcastSending(false);
    setBroadcastMsg("");
    showToast(`📢 Broadcast sent to ${users?.length || 0} users!`);
  };

  const handleSignOut = async () => {
    if (currentUser) {
      await supabase.from("profiles").update({ is_online: false }).eq("id", currentUser.id);
    }
    await supabase.auth.signOut();
    setCurrentUser(null);
    setMfaVerified(false);
  };

  const deleteMyAccount = async () => {
    const { data, error } = await supabase.functions.invoke("delete-account", {});
    if (error || data?.error) {
      console.error("delete-account error:", error || data?.error);
      return false;
    }
    await supabase.auth.signOut();
    setCurrentUser(null);
    setMfaVerified(false);
    setShowDeleteAccount(false);
    showToast("👋 Your account has been deleted. Take care!");
    return true;
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const requireLogin = () => { if (!currentUser) { setShowAuth(true); return false; } return true; };
  const isCustomer = currentUser?.account_type === "customer";

  const openPostForm = () => {
    if (!requireLogin()) return;
    if (isCustomer) { showToast("🛍️ Customer accounts can browse and buy, but can't post listings."); return; }
    setShowPostForm(true);
  };
  const guardedToggleWatchlist = (id) => { if (!requireLogin()) return; toggleWatchlist(id); };
  const guardedLike = (id) => { if (!requireLogin()) return; handleLike(id); };
  const guardedOpenChat = (listing) => { if (!requireLogin()) return; openChatFromListing(listing); };
  const guardedOpenChatFromConv = (c) => { if (!requireLogin()) return; openChatFromConversation(c); };
  const guardedReport = (listing) => { if (!requireLogin()) return; setReportTarget(listing); };
  const guardedBoost = (listing) => { if (!requireLogin()) return; setBoostTarget(listing); };
  const guardedSale = (listing) => { if (!requireLogin()) return; setSaleTarget(listing); };
  const guardedMarkResolved = (id) => { if (!requireLogin()) return; handleMarkResolved(id); };

  if (loading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, ${COLORS.grad1}, ${COLORS.grad2})`, color: "#fff", fontSize: 24, fontWeight: 900, fontFamily: "sans-serif" }}>🎓 CampusMarket</div>;
  if (showAuth) return <AuthScreen onAuth={u => { setCurrentUser(u); setShowAuth(false); }} onGuest={() => setShowAuth(false)} onClose={() => setShowAuth(false)} />;
  if (currentUser?.banned) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: COLORS.bg, padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 52 }}>🚫</div>
      <div style={{ fontWeight: 900, fontSize: 20, marginTop: 12 }}>Account suspended</div>
      <div style={{ color: COLORS.muted, fontSize: 14, marginTop: 8, maxWidth: 320 }}>Your account was suspended for a policy violation (fraud report). Contact support if you think this is a mistake.</div>
      <a href={`https://wa.me/${OWNER.whatsapp}`} target="_blank" rel="noreferrer" style={{ marginTop: 20, background: "#25d366", color: "#fff", padding: "10px 20px", borderRadius: 12, fontWeight: 800, textDecoration: "none" }}>💬 Contact Support</a>
    </div>
  );

  const filtered = listings.filter(l => {
    const ms = l.title?.toLowerCase().includes(search.toLowerCase()) || l.description?.toLowerCase().includes(search.toLowerCase());
    const mc = activeCategory === "all" || l.category === activeCategory;
    if (activeTab === "jobs") return l.category === "jobs" && !l.sold && ms;
    if (activeTab === "lostfound") return l.category === "lostfound" && !l.sold && ms;
    if (activeTab === "events") return l.category === "events" && !l.sold && ms;
    if (activeTab === "mine") return l.seller_id === currentUser?.id && ms;
    if (activeTab === "saved") return watchlistIds.includes(l.id) && ms;
    if (smartResultIds) return smartResultIds.includes(l.id) && !l.sold;
    return ms && mc && !l.sold;
  });
  const orderedFiltered = smartResultIds && activeTab === "home"
    ? smartResultIds.map(id => filtered.find(l => l.id === id)).filter(Boolean)
    : filtered;

  const featured = orderedFiltered.filter(l => l.sponsored && !l.sold);
  const regular = orderedFiltered.filter(l => !l.sponsored);
  const tabs = [["home","🏠","Home"],["jobs","💼","Jobs"],["events","🎉","Events"],["lostfound","🔍","L&F"]];
  if (currentUser) tabs.push(["match","🤝","Connect"], ["saved","🔖","Saved"], ["chats","💬","Chats"], ["mine","📋","Mine"]);
  if (currentUser?.role === "admin") tabs.push(["admin","🛡️","Admin"]);

  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", background: COLORS.bg, minHeight: "100vh", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ background: `linear-gradient(135deg, ${COLORS.grad1}, ${COLORS.grad2})`, padding: "14px 16px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 900, fontSize: 20 }}>🎓 CampusMarket</div>
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, display: "flex", gap: 8, alignItems: "center" }}>
              <span>{currentUser ? `Hey ${currentUser.name || currentUser.email?.split("@")[0]} 👀` : "Browsing as guest 👀"}</span>
              <button onClick={() => setShowActiveUsers(true)} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 20, padding: "2px 8px", fontSize: 11, color: "#fff", cursor: "pointer", fontWeight: 700 }}>
                🟢 {activeUsers} online
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {currentUser && (
              <button onClick={inviteFriends} title="Invite friends" style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 12, width: 38, height: 38, cursor: "pointer", fontSize: 17 }}>🎁</button>
            )}
            {currentUser && (
              <button onClick={() => setShowNotifications(true)} style={{ position: "relative", background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 12, width: 38, height: 38, cursor: "pointer", fontSize: 18 }}>
                🔔
                {unreadCount > 0 && <div style={{ position: "absolute", top: -4, right: -4, background: COLORS.danger, color: "#fff", borderRadius: "50%", width: 18, height: 18, fontSize: 10, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{unreadCount}</div>}
              </button>
            )}
            {currentUser ? (
              <button onClick={() => { setEditingListing(null); openPostForm(); }} style={{ background: "#fff", color: COLORS.primary, border: "none", borderRadius: 12, padding: "9px 16px", fontWeight: 900, fontSize: 13, cursor: "pointer" }}>+ Sell</button>
            ) : (
              <button onClick={() => setShowAuth(true)} style={{ background: "#fff", color: COLORS.primary, border: "none", borderRadius: 12, padding: "9px 16px", fontWeight: 900, fontSize: 13, cursor: "pointer" }}>Log In</button>
            )}
          </div>
        </div>
        <div style={{ position: "relative", display: "flex", gap: 8 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <input value={search} onChange={e => { setSearch(e.target.value); setSmartResultIds(null); }}
              onKeyDown={e => { if (e.key === "Enter" && smartSearchOn) runSmartSearch(search); }}
              placeholder={smartSearchOn ? "Ask for anything, e.g. 'cheap laptop for coding'…" : "Search listings…"}
              style={{ width: "100%", padding: "12px 16px 12px 40px", borderRadius: 14, border: "none", fontSize: 14, boxSizing: "border-box", background: "rgba(255,255,255,0.2)", color: "#fff", outline: "none", fontFamily: "inherit" }} />
            <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 16 }}>{smartSearching ? "⏳" : "🔍"}</span>
          </div>
          <button onClick={() => { setSmartSearchOn(p => !p); setSmartResultIds(null); }}
            title="Toggle AI-powered smart search"
            style={{ background: smartSearchOn ? "#fff" : "rgba(255,255,255,0.2)", color: smartSearchOn ? COLORS.primary : "#fff", border: "none", borderRadius: 14, padding: "0 14px", fontWeight: 900, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
            ✨ AI
          </button>
        </div>
      </div>

      {activeTab === "home" && (
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", overflowX: "auto", background: "#fff", borderBottom: `1px solid ${COLORS.border}` }}>
          <button onClick={() => setActiveCategory("all")} style={{ padding: "7px 16px", borderRadius: 30, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 12, background: activeCategory === "all" ? COLORS.primary : "#f0f0f7", color: activeCategory === "all" ? "#fff" : COLORS.muted, whiteSpace: "nowrap" }}>All 🔥</button>
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => setActiveCategory(c.id)} style={{ padding: "7px 16px", borderRadius: 30, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 12, background: activeCategory === c.id ? c.color : c.bg, color: activeCategory === c.id ? "#fff" : c.color, whiteSpace: "nowrap" }}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: 16, paddingBottom: 90 }}>
        {activeTab === "admin" && !mfaVerified && (
          <AdminMFAGate onVerified={() => setMfaVerified(true)} />
        )}

        {activeTab === "admin" && mfaVerified && (
          <div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 14 }}>
              {[["dashboard","🛡️","Listings"],["earnings","💰","Earnings"],["reports","🚩","Reports"],["analytics","📊","Stats"],["users","👥","Users"],["verify","🥇","Verify"],["broadcast","📢","Broadcast"]].map(([s, icon, label]) => (
                <button key={s} onClick={() => setAdminSection(s)} style={{ padding: "7px 14px", borderRadius: 30, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 12, whiteSpace: "nowrap", background: adminSection === s ? COLORS.primary : "#fff", color: adminSection === s ? "#fff" : COLORS.muted }}>
                  {icon} {label}
                </button>
              ))}
            </div>

        {adminSection === "dashboard" && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20 }}>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 14 }}>🛡️ All Listings ({listings.length})</div>
            {listings.map(l => (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                <div style={{ fontSize: 24 }}>{CATEGORIES.find(c => c.id === l.category)?.icon || "📦"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title}</div>
                  <div style={{ fontSize: 11, color: COLORS.muted }}>{l.seller_name} · {formatPrice(l.price)} · 👁{l.views||0} · ❤️{l.likes||0}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => { setEditingListing(l); setShowPostForm(true); }}
                    style={{ padding: "5px 10px", borderRadius: 10, border: "none", background: "#f5f0ff", color: COLORS.primary, fontWeight: 800, fontSize: 11, cursor: "pointer" }}>✏️</button>
                  <button onClick={() => supabase.from("listings").update({ sponsored: !l.sponsored }).eq("id", l.id).then(fetchListings)}
                    style={{ padding: "5px 10px", borderRadius: 10, border: "none", background: l.sponsored ? COLORS.primary : "#f0f0f7", color: l.sponsored ? "#fff" : COLORS.muted, fontWeight: 800, fontSize: 11, cursor: "pointer" }}>⭐</button>
                  <button onClick={() => handleDelete(l.id)}
                    style={{ padding: "5px 10px", borderRadius: 10, border: "none", background: "#fff0f0", color: COLORS.danger, fontWeight: 800, fontSize: 11, cursor: "pointer" }}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {adminSection === "earnings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: 20 }}>
              <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>💰 Real Revenue (from verified M-Pesa payments)</div>
              <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 16 }}>Pulled directly from the payments table — actual KSh collected, not estimates.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
                <div style={{ background: "#f0fdf4", borderRadius: 14, padding: 14, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: COLORS.muted, fontWeight: 700 }}>Total Collected</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: COLORS.success }}>{formatKsh(revenueStats.total)}</div>
                </div>
                <div style={{ background: "#f5f0ff", borderRadius: 14, padding: 14, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: COLORS.muted, fontWeight: 700 }}>From Boosts</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: COLORS.primary }}>{formatKsh(revenueStats.boost)}</div>
                </div>
                <div style={{ background: "#fff4e6", borderRadius: 14, padding: 14, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: COLORS.muted, fontWeight: 700 }}>From Commissions</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: "#b45309" }}>{formatKsh(revenueStats.sale)}</div>
                </div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 13, color: COLORS.muted, marginBottom: 8 }}>Revenue — Last 7 Days</div>
              <MiniBarChart data={revenueStats.byDay} />
            </div>
            <div style={{ background: "#fff", borderRadius: 20, padding: 20 }}>
              <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 16 }}>📈 Engagement Stats</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  ["Total Listings", listings.length, COLORS.primary, "📦"],
                  ["Featured", listings.filter(l => l.sponsored).length, COLORS.accent, "⭐"],
                  ["Sold", listings.filter(l => l.sold).length, COLORS.success, "✅"],
                  ["Total Views", listings.reduce((s, l) => s + (l.views || 0), 0), COLORS.primary, "👁"],
                  ["Total Likes", listings.reduce((s, l) => s + (l.likes || 0), 0), COLORS.danger, "❤️"],
                  ["Online Now", activeUsers, COLORS.success, "🟢"],
                ].map(([label, val, color, icon]) => (
                  <div key={label} style={{ background: "#f8fafc", borderRadius: 14, padding: 14, textAlign: "center" }}>
                    <div style={{ fontSize: 24 }}>{icon}</div>
                    <div style={{ fontSize: 11, color: COLORS.muted, fontWeight: 700, marginTop: 4 }}>{label}</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {adminSection === "reports" && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20 }}>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 14 }}>
              🚩 Fraud & Payment Reports ({fraudReports.filter(r => r.status === "pending").length} pending)
            </div>
            {fraudReports.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: COLORS.muted }}>
                <div style={{ fontSize: 40 }}>🎉</div>
                <div style={{ fontWeight: 700, marginTop: 12 }}>No reports — all clear!</div>
              </div>
            ) : fraudReports.map(r => (
              <div key={r.id} style={{ padding: "12px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{r.auto ? "🤖 Auto-flagged" : "👤 User report"} · {r.reason}</div>
                    <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>{r.listings?.title || "Listing removed"} · {timeAgo(r.created_at)}</div>
                    {r.details && <div style={{ fontSize: 12, color: COLORS.text, marginTop: 4 }}>{r.details}</div>}
                  </div>
                  <Pill color={r.status === "pending" ? "#b45309" : r.status === "dismissed" ? COLORS.muted : COLORS.danger} bg={r.status === "pending" ? "#fffbeb" : r.status === "dismissed" ? "#f0f0f7" : "#fff0f0"}>{r.status}</Pill>
                </div>
                {r.status === "pending" && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <button onClick={() => resolveReport(r.id, "dismissed")} style={{ padding: "5px 12px", borderRadius: 10, border: `1.5px solid ${COLORS.border}`, background: "#fff", color: COLORS.muted, fontWeight: 800, fontSize: 11, cursor: "pointer" }}>Dismiss</button>
                    {r.listing_id && <button onClick={() => { handleDelete(r.listing_id); resolveReport(r.id, "listing_removed"); }} style={{ padding: "5px 12px", borderRadius: 10, border: `1.5px solid ${COLORS.danger}`, background: "#fff0f0", color: COLORS.danger, fontWeight: 800, fontSize: 11, cursor: "pointer" }}>🗑️ Delete Listing</button>}
                    {r.listings?.seller_id && <button onClick={() => banSeller(r.listings.seller_id, r.id)} style={{ padding: "5px 12px", borderRadius: 10, border: `1.5px solid ${COLORS.danger}`, background: COLORS.danger, color: "#fff", fontWeight: 800, fontSize: 11, cursor: "pointer" }}>🚫 Ban Seller</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === "chats" && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20 }}>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 14 }}>💬 Your Conversations</div>
            {conversations.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: COLORS.muted }}>
                <div style={{ fontSize: 40 }}>💬</div>
                <div style={{ fontWeight: 700, marginTop: 12 }}>No conversations yet.</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>Message a seller from any listing to start one.</div>
              </div>
            ) : conversations.map(c => (
              <div key={`${c.listing_id}-${c.other_id}`} onClick={() => guardedOpenChatFromConv(c)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>{c.title}</div>
                  <div style={{ fontSize: 12, color: COLORS.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}>{c.last}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <span style={{ fontSize: 11, color: COLORS.muted }}>{timeAgo(c.at)}</span>
                  {c.unread && <span style={{ background: COLORS.danger, width: 8, height: 8, borderRadius: "50%", display: "block" }} />}
                </div>
              </div>
            ))}
          </div>
        )}

        {adminSection === "analytics" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: 20 }}>
              <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 14 }}>📦 Listings by Category</div>
              <MiniBarChart data={CATEGORIES.map(c => ({ label: c.icon, value: listings.filter(l => l.category === c.id).length, color: c.color }))} />
            </div>
            <div style={{ background: "#fff", borderRadius: 20, padding: 20 }}>
              <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 14 }}>🔍 Lost & Found Breakdown</div>
              {(() => {
                const lf = listings.filter(l => l.category === "lostfound");
                const lost = lf.filter(l => l.lf_status === "lost").length;
                const found = lf.filter(l => l.lf_status === "found").length;
                const resolved = lf.filter(l => l.sold).length;
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div style={{ background: "#fff0f0", borderRadius: 14, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: COLORS.muted, fontWeight: 700 }}>😢 Lost</div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: COLORS.danger }}>{lost}</div>
                    </div>
                    <div style={{ background: "#f0fdf4", borderRadius: 14, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: COLORS.muted, fontWeight: 700 }}>🎉 Found</div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: COLORS.success }}>{found}</div>
                    </div>
                    <div style={{ background: "#f5f0ff", borderRadius: 14, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: COLORS.muted, fontWeight: 700 }}>✅ Resolved</div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: COLORS.primary }}>{resolved}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div style={{ background: "#fff", borderRadius: 20, padding: 20 }}>
              <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 14 }}>📈 New Listings — Last 7 Days</div>
              <MiniBarChart data={Array.from({ length: 7 }).map((_, i) => {
                const day = new Date(Date.now() - (6 - i) * 86400000);
                const label = day.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2);
                const count = listings.filter(l => new Date(l.created_at).toDateString() === day.toDateString()).length;
                return { label, value: count, color: COLORS.primary };
              })} />
            </div>
            <div style={{ background: "#fff", borderRadius: 20, padding: 20 }}>
              <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 14 }}>🔥 Top 5 Liked Listings</div>
              {[...listings].sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 5).map(l => (
                <div key={l.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${COLORS.border}`, fontSize: 13 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{l.title}</span>
                  <span style={{ fontWeight: 800, color: COLORS.danger }}>❤️ {l.likes || 0}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {adminSection === "users" && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20 }}>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 14 }}>👥 All Users ({allUsers.length})</div>
            <input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search by name or email…"
              style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 13, boxSizing: "border-box", outline: "none", marginBottom: 14, fontFamily: "inherit" }} />
            {allUsers
              .filter(u => u.name?.toLowerCase().includes(userSearch.toLowerCase()) || u.email?.toLowerCase().includes(userSearch.toLowerCase()))
              .map(u => (
                <div key={u.id} style={{ padding: "12px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {u.is_online && <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.success, display: "inline-block" }} />}
                        {u.name || "Unnamed"}
                        {u.role === "admin" && <Pill color={COLORS.primary} bg="#f5f0ff">🛡️ Admin</Pill>}
                        {u.account_type === "business" && <Pill color="#b45309" bg="#fff4e6">🏪 Business</Pill>}
                        {u.verified && <Pill color="#92750f" bg="#fffbe8">🥇 Verified</Pill>}
                        {u.banned && <Pill color={COLORS.danger} bg="#fff0f0">🚫 Banned</Pill>}
                      </div>
                      <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>{u.email}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {u.id !== currentUser.id && (
                        <button onClick={() => toggleAdmin(u.id, u.role !== "admin")}
                          style={{ padding: "5px 10px", borderRadius: 10, border: "none", background: u.role === "admin" ? "#f0f0f7" : "#f5f0ff", color: u.role === "admin" ? COLORS.muted : COLORS.primary, fontWeight: 800, fontSize: 11, cursor: "pointer" }}>
                          {u.role === "admin" ? "Remove Admin" : "Make Admin"}
                        </button>
                      )}
                      {u.id !== currentUser.id && (
                        <button onClick={() => toggleBanUser(u.id, !u.banned)}
                          style={{ padding: "5px 10px", borderRadius: 10, border: "none", background: u.banned ? "#f0fdf4" : "#fff0f0", color: u.banned ? COLORS.success : COLORS.danger, fontWeight: 800, fontSize: 11, cursor: "pointer" }}>
                          {u.banned ? "Unban" : "Ban"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}

        {adminSection === "verify" && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20 }}>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>🥇 Student Verification Requests</div>
            <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 16 }}>Review the school ID photo, then approve or reject.</div>
            {pendingVerifications.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: COLORS.muted }}>
                <div style={{ fontSize: 40 }}>🎉</div>
                <div style={{ fontWeight: 700, marginTop: 12 }}>No pending requests</div>
              </div>
            ) : pendingVerifications.map(v => (
              <div key={v.id} style={{ display: "flex", gap: 12, padding: "14px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                <img src={v.id_image_url} alt="School ID" style={{ width: 72, height: 72, borderRadius: 12, objectFit: "cover", flexShrink: 0, cursor: "pointer" }} onClick={() => window.open(v.id_image_url, "_blank")} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>{v.profile?.name || "Unknown"}</div>
                  <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 8 }}>{v.profile?.email} · {timeAgo(v.created_at)}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => approveVerification(v)} style={{ padding: "6px 12px", borderRadius: 10, border: "none", background: "#fffbe8", color: "#92750f", fontWeight: 800, fontSize: 11, cursor: "pointer" }}>🥇 Approve</button>
                    <button onClick={() => rejectVerification(v)} style={{ padding: "6px 12px", borderRadius: 10, border: "none", background: "#fff0f0", color: COLORS.danger, fontWeight: 800, fontSize: 11, cursor: "pointer" }}>Reject</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {adminSection === "broadcast" && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20 }}>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>📢 Broadcast Announcement</div>
            <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 14 }}>Sends a notification to every registered user, instantly.</div>
            <textarea value={broadcastMsg} onChange={e => setBroadcastMsg(e.target.value)} rows={4} placeholder="e.g. Maintenance tonight from 10PM–12AM, or: New Lost & Found section is live!"
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.border}`, fontSize: 14, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", outline: "none", marginBottom: 14 }} />
            <button onClick={sendBroadcast} disabled={broadcastSending || !broadcastMsg.trim()}
              style={{ width: "100%", background: broadcastMsg.trim() ? `linear-gradient(135deg, ${COLORS.grad1}, ${COLORS.grad2})` : "#f0f0f7", color: broadcastMsg.trim() ? "#fff" : COLORS.muted, border: "none", borderRadius: 14, padding: "13px 0", fontWeight: 900, fontSize: 15, cursor: broadcastMsg.trim() ? "pointer" : "default" }}>
              {broadcastSending ? "Sending…" : "📢 Send to Everyone"}
            </button>
          </div>
        )}
          </div>
        )}

        {activeTab === "match" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>🤝 Campus Connect</div>
              <button onClick={() => setShowMatchForm(true)} style={{ background: myMatchProfile ? "#f0f0f7" : `linear-gradient(135deg, ${COLORS.grad1}, ${COLORS.grad2})`, color: myMatchProfile ? COLORS.text : "#fff", border: "none", borderRadius: 12, padding: "8px 14px", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                {myMatchProfile ? "✏️ Edit My Profile" : "+ Post My Profile"}
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 14 }}>
              <button onClick={() => setMatchFilter("all")} style={{ padding: "6px 14px", borderRadius: 30, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 12, whiteSpace: "nowrap", background: matchFilter === "all" ? COLORS.primary : "#fff", color: matchFilter === "all" ? "#fff" : COLORS.muted }}>All</button>
              {MATCH_TYPES.map(t => (
                <button key={t.id} onClick={() => setMatchFilter(t.id)} style={{ padding: "6px 14px", borderRadius: 30, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 12, whiteSpace: "nowrap", background: matchFilter === t.id ? t.color : t.bg, color: matchFilter === t.id ? "#fff" : t.color }}>{t.icon} {t.label}</button>
              ))}
            </div>
            {!myMatchProfile && (
              <div style={{ background: "#fffbe8", border: `2px dashed #f6c945`, borderRadius: 16, padding: 14, marginBottom: 16, fontSize: 13, color: "#92750f", fontWeight: 600 }}>
                🤝 Post your own profile so others can find and connect with you too!
              </div>
            )}
            {matchProfiles.filter(m => matchFilter === "all" || (m.types || []).includes(matchFilter)).length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: COLORS.muted }}>
                <div style={{ fontSize: 40 }}>🤝</div>
                <div style={{ fontWeight: 700, marginTop: 12 }}>No one here yet — be the first!</div>
              </div>
            ) : matchProfiles.filter(m => matchFilter === "all" || (m.types || []).includes(matchFilter)).map(m => (
              <MatchCard key={m.id} profile={m} onConnect={p => { if (!requireLogin()) return; connectWithMatch(p); }} />
            ))}
          </div>
        )}

        {activeTab !== "admin" && activeTab !== "chats" && activeTab !== "match" && <>
          {featured.length > 0 && activeTab === "home" && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 900, fontSize: 13, color: COLORS.primary, marginBottom: 10 }}>⭐ FEATURED</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
                {featured.map(l => <ListingCard key={l.id} listing={l} onOpen={handleOpenListing} currentUser={currentUser} onDelete={handleDelete} onEdit={l => { setEditingListing(l); setShowPostForm(true); }} onBoost={guardedBoost} onMarkSold={guardedSale} onLike={guardedLike} likedIds={likedIds} onToggleWatch={guardedToggleWatchlist} watchlistIds={watchlistIds} />)}
              </div>
            </div>
          )}
          {regular.length > 0 ? (
            <div>
              <div style={{ fontWeight: 900, fontSize: 13, color: COLORS.muted, marginBottom: 10 }}>{orderedFiltered.length} LISTING{orderedFiltered.length !== 1 ? "S" : ""}{activeTab === "saved" ? " SAVED" : ""}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
                {regular.map(l => <ListingCard key={l.id} listing={l} onOpen={handleOpenListing} currentUser={currentUser} onDelete={handleDelete} onEdit={l => { setEditingListing(l); setShowPostForm(true); }} onBoost={guardedBoost} onMarkSold={guardedSale} onLike={guardedLike} likedIds={likedIds} onToggleWatch={guardedToggleWatchlist} watchlistIds={watchlistIds} />)}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "60px 20px", color: COLORS.muted }}>
              <div style={{ fontSize: 60 }}>{activeTab === "saved" ? "🔖" : activeTab === "lostfound" ? "🔍" : "📭"}</div>
              <div style={{ fontWeight: 900, fontSize: 18, marginTop: 12, color: COLORS.text }}>{activeTab === "saved" ? "Nothing saved yet!" : activeTab === "lostfound" ? "Nothing reported yet" : "No listings yet!"}</div>
              <div style={{ fontSize: 14, marginTop: 6 }}>{activeTab === "saved" ? "Tap 📑 on any listing to save it here." : activeTab === "lostfound" ? "Lost something, or found something? Post it here." : "Be the first to post something!"}</div>
              {activeTab !== "saved" && <button onClick={openPostForm} style={{ marginTop: 16, background: `linear-gradient(135deg, ${COLORS.grad1}, ${COLORS.grad2})`, color: "#fff", border: "none", borderRadius: 12, padding: "12px 24px", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>{activeTab === "lostfound" ? "+ Report Lost/Found Item" : "+ Post First Listing"}</button>}
            </div>
          )}
        </>}
        {activeTab === "home" && (
          <div style={{ textAlign: "center", padding: "20px 0 6px", fontSize: 11, color: COLORS.muted }}>
            <button onClick={() => setShowTermsFooter(true)} style={{ background: "none", border: "none", color: COLORS.muted, fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>Terms & Privacy Policy</button>
          </div>
        )}
        {activeTab === "mine" && currentUser && (
          <div style={{ background: "#fff", borderRadius: 16, padding: 16, marginTop: 20, textAlign: "center" }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: COLORS.muted, marginBottom: 10 }}>Account Settings</div>
            <button onClick={() => setShowDeleteAccount(true)} style={{ background: "#fff0f0", color: COLORS.danger, border: "none", borderRadius: 12, padding: "10px 20px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>🗑️ Delete My Account</button>
          </div>
        )}
      </div>
      {showTermsFooter && <TermsModal onClose={() => setShowTermsFooter(false)} />}
      {showDeleteAccount && <DeleteAccountModal onClose={() => setShowDeleteAccount(false)} onConfirm={deleteMyAccount} />}

      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 900, background: "#fff", borderTop: `1px solid ${COLORS.border}`, display: "flex", padding: "8px 0 12px", zIndex: 500 }}>
        {tabs.map(([t, icon, label]) => (
          <button key={t} onClick={() => setActiveTab(t)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "4px 0" }}>
            <span style={{ fontSize: 20 }}>{icon}</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: activeTab === t ? COLORS.primary : COLORS.muted }}>{label}</span>
          </button>
        ))}
        {currentUser ? (
          <button onClick={handleSignOut} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "4px 0" }}>
            <span style={{ fontSize: 20 }}>🚪</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: COLORS.muted }}>Out</span>
          </button>
        ) : (
          <button onClick={() => setShowAuth(true)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "4px 0" }}>
            <span style={{ fontSize: 20 }}>🔑</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: COLORS.primary }}>Login</span>
          </button>
        )}
      </div>

      {selectedListing && <ListingModal listing={selectedListing} onClose={() => setSelectedListing(null)} currentUser={currentUser} onBoost={guardedBoost} onMarkSold={guardedSale} onLike={guardedLike} likedIds={likedIds} onReport={guardedReport} onToggleWatch={guardedToggleWatchlist} watchlistIds={watchlistIds} onOpenChat={guardedOpenChat} onMarkResolved={guardedMarkResolved} requireLogin={requireLogin} />}
      {showPostForm && <PostForm onSubmit={handlePost} onClose={() => { setShowPostForm(false); setEditingListing(null); }} initial={editingListing} />}
      {boostTarget && <BoostModal listing={boostTarget} onClose={() => setBoostTarget(null)} onBoost={handleBoost} currentUser={currentUser} />}
      {saleTarget && <SaleModal listing={saleTarget} onClose={() => setSaleTarget(null)} onMarkSold={handleMarkSold} currentUser={currentUser} />}
      {showNotifications && <NotificationsPanel notifications={notifications} onClose={() => setShowNotifications(false)} onMarkRead={markAllRead} />}
      {showActiveUsers && <ActiveUsersPanel onClose={() => setShowActiveUsers(false)} />}
      {reportTarget && <ReportModal listing={reportTarget} currentUser={currentUser} onClose={() => setReportTarget(null)} onSubmit={handleReport} />}
      {chatTarget && <ChatModal listing={chatTarget} currentUser={currentUser} onClose={() => { setChatTarget(null); fetchConversations(currentUser.id); }} />}
      {showMatchForm && <MatchProfileForm onClose={() => setShowMatchForm(false)} onSubmit={saveMatchProfile} initial={myMatchProfile} />}

      {toast && (
        <div style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: COLORS.text, color: "#fff", padding: "12px 28px", borderRadius: 30, fontWeight: 800, fontSize: 14, zIndex: 9999, maxWidth: "88vw", textAlign: "center" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
