import React, { useState, useEffect } from "react";
import {
  User, Mail, Phone, MapPin, FileText, Edit3, Save, X,
  ChevronDown, Leaf, Droplets, Calendar, Ruler, AlertCircle, CheckCircle,
} from "lucide-react";
import { getFarmerMyProfile, patchUserMyProfile, patchFarmMyProfile, refreshApiEndpoints } from "../api";

// ── Plantation type / method constants (same as Add Farm.tsx) ──────────────
const PLANTATION_TYPE_OPTIONS = ["Adsali", "Suru", "pre_seasonal", "Ratoon"];
const PLANTATION_METHOD_OPTIONS = ["3_bud", "2_bud", "1_bud", "1_bud_stip"];

interface UserFormData {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  address: string;
  village: string;
  district: string;
  state: string;
  taluka: string;
  aadhaar_number: string;
}

interface FarmFormData {
  address: string;
  area_size: string;
  plantation_date: string;
  crop_variety: string;
  variety_type: string;        // plantation type (Suru / Adsali …)
  variety_subtype: string;     // planting method (1_bud …)
  spacing_a: string;
  spacing_b: string;
  irrigation_type: string;
  flow_rate_liter_per_hour: string;
  emitters_per_plant: string;
  motor_horsepower: string;
  pipe_width_inches: string;
  distance_motor_to_plot_m: string;
  sugarcane_type: string;
  sugarcane_yield: string;
  plants_in_field: string;
}

const emptyUser: UserFormData = {
  first_name: "", last_name: "", email: "", phone_number: "",
  address: "", village: "", district: "", state: "", taluka: "", aadhaar_number: "",
};
const emptyFarm: FarmFormData = {
  address: "", area_size: "", plantation_date: "", crop_variety: "",
  variety_type: "", variety_subtype: "", spacing_a: "", spacing_b: "",
  irrigation_type: "", flow_rate_liter_per_hour: "",
  emitters_per_plant: "", motor_horsepower: "", pipe_width_inches: "", distance_motor_to_plot_m: "", sugarcane_type: "new", sugarcane_yield: "",
  plants_in_field: "",
};

const InputField: React.FC<{
  label: string; value: string; onChange?: (v: string) => void;
  icon?: React.ReactNode; readOnly?: boolean; type?: string; required?: boolean; placeholder?: string;
}> = ({ label, value, onChange, icon, readOnly, type = "text", required, placeholder }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
      {label}{required && <span className="text-red-500 ml-1">*</span>}
    </label>
    <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${readOnly ? "bg-gray-50 border-gray-200 text-gray-500" : "bg-white border-green-200 focus-within:border-green-500 focus-within:ring-2 focus-within:ring-green-100"}`}>
      {icon && <span className="text-gray-400 flex-shrink-0">{icon}</span>}
      <input
        type={type} value={value}
        readOnly={readOnly}
        placeholder={readOnly ? "—" : (placeholder || "")}
        onChange={e => onChange?.(e.target.value)}
        className="flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder-gray-300"
      />
    </div>
  </div>
);

const SelectField: React.FC<{
  label: string; value: string; options: string[];
  onChange?: (v: string) => void; readOnly?: boolean;
}> = ({ label, value, options, onChange, readOnly }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</label>
    {readOnly ? (
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border bg-gray-50 border-gray-200 text-gray-500 text-sm min-h-[42px]">
        {value || "—"}
      </div>
    ) : (
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange?.(e.target.value)}
          className="w-full px-3 py-2.5 pr-8 rounded-xl border border-green-200 bg-white text-sm text-gray-800 outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 appearance-none"
        >
          <option value="">— Select —</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    )}
  </div>
);

interface Props { onClose?: () => void; }

const MyProfile: React.FC<Props> = ({ onClose }) => {
  const [profileData, setProfileData] = useState<any>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [editingUser, setEditingUser] = useState(false);
  const [editingFarm, setEditingFarm] = useState(false);

  const [userForm, setUserForm] = useState<UserFormData>(emptyUser);
  const [farmForm, setFarmForm] = useState<FarmFormData>(emptyFarm);

  const [savingUser, setSavingUser] = useState(false);
  const [savingFarm, setSavingFarm] = useState(false);
  const [userMsg, setUserMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [farmMsg, setFarmMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ── Load profile ──────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        setLoadingProfile(true);
        const res = await getFarmerMyProfile();
        const data = res.data ?? res;
        setProfileData(data);
        // Prefill user form
        const fp = data.farmer_profile ?? data;
        const pi = fp.personal_info ?? {};
        const ai = fp.address_info ?? {};
        setUserForm({
          first_name: pi.first_name ?? fp.first_name ?? "",
          last_name: pi.last_name ?? fp.last_name ?? "",
          email: fp.email ?? "",
          phone_number: pi.phone_number ?? fp.phone_number ?? "",
          address: ai.address ?? fp.address ?? "",
          village: ai.village ?? fp.village ?? "",
          district: ai.district ?? fp.district ?? "",
          state: ai.state ?? fp.state ?? "",
          taluka: ai.taluka ?? fp.taluka ?? "",
          aadhaar_number: pi.aadhaar_number ?? fp.aadhaar_number ?? "",
        });
        // Prefill farm form from first plot/farm
        const plot = (data.plots ?? [])[0];
        const farm = (plot?.farms ?? [])[0] ?? data.farm ?? {};
        setFarmForm({
          address: farm.address ?? "",
          area_size: farm.area_size?.toString() ?? "",
          plantation_date: farm.plantation_date ?? "",
          crop_variety: farm.crop_variety?.toString() ?? farm.crop_type?.crop_variety?.toString() ?? "",
          variety_type: farm.variety_type ?? farm.crop_type?.plantation_type ?? "",
          variety_subtype: farm.variety_subtype ?? farm.crop_type?.planting_method ?? "",
          spacing_a: farm.spacing_a?.toString() ?? "",
          spacing_b: farm.spacing_b?.toString() ?? "",
          irrigation_type: farm.irrigations?.[0]?.irrigation_type_code ?? farm.irrigation_type ?? "",
          flow_rate_liter_per_hour: farm.irrigations?.[0]?.flow_rate_lph?.toString() ?? farm.flow_rate_liter_per_hour?.toString() ?? "",
          emitters_per_plant: farm.irrigations?.[0]?.emitters_count?.toString() ?? farm.emitters_per_plant?.toString() ?? "",
          motor_horsepower: farm.irrigations?.[0]?.motor_horsepower?.toString() ?? farm.motor_horsepower?.toString() ?? "",
          pipe_width_inches: farm.irrigations?.[0]?.pipe_width_inches?.toString() ?? farm.pipe_width_inches?.toString() ?? "",
          distance_motor_to_plot_m: farm.irrigations?.[0]?.distance_motor_to_plot_m?.toString() ?? farm.distance_motor_to_plot_m?.toString() ?? "",
          sugarcane_type: farm.sugarcane_type ?? "new",
          sugarcane_yield: farm.sugarcane_yield?.toString() ?? "",
          plants_in_field: farm.plants_in_field?.toString() ?? "",
        });
      } catch (e) {
        console.error("MyProfile load error:", e);
      } finally {
        setLoadingProfile(false);
      }
    };
    load();
  }, []);

  // ── Save user profile ─────────────────────────────────────────────────────
  const handleSaveUser = async () => {
    try {
      setSavingUser(true);
      setUserMsg(null);
      await patchUserMyProfile({
        first_name: userForm.first_name,
        last_name: userForm.last_name,
        email: userForm.email,
        phone_number: userForm.phone_number,
        address: userForm.address,
        village: userForm.village,
        district: userForm.district,
        state: userForm.state,
        taluka: userForm.taluka,
        aadhaar_number: userForm.aadhaar_number,
      });
      await refreshApiEndpoints();
      setUserMsg({ type: "success", text: "Profile updated successfully!" });
      setEditingUser(false);
      setTimeout(() => setUserMsg(null), 4000);
    } catch (e: any) {
      const detail = e.response?.data?.detail || e.response?.data?.message || e.message;
      setUserMsg({ type: "error", text: detail || "Failed to save profile." });
    } finally {
      setSavingUser(false);
    }
  };

  // ── Save farm profile ─────────────────────────────────────────────────────
  const handleSaveFarm = async () => {
    try {
      setSavingFarm(true);
      setFarmMsg(null);
      const payload: any = {
        address: farmForm.address || undefined,
        area_size: farmForm.area_size || undefined,
        plantation_date: farmForm.plantation_date || undefined,
        crop_variety: farmForm.crop_variety || undefined,
        variety_type: farmForm.variety_type || undefined,
        variety_subtype: farmForm.variety_subtype || undefined,
        spacing_a: farmForm.spacing_a || undefined,
        spacing_b: farmForm.spacing_b || undefined,
        irrigation_type: farmForm.irrigation_type || undefined,
        sugarcane_type: farmForm.sugarcane_type || undefined,
        sugarcane_yield: farmForm.sugarcane_yield || null,
      };

      if (farmForm.irrigation_type === "drip") {
        payload.flow_rate_liter_per_hour = farmForm.flow_rate_liter_per_hour || undefined;
        payload.emitters_per_plant = farmForm.emitters_per_plant ? Number(farmForm.emitters_per_plant) : undefined;
      } else if (farmForm.irrigation_type === "flood") {
        payload.motor_horsepower = farmForm.motor_horsepower ? Number(farmForm.motor_horsepower) : undefined;
        payload.pipe_width_inches = farmForm.pipe_width_inches ? Number(farmForm.pipe_width_inches) : undefined;
        payload.distance_motor_to_plot_m = farmForm.distance_motor_to_plot_m ? Number(farmForm.distance_motor_to_plot_m) : undefined;
      }

      await patchFarmMyProfile(payload);
      await refreshApiEndpoints();
      setFarmMsg({ type: "success", text: "Farm data updated successfully!" });
      setEditingFarm(false);
      setTimeout(() => setFarmMsg(null), 4000);
    } catch (e: any) {
      const detail = e.response?.data?.detail || e.response?.data?.message || e.message;
      setFarmMsg({ type: "error", text: detail || "Failed to save farm data." });
    } finally {
      setSavingFarm(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const setUser = (key: keyof UserFormData) => (val: string) =>
    setUserForm(f => ({ ...f, [key]: val }));
  const setFarm = (key: keyof FarmFormData) => (val: string) =>
    setFarmForm(f => ({ ...f, [key]: val }));

  const cancelUser = () => setEditingUser(false);
  const cancelFarm = () => setEditingFarm(false);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loadingProfile) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading profile…</p>
        </div>
      </div>
    );
  }

  const FeedbackBanner = ({ msg }: { msg: typeof userMsg }) =>
    msg ? (
      <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${msg.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
        {msg.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
        {msg.text}
      </div>
    ) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 p-4 sm:p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">My Profile</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your personal and farm details</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        )}
      </div>

      <div className="space-y-6 max-w-4xl mx-auto">

        {/* ── PERSONAL INFORMATION ─────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
                <User size={18} className="text-blue-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-800">Personal Information</h2>
                <p className="text-xs text-gray-500">Your contact and identity details</p>
              </div>
            </div>
            {!editingUser ? (
              <button
                onClick={() => setEditingUser(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all"
              >
                <Edit3 size={14} /> Edit
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelUser}
                  className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded-xl hover:bg-gray-50 transition-all"
                >
                  <X size={14} /> Cancel
                </button>
                <button
                  onClick={handleSaveUser}
                  disabled={savingUser}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-60"
                >
                  {savingUser ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={14} />}
                  Save
                </button>
              </div>
            )}
          </div>

          <div className="p-6 space-y-4">
            <FeedbackBanner msg={userMsg} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InputField label="First Name" value={userForm.first_name} onChange={setUser("first_name")} icon={<User size={14} />} readOnly={!editingUser} required />
              <InputField label="Last Name" value={userForm.last_name} onChange={setUser("last_name")} icon={<User size={14} />} readOnly={!editingUser} required />
              <InputField label="Email" value={userForm.email} onChange={setUser("email")} icon={<Mail size={14} />} type="email" readOnly={!editingUser} />
              <InputField label="Phone Number" value={userForm.phone_number} onChange={setUser("phone_number")} icon={<Phone size={14} />} readOnly={!editingUser} required />
              <InputField label="Aadhaar Number" value={userForm.aadhaar_number} onChange={setUser("aadhaar_number")} icon={<FileText size={14} />} readOnly={!editingUser} />
              <InputField label="Address" value={userForm.address} onChange={setUser("address")} icon={<MapPin size={14} />} readOnly={!editingUser} />
              <InputField label="Village" value={userForm.village} onChange={setUser("village")} icon={<MapPin size={14} />} readOnly={!editingUser} />
              <InputField label="Taluka" value={userForm.taluka} onChange={setUser("taluka")} icon={<MapPin size={14} />} readOnly={!editingUser} />
              <InputField label="District" value={userForm.district} onChange={setUser("district")} icon={<MapPin size={14} />} readOnly={!editingUser} />
              <InputField label="State" value={userForm.state} onChange={setUser("state")} icon={<MapPin size={14} />} readOnly={!editingUser} />
            </div>
          </div>
        </div>

        {/* ── FARM / PLOT INFORMATION ──────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
                <Leaf size={18} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-800">Farm & Plot Details</h2>
                <p className="text-xs text-gray-500">Crop, irrigation and spacing information</p>
              </div>
            </div>
            {!editingFarm ? (
              <button
                onClick={() => setEditingFarm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl transition-all"
              >
                <Edit3 size={14} /> Edit
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelFarm}
                  className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded-xl hover:bg-gray-50 transition-all"
                >
                  <X size={14} /> Cancel
                </button>
                <button
                  onClick={handleSaveFarm}
                  disabled={savingFarm}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-60"
                >
                  {savingFarm ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={14} />}
                  Save
                </button>
              </div>
            )}
          </div>

          <div className="p-6 space-y-4">
            <FeedbackBanner msg={farmMsg} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InputField label="Farm Address" value={farmForm.address} onChange={setFarm("address")} icon={<MapPin size={14} />} readOnly={!editingFarm} />
              <InputField label="Area Size (acres)" value={farmForm.area_size} onChange={setFarm("area_size")} icon={<Ruler size={14} />} type="number" readOnly={!editingFarm} />
              <InputField label="Plantation Date" value={farmForm.plantation_date} onChange={setFarm("plantation_date")} icon={<Calendar size={14} />} type="date" readOnly={!editingFarm} />
              <InputField label="Crop Variety" value={farmForm.crop_variety} onChange={setFarm("crop_variety")} icon={<Leaf size={14} />} readOnly={!editingFarm} />

              {/* Dropdowns shown only when editing */}
              <SelectField
                label="Plantation Type (Variety Type)"
                value={farmForm.variety_type}
                options={PLANTATION_TYPE_OPTIONS}
                onChange={setFarm("variety_type")}
                readOnly={!editingFarm}
              />
              <SelectField
                label="Planting Method (Variety Subtype)"
                value={farmForm.variety_subtype}
                options={PLANTATION_METHOD_OPTIONS}
                onChange={setFarm("variety_subtype")}
                readOnly={!editingFarm}
              />

              <InputField label="Spacing A (ft)" value={farmForm.spacing_a} onChange={setFarm("spacing_a")} icon={<Ruler size={14} />} type="number" readOnly={!editingFarm} />
              <InputField label="Spacing B (ft)" value={farmForm.spacing_b} onChange={setFarm("spacing_b")} icon={<Ruler size={14} />} type="number" readOnly={!editingFarm} />
              
              <SelectField
                label="Irrigation Type"
                value={farmForm.irrigation_type}
                options={["drip", "flood"]}
                onChange={setFarm("irrigation_type")}
                readOnly={!editingFarm}
              />

              {farmForm.irrigation_type === "drip" && (
                <>
                  <InputField label="Flow Rate (L/hr)" value={farmForm.flow_rate_liter_per_hour} onChange={setFarm("flow_rate_liter_per_hour")} icon={<Droplets size={14} />} type="number" readOnly={!editingFarm} />
                  <InputField label="Emitters Per Plant" value={farmForm.emitters_per_plant} onChange={setFarm("emitters_per_plant")} icon={<Droplets size={14} />} type="number" readOnly={!editingFarm} />
                </>
              )}

              {farmForm.irrigation_type === "flood" && (
                <>
                  <InputField label="Motor Horsepower" value={farmForm.motor_horsepower} onChange={setFarm("motor_horsepower")} icon={<Droplets size={14} />} type="number" readOnly={!editingFarm} />
                  <InputField label="Pipe Width (inches)" value={farmForm.pipe_width_inches} onChange={setFarm("pipe_width_inches")} icon={<Ruler size={14} />} type="number" readOnly={!editingFarm} />
                  <InputField label="Distance Motor to Plot (m)" value={farmForm.distance_motor_to_plot_m} onChange={setFarm("distance_motor_to_plot_m")} icon={<Ruler size={14} />} type="number" readOnly={!editingFarm} />
                </>
              )}

              {/* Sugarcane type select */}
              <SelectField
                label="Sugarcane Type"
                value={farmForm.sugarcane_type}
                options={["new", "old"]}
                onChange={setFarm("sugarcane_type")}
                readOnly={!editingFarm}
              />
              <InputField label="Sugarcane Yield (tonnes)" value={farmForm.sugarcane_yield} onChange={setFarm("sugarcane_yield")} icon={<Leaf size={14} />} type="number" readOnly={!editingFarm} />
              <InputField label="Plants in Field" value={farmForm.plants_in_field} onChange={setFarm("plants_in_field")} icon={<Leaf size={14} />} type="number" readOnly={!editingFarm} />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default MyProfile;
