/**
 * NotificationSystem.tsx
 * Real-time notification bell + profile completion ring for farmers.
 * Shows alerts for missing user profile fields and missing farm/plot fields.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Bell, User, Leaf, X, ChevronRight, CheckCircle, AlertTriangle, Info, RefreshCw } from "lucide-react";
import { getFarmerMyProfile } from "../api";
import { getUserRole } from "../utils/auth";

export interface Notification {
  id: string;
  type: "profile" | "farm" | "plot" | "info";
  severity: "warning" | "info" | "success";
  title: string;
  message: string;
  action?: string;       // label for the CTA
  actionTarget?: string; // view key to navigate to
  read: boolean;
  ts: number;
}

interface Props {
  onNavigate?: (view: string) => void; // callback to switch view in App.tsx
}

// ── Field completeness checkers ────────────────────────────────────────────
function checkUserFields(data: any): string[] {
  const missing: string[] = [];
  const fp = data?.farmer_profile ?? data ?? {};
  const pi = fp.personal_info ?? {};
  const ai = fp.address_info ?? {};

  if (!pi.first_name && !fp.first_name) missing.push("First Name");
  if (!pi.last_name && !fp.last_name) missing.push("Last Name");
  if (!fp.email) missing.push("Email");
  if (!pi.phone_number && !fp.phone_number) missing.push("Phone Number");
  if (!ai.village && !fp.village) missing.push("Village");
  if (!ai.district && !fp.district) missing.push("District");
  if (!ai.state && !fp.state) missing.push("State");
  if (!ai.taluka && !fp.taluka) missing.push("Taluka");
  if (!pi.aadhaar_number && !fp.aadhaar_number) missing.push("Aadhaar Number");
  return missing;
}

function checkFarmFields(data: any): string[] {
  const missing: string[] = [];
  const plot = (data?.plots ?? [])[0];
  const farm = (plot?.farms ?? [])[0] ?? data?.farm ?? {};

  if (!farm.plantation_date) missing.push("Plantation Date");
  if (!farm.area_size) missing.push("Area Size");
  const variety = farm.crop_variety ?? farm.crop_type?.crop_variety;
  if (!variety) missing.push("Crop Variety");
  const plantationType = farm.variety_type ?? farm.crop_type?.plantation_type;
  if (!plantationType) missing.push("Plantation Type");
  const plantingMethod = farm.variety_subtype ?? farm.crop_type?.planting_method;
  if (!plantingMethod) missing.push("Planting Method");
  const irr = (farm.irrigations ?? [])[0];
  if (!irr?.flow_rate_lph && !farm.flow_rate_liter_per_hour) missing.push("Flow Rate");
  if (!irr?.emitters_count && !farm.emitters_per_plant) missing.push("Emitters Per Plant");
  if (!farm.spacing_a) missing.push("Spacing A");
  if (!farm.spacing_b) missing.push("Spacing B");
  if (!farm.plants_in_field) missing.push("Plants in Field");
  return missing;
}

// Build completion percentage (user: 50%, farm: 50%)
function calcCompletion(userMissing: string[], farmMissing: string[]): number {
  const USER_TOTAL = 9;
  const FARM_TOTAL = 9;
  const userDone = Math.max(0, USER_TOTAL - userMissing.length);
  const farmDone = Math.max(0, FARM_TOTAL - farmMissing.length);
  const pct = ((userDone / USER_TOTAL) * 50) + ((farmDone / FARM_TOTAL) * 50);
  return Math.round(pct);
}

// Build notification list from missing fields
function buildNotifications(userMissing: string[], farmMissing: string[]): Notification[] {
  const notes: Notification[] = [];
  const now = Date.now();

  if (userMissing.length > 0) {
    notes.push({
      id: "user-missing",
      type: "profile",
      severity: "warning",
      title: "Complete Your Profile",
      message: `Missing: ${userMissing.slice(0, 3).join(", ")}${userMissing.length > 3 ? ` & ${userMissing.length - 3} more` : ""}`,
      action: "Update Profile",
      actionTarget: "MyProfile",
      read: false,
      ts: now,
    });
  }

  if (farmMissing.length > 0) {
    notes.push({
      id: "farm-missing",
      type: "farm",
      severity: "warning",
      title: "Farm Data Incomplete",
      message: `Missing: ${farmMissing.slice(0, 3).join(", ")}${farmMissing.length > 3 ? ` & ${farmMissing.length - 3} more` : ""}`,
      action: "Update Farm",
      actionTarget: "MyProfile",
      read: false,
      ts: now,
    });
  }

  if (userMissing.length === 0 && farmMissing.length === 0) {
    notes.push({
      id: "all-complete",
      type: "info",
      severity: "success",
      title: "Profile Complete 🎉",
      message: "All your profile and farm details are filled in.",
      read: false,
      ts: now,
    });
  }

  return notes;
}

// ── Circular progress ring ─────────────────────────────────────────────────
const ProgressRing: React.FC<{ pct: number; size?: number }> = ({ pct, size = 36 }) => {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={5} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={5}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
    </svg>
  );
};

// ── Main component ─────────────────────────────────────────────────────────
const NotificationSystem: React.FC<Props> = ({ onNavigate }) => {
  const userRole = getUserRole();
  const isFarmer = userRole === "farmer";

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [completion, setCompletion] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch and analyse profile ────────────────────────────────────────────
  const fetchAndAnalyse = useCallback(async () => {
    if (!isFarmer) return;
    try {
      setLoading(true);
      const res = await getFarmerMyProfile();
      const data = res.data ?? res;
      const uMissing = checkUserFields(data);
      const fMissing = checkFarmFields(data);
      const pct = calcCompletion(uMissing, fMissing);
      setCompletion(pct);
      setNotifications(buildNotifications(uMissing, fMissing));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [isFarmer]);

  useEffect(() => {
    fetchAndAnalyse();
    // Poll every 5 minutes
    pollRef.current = setInterval(fetchAndAnalyse, 5 * 60 * 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchAndAnalyse]);

  // ── Close on outside click ───────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const unread = notifications.filter(n => !n.read).length;

  const markAllRead = () =>
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));

  const handleAction = (n: Notification) => {
    setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
    if (n.actionTarget && onNavigate) onNavigate(n.actionTarget);
    setOpen(false);
  };

  const iconForType = (type: string, severity: string) => {
    if (severity === "success") return <CheckCircle size={16} className="text-green-500" />;
    if (type === "profile") return <User size={16} className="text-blue-500" />;
    if (type === "farm" || type === "plot") return <Leaf size={16} className="text-orange-500" />;
    return <Info size={16} className="text-gray-400" />;
  };

  const bgForSeverity = (severity: string, read: boolean) => {
    if (read) return "bg-gray-50";
    if (severity === "warning") return "bg-amber-50 border-l-4 border-amber-400";
    if (severity === "success") return "bg-green-50 border-l-4 border-green-400";
    return "bg-blue-50 border-l-4 border-blue-400";
  };

  // Only render for farmers
  if (!isFarmer) return null;

  return (
    <div className="relative" ref={dropRef}>
      {/* Bell button + completion ring */}
      <button
        onClick={() => setOpen(o => !o)}
        className="relative flex items-center gap-1 p-1 rounded-xl hover:bg-white/20 transition-all"
        title={`Profile ${completion}% complete`}
      >
        <div className="relative">
          <ProgressRing pct={completion} size={38} />
          <span
            className="absolute inset-0 flex items-center justify-center"
            style={{ fontSize: "9px", fontWeight: 700, color: completion >= 80 ? "#15803d" : completion >= 50 ? "#b45309" : "#dc2626" }}
          >
            {completion}%
          </span>
        </div>
        <div className="relative ml-1">
          <Bell size={20} className="text-gray-600" />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[17px] h-[17px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5 animate-pulse">
              {unread}
            </span>
          )}
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 z-[9999] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white">
            <div className="flex items-center gap-2">
              <Bell size={16} />
              <span className="font-semibold text-sm">Notifications</span>
              {unread > 0 && (
                <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">{unread}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchAndAnalyse}
                title="Refresh"
                className="p-1 rounded-lg hover:bg-white/20 transition-all"
              >
                <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              </button>
              {unread > 0 && (
                <button onClick={markAllRead} className="text-xs text-white/80 hover:text-white underline">
                  Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-0.5 hover:bg-white/20 rounded-lg transition-all">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Progress banner */}
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-gray-600">Profile Completion</span>
              <span className={`text-xs font-bold ${completion >= 80 ? "text-green-600" : completion >= 50 ? "text-amber-600" : "text-red-600"}`}>
                {completion}%
              </span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${completion >= 80 ? "bg-green-500" : completion >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${completion}%` }}
              />
            </div>
          </div>

          {/* Notification list */}
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-gray-400">
                <Bell size={28} className="opacity-30" />
                <p className="text-sm">No notifications</p>
              </div>
            ) : (
              notifications.map(n => (
                <div key={n.id} className={`px-4 py-3 ${bgForSeverity(n.severity, n.read)}`}>
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 flex-shrink-0">{iconForType(n.type, n.severity)}</div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${n.read ? "text-gray-500" : "text-gray-800"}`}>{n.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.message}</p>
                      {n.action && (
                        <button
                          onClick={() => handleAction(n)}
                          className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-green-600 hover:text-green-700 hover:underline"
                        >
                          {n.action} <ChevronRight size={11} />
                        </button>
                      )}
                    </div>
                    {!n.read && (
                      <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1" />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer link */}
          {onNavigate && (
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => { onNavigate("MyProfile"); setOpen(false); }}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl transition-all"
              >
                <User size={14} /> Go to My Profile
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationSystem;
