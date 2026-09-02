import React, { useEffect } from "react";
import "./App.css";
import { useAppContext } from "../context/AppContext";
import FertilizerTable from "./FertilizerTable";
import FertilizerNpkCards from "./FertilizerNpkCards";
import { useFarmerProfile } from "../hooks/useFarmerProfile";
import { useI18nLite, type AppLanguage } from "../i18nLite";

interface FertilizerEntry {
  day: number;
  stage: string;
  nutrients: string;
  recommendedDosage: string;
  chemical: string;
}

interface VideoResource {
  title: string;
  url: string;
  desc: string;
}

const marathiVideoList: VideoResource[] = [
  {
    title: "उस शेतीची ओळख आणि महाराष्ट्राचे हवामान",
    url: "https://www.youtube.com/embed/qzFbZvDin4U?si=y8NwUZfi7wWBWfWV",
    desc: "या व्हिडिओमध्ये ऊस शेतीसाठी आवश्यक हवामान, पाऊस, माती आणि सिंचन याबद्दल माहिती दिली आहे. महाराष्ट्रातील ऊस उत्पादक भाग, पिकाचा कालावधी आणि योग्य व्यवस्थापनाचे महत्त्व जाणून घ्या. ",
  },
  {
    title: "जमीन तयारी आणि मृदा आरोग्य",
    url: "https://www.youtube.com/embed/vLOJbcQECfk?si=ChfTCkHbYjyNdWrT",
    desc: "या भागात आपण मातीची मशागत आणि मातीचे आरोग्य या महत्त्वाच्या टप्प्याबद्दल जाणून घेऊ. चांगली माती ही ऊस पिकाच्या उत्तम उगवणीसाठी, मजबूत मुळे तयार होण्यासाठी आणि जास्त उत्पादनासाठी आवश्यक आहे.",
  },
  {
    title: "ऊस शेतीत योग्य जातीची निवड",
    url: "https://www.youtube.com/embed/Si0hh9xFHvI?si=Y582InMZoil2dccv",
    desc: "ऊस शेतीत योग्य जातीची निवड ही यशस्वी शेतीचा पाया आहे. महाराष्ट्र, उत्तर प्रदेश आणि कर्नाटकात कोणत्या जाती सर्वाधिक लोकप्रिय आहेत, त्यांच्या वैशिष्ट्यांसह जाणून घ्या.",
  },
];

const kannadaVideoList: VideoResource[] = [
  {
    title: "Kannada Sugarcane Video 1",
    url: "https://www.youtube.com/embed/RiXYq-0meA0",
    desc: "ಕನ್ನಡದಲ್ಲಿ ಉಸ್ಸು ಬೆಳೆಯುವಿಕೆ, ಹವಾಮಾನ ಮತ್ತು ಶೇತಕೀಯ ನಿರ್ವಹಣೆ ಕುರಿತ ಮಾಹಿತಿ — ಭಾಗ ೧.",
  },
  {
    title: "Kannada Sugarcane Video 2",
    url: "https://www.youtube.com/embed/mX-h9qpQ3yM",
    desc: "ಕನ್ನಡದಲ್ಲಿ ಉಸ್ಸು ಬೆಳೆಯುವಿಕೆ, ನೆಲ ಸಿದ್ಧತೆ ಮತ್ತು ಮಣ್ಣಿನ ಆರೋಗ್ಯ ಕುರಿತ ಮಾಹಿತಿ — ಭಾಗ ೨.",
  },
  {
    title: "Kannada Sugarcane Video 3",
    url: "https://www.youtube.com/embed/oBwjJarRRwk",
    desc: "ಕನ್ನಡದಲ್ಲಿ ಉಸ್ಸು ಬೆಳೆಯುವಿಕೆ, ತಳಿ ಆಯ್ಕೆ ಮತ್ತು ಉತ್ತಮ ಉತ್ಪಾದನೆ ಕುರಿತ ಮಾಹಿತಿ — ಭಾಗ ೩.",
  },
];

const readGoogTransLanguage = (): AppLanguage | null => {
  if (typeof document === "undefined") return null;

  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.toLowerCase().startsWith("googtrans=")) continue;

    const raw = trimmed.slice("googtrans=".length).trim();
    const decoded = (() => {
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    })();

    const match = decoded.match(/^\/[^/]+\/([^/]+)$/);
    const code = match?.[1]?.trim();
    if (code === "kn" || code === "hi" || code === "mr" || code === "en") {
      return code;
    }
  }

  return null;
};

const Fertilizer: React.FC = () => {
  const { profile, loading: profileLoading } = useFarmerProfile();
  const { lang } = useI18nLite();
  const { selectedPlotName, setSelectedPlotName } = useAppContext();
  const activeLang = readGoogTransLanguage() ?? lang;
  const videoList = activeLang === "kn" ? kannadaVideoList : marathiVideoList;
  // Use global selectedPlotName, fallback to first plot if not available
  const PLOT_NAME = selectedPlotName || (profile?.plots && profile.plots.length > 0 ? profile.plots[0].fastapi_plot_id : "");

  const { setAppState, getCached, setCached } = useAppContext();

  useEffect(() => {
    const cacheKey = "fertilizerData";
    const cached = getCached(cacheKey);

    if (cached) {
      setAppState((prev: any) => ({ ...prev, fertilizerData: cached }));
      return;
    }

    fetch("/fertilizer.json")
      .then((res) => res.json())
      .then((json) => {
        const entries: FertilizerEntry[] = json
          .map((entry: any) => ({
            day: Number(entry["Duration (Days)"]),
            stage: entry["Stage"] || "",
            nutrients: entry["Nutrients "] || "",
            recommendedDosage: entry["Recommended Dosage "] || "",
            chemical: entry["Chemical "] || "",
          }))
          .filter((e: any) => e.day >= 8 && e.day <= 14);

        setAppState((prev: any) => ({ ...prev, fertilizerData: entries }));
        setCached(cacheKey, entries);
      })
      .catch(() => { });
  }, [getCached, setCached, setAppState]);

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-gray-100 pb-12">
        <div className="container mx-auto px-4 pt-6">
          <div className="flex justify-center items-center h-64">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-700 mb-4">
                Loading Fertilizer Data...
              </div>
              <div className="text-gray-600">Loading farmer profile...</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!PLOT_NAME) {
    return (
      <div className="min-h-screen bg-gray-100 pb-12">
        <div className="container mx-auto px-4 pt-6">
          <div className="flex justify-center items-center h-64">
            <div className="text-center">
              <div className="text-2xl font-bold text-red-700 mb-4">
                ⚠ No Plot Data Available
              </div>
              <div className="text-gray-600">
                Please ensure you have plot data in your profile.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-12">
      <div className="container mx-auto px-4 pt-6">
        {/* Plot Selector */}
        {profile && !profileLoading && (
          <div className="bg-white shadow-lg rounded-lg px-6 py-4 mb-4 border-l-4 border-blue-500">
            <div className="flex items-center gap-4 flex-wrap">
              <label className="font-semibold text-gray-700">Select Plot:</label>
              <select
                value={selectedPlotName || ""}
                onChange={(e) => {
                  setSelectedPlotName(e.target.value);
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {profile.plots?.map(plot => {
                  let displayName = '';

                  if (plot.gat_number && plot.plot_number &&
                    plot.gat_number.trim() !== "" && plot.plot_number.trim() !== "" &&
                    !plot.gat_number.startsWith('GAT_') && !plot.plot_number.startsWith('PLOT_')) {
                    displayName = `${plot.gat_number}_${plot.plot_number}`;
                  } else if (plot.gat_number && plot.gat_number.trim() !== "" && !plot.gat_number.startsWith('GAT_')) {
                    displayName = plot.gat_number;
                  } else if (plot.plot_number && plot.plot_number.trim() !== "" && !plot.plot_number.startsWith('PLOT_')) {
                    displayName = plot.plot_number;
                  } else {
                    const village = plot.address?.village;
                    const taluka = plot.address?.taluka;

                    if (village) {
                      displayName = `Plot in ${village}`;
                      if (taluka) displayName += `, ${taluka}`;
                    } else {
                      displayName = 'Plot (No GAT/Plot Number)';
                    }
                  }

                  return (
                    <option key={plot.fastapi_plot_id} value={plot.fastapi_plot_id}>
                      {displayName}
                    </option>
                  );
                }) || []}
              </select>
            </div>
          </div>
        )}

        <div className="flex items-center bg-white rounded-lg px-4 py-3 mb-4 border-l-4 border-green-500 shadow-sm">
          <div className="text-xl sm:text-2xl font-bold text-green-700 flex items-center">
            <span className="mr-3 text-2xl sm:text-3xl">🌱</span>
            NPK UPDATE
          </div>
        </div>

        <FertilizerNpkCards
          profile={profile}
          profileLoading={profileLoading}
          compact
        />

        <FertilizerTable />

        {/* Videos */}
        <div className="mt-12">
          <h2 className="text-2xl font-bold text-green-700 mb-4">
            Video Resources
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {videoList.map((video, index) => (
              <div key={`${activeLang}-${index}`} className="bg-white shadow-lg rounded-lg">
                <div className="relative pb-60 overflow-hidden">
                  <iframe
                    src={video.url}
                    title={video.title}
                    className="absolute top-0 left-0 w-full h-full"
                    frameBorder="0"
                    allowFullScreen
                  />
                </div>
                <div className="p-4">
                  <h3 className="text-xl font-semibold text-gray-800">
                    {video.title}
                  </h3>
                  <p className="text-gray-600">{video.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Fertilizer;