import { useEffect, useMemo, useState } from "react";

export type AppLanguage = "en" | "hi" | "mr" | "kn";

const STORAGE_KEY = "app_language";
const LANGUAGE_CHANGED_EVENT = "app_language_changed";

const normalizeLanguage = (lng: string | null | undefined): AppLanguage => {
  const v = (lng || "").toLowerCase();
  if (v.startsWith("hi")) return "hi";
  if (v.startsWith("mr")) return "mr";
  if (v.startsWith("kn")) return "kn";
  return "en";
};

const initialLanguage = normalizeLanguage(
  typeof window !== "undefined"
    ? localStorage.getItem(STORAGE_KEY) || navigator.language
    : "en",
);

const translations: Record<AppLanguage, Record<string, string>> = {
  en: {
    "farmerDashboard.lineStyles.growth": "Growth Index",
    "farmerDashboard.lineStyles.stress": "Stress Index",
    "farmerDashboard.lineStyles.water": "Water Index",
    "farmerDashboard.lineStyles.moisture": "Moisture Index",

    "farmerDashboard.stressLevels.high": "High",
    "farmerDashboard.stressLevels.medium": "Medium",
    "farmerDashboard.stressLevels.low": "Low",

    "farmerDashboard.tooltip.ndreStressLevel": "NDRE Stress Level",
    "farmerDashboard.labels.average": "Average",

    "farmerDashboard.noPlotsFoundTitle": "No Plots Found",
    "farmerDashboard.noPlotsFoundDescription":
      "No farm plots are registered to your account. Please contact your field officer to register your farm plot.",

    "farmerDashboard.chartLegend.stress": "Stress",

    "farmerDashboard.biomassData.totalBiomass": "Total Biomass",
    "farmerDashboard.biomassData.undergroundBiomass": "Underground Biomass",

    "farmerDashboard.recoveryComparison.yourFarm": "Your Farm",
    "farmerDashboard.recoveryComparison.yourRecoveryRateLabel":
      "Your Recovery Rate",
    "farmerDashboard.recoveryComparison.regionalAverage": "Regional Average",
    "farmerDashboard.recoveryComparison.top25Percent": "Top 25%",
    "farmerDashboard.recoveryComparison.topQuartileLabel": "Top Quartile",
    "farmerDashboard.recoveryComparison.similarFarms": "Similar Farms",
    "farmerDashboard.recoveryComparison.similarFarmsLabel": "Similar Farms",

    "farmerDashboard.cards.fieldArea": "Field Area",
    "farmerDashboard.units.acre": "acre",
    "farmerDashboard.cards.cropStatus": "Crop Status",
    "farmerDashboard.cards.days": "Days",
    "farmerDashboard.cards.daysToHarvest": "Days to Harvest",
    "farmerDashboard.cards.sugarContent": "Sugar Content",
    "farmerDashboard.cards.cropConditionIndex": "Crop Condition Index",
    "farmerDashboard.labels.max": "Max",
    "farmerDashboard.labels.min": "Min",
    "farmerDashboard.cards.organicCarbonDensity": "Organic Carbon Density",
    "farmerDashboard.cards.stressEvents": "Stress Events",
    "farmerDashboard.cards.irrigationEvents": "Irrigation Events",
    "farmerDashboard.labels.events": "Events",
    "farmerDashboard.cards.totalBiomass": "Total Biomass",
    "farmerDashboard.cards.soilPHLevel": "Soil pH Level",
    "farmerDashboard.labels.ph": "pH",
    "farmerDashboard.cards.recoveryRate": "Recovery Rate",
    "farmerDashboard.labels.percent": "%",
    "farmerDashboard.units.tPerAcre": "T/acre",

    "farmerDashboard.charts.fieldIndicesAnalysis": "Field Indices Analysis",

    "farmerDashboard.cards.sugarcaneYieldProjection": "Sugarcane Yield Projection",
    "farmerDashboard.cards.sugarcaneYieldForecast": "Sugarcane Yield Forecast",
    "farmerDashboard.labels.minWithColon": "min:",
    "farmerDashboard.labels.meanWithColon": "mean:",
    "farmerDashboard.labels.maxWithColon": "max:",
    "farmerDashboard.labels.performance": "Performance:",
    "farmerDashboard.labels.optimalYieldPercentSuffix": "% of optimal yield",

    "farmerDashboard.charts.biomassPerformance": "Biomass Performance",
    "farmerDashboard.charts.biomassDistributionChart": "Biomass Distribution Chart",
    "farmerDashboard.biomassDistribution.total": "Total:",
    "farmerDashboard.biomassDistribution.underground": "Underground:",

    "farmerDashboard.charts.recoveryRateComparison": "Recovery Rate Comparison",
    "farmerDashboard.labels.yourFarm": "Your Farm:",
    "farmerDashboard.labels.regionalAvg": "Regional Avg:",
    "farmerDashboard.tooltip.recoveryRateLabel": "Recovery Rate",

    "farmerDashboard.labels.selectPlot": "Select Plot:",
    "farmerDashboard.chatbot.openChatbotAria": "Open Chatbot",
    "farmerDashboard.chatbot.openCropEyeAssistantTitle": "Open CropEye Assistant",
    "headerFarm.languageLabel": "Language",

    "headerFarm.loading": "Loading...",
    "headerFarm.failedToLoad": "Failed to load profile",
    "headerFarm.unknown": "Unknown",
    "headerFarm.totalPlotsLabel": "Total Plots:",
  },
  hi: {
    "farmerDashboard.lineStyles.growth": "विकास सूचकांक",
    "farmerDashboard.lineStyles.stress": "तनाव सूचकांक",
    "farmerDashboard.lineStyles.water": "जल सूचकांक",
    "farmerDashboard.lineStyles.moisture": "आर्द्रता सूचकांक",

    "farmerDashboard.stressLevels.high": "उच्च",
    "farmerDashboard.stressLevels.medium": "मध्यम",
    "farmerDashboard.stressLevels.low": "कम",

    "farmerDashboard.tooltip.ndreStressLevel": "NDRE तनाव स्तर",
    "farmerDashboard.labels.average": "औसत",

    "farmerDashboard.noPlotsFoundTitle": "कोई प्लॉट नहीं मिला",
    "farmerDashboard.noPlotsFoundDescription":
      "आपके खाते से कोई फार्म प्लॉट पंजीकृत नहीं है। कृपया अपने फील्ड ऑफिसर से संपर्क करें ताकि आपका फार्म प्लॉट पंजीकृत हो सके।",

    "farmerDashboard.chartLegend.stress": "तनाव",

    "farmerDashboard.biomassData.totalBiomass": "कुल बायोमास",
    "farmerDashboard.biomassData.undergroundBiomass": "भूमिगत बायोमास",

    "farmerDashboard.recoveryComparison.yourFarm": "आपका फार्म",
    "farmerDashboard.recoveryComparison.yourRecoveryRateLabel":
      "आपकी रिकवरी दर",
    "farmerDashboard.recoveryComparison.regionalAverage": "क्षेत्रीय औसत",
    "farmerDashboard.recoveryComparison.top25Percent": "शीर्ष 25%",
    "farmerDashboard.recoveryComparison.topQuartileLabel": "शीर्ष चतुर्थक",
    "farmerDashboard.recoveryComparison.similarFarms": "समान फार्म",
    "farmerDashboard.recoveryComparison.similarFarmsLabel": "समान फार्म",

    "farmerDashboard.cards.fieldArea": "खेत का क्षेत्रफल",
    "farmerDashboard.units.acre": "एकड़",
    "farmerDashboard.cards.cropStatus": "फसल की स्थिति",
    "farmerDashboard.cards.days": "दिन",
    "farmerDashboard.cards.daysToHarvest": "कटाई तक के दिन",
    "farmerDashboard.cards.sugarContent": "शुगर सामग्री",
    "farmerDashboard.labels.max": "अधिकतम",
    "farmerDashboard.labels.min": "न्यूनतम",
    "farmerDashboard.cards.organicCarbonDensity": "जैविक कार्बन घनत्व",
    "farmerDashboard.cards.stressEvents": "तनाव की घटनाएं",
    "farmerDashboard.cards.irrigationEvents": "सिंचाई की घटनाएं",
    "farmerDashboard.labels.events": "घटनाएं",
    "farmerDashboard.cards.totalBiomass": "कुल बायोमास",
    "farmerDashboard.cards.soilPHLevel": "मिट्टी का pH स्तर",
    "farmerDashboard.labels.ph": "pH",
    "farmerDashboard.cards.recoveryRate": "रिकवरी दर",
    "farmerDashboard.labels.percent": "%",
    "farmerDashboard.units.tPerAcre": "टी/एकड़",

    "farmerDashboard.charts.fieldIndicesAnalysis": "खेत इंडेक्स विश्लेषण",

    "farmerDashboard.cards.sugarcaneYieldProjection": "गन्ने की उपज अनुमान",
    "farmerDashboard.cards.sugarcaneYieldForecast": "गन्ने की उपज पूर्वानुमान",
    "farmerDashboard.labels.minWithColon": "न्यूनतम:",
    "farmerDashboard.labels.meanWithColon": "औसत:",
    "farmerDashboard.labels.maxWithColon": "अधिकतम:",
    "farmerDashboard.labels.performance": "प्रदर्शन:",
    "farmerDashboard.labels.optimalYieldPercentSuffix": "% सर्वोत्तम उपज का",

    "farmerDashboard.charts.biomassPerformance": "बायोमास प्रदर्शन",
    "farmerDashboard.charts.biomassDistributionChart": "बायोमास वितरण चार्ट",
    "farmerDashboard.biomassDistribution.total": "कुल:",
    "farmerDashboard.biomassDistribution.underground": "भूमिगत:",

    "farmerDashboard.charts.recoveryRateComparison": "रिकवरी दर तुलना",
    "farmerDashboard.labels.yourFarm": "आपका फार्म:",
    "farmerDashboard.labels.regionalAvg": "क्षेत्रीय औसत:",
    "farmerDashboard.tooltip.recoveryRateLabel": "रिकवरी दर",

    "farmerDashboard.labels.selectPlot": "प्लॉट चुनें:",
    "farmerDashboard.chatbot.openChatbotAria": "चैटबॉट खोलें",
    "farmerDashboard.chatbot.openCropEyeAssistantTitle": "CropEye Assistant खोलें",
    "headerFarm.languageLabel": "भाषा",

    "headerFarm.loading": "लोड हो रहा है...",
    "headerFarm.failedToLoad": "प्रोफ़ाइल लोड नहीं हो पाई",
    "headerFarm.unknown": "अज्ञात",
    "headerFarm.totalPlotsLabel": "कुल प्लॉट्स:",
  },
  mr: {
    "farmerDashboard.lineStyles.growth": "वाढ सूचकांक",
    "farmerDashboard.lineStyles.stress": "ताण सूचकांक",
    "farmerDashboard.lineStyles.water": "पाणी सूचकांक",
    "farmerDashboard.lineStyles.moisture": "आर्द्रता सूचकांक",

    "farmerDashboard.stressLevels.high": "उच्च",
    "farmerDashboard.stressLevels.medium": "मध्यम",
    "farmerDashboard.stressLevels.low": "कमी",

    "farmerDashboard.tooltip.ndreStressLevel": "NDRE ताण स्तर",
    "farmerDashboard.labels.average": "सरासरी",

    "farmerDashboard.noPlotsFoundTitle": "प्लॉट सापडले नाहीत",
    "farmerDashboard.noPlotsFoundDescription":
      "तुमच्या खात्यावर कोणतेही शेती प्लॉट नोंदणीकृत नाहीत. कृपया तुमच्या फील्ड ऑफिसरशी संपर्क करा आणि तुमचा प्लॉट नोंदवा.",

    "farmerDashboard.chartLegend.stress": "ताण",

    "farmerDashboard.biomassData.totalBiomass": "एकूण बायोमास",
    "farmerDashboard.biomassData.undergroundBiomass": "भूमिगत बायोमास",

    "farmerDashboard.recoveryComparison.yourFarm": "तुमचा फार्म",
    "farmerDashboard.recoveryComparison.yourRecoveryRateLabel":
      "तुमची रिकव्हरी रेट",
    "farmerDashboard.recoveryComparison.regionalAverage": "प्रादेशिक सरासरी",
    "farmerDashboard.recoveryComparison.top25Percent": "टॉप 25%",
    "farmerDashboard.recoveryComparison.topQuartileLabel": "टॉप चतुर्थांश",
    "farmerDashboard.recoveryComparison.similarFarms": "समान फार्म",
    "farmerDashboard.recoveryComparison.similarFarmsLabel": "समान फार्म",

    "farmerDashboard.cards.fieldArea": "शेताचे क्षेत्रफळ",
    "farmerDashboard.units.acre": "एकर",
    "farmerDashboard.cards.cropStatus": "पिकाची स्थिती",
    "farmerDashboard.cards.days": "दिवस",
    "farmerDashboard.cards.daysToHarvest": "कापणीपर्यंत दिवस",
    "farmerDashboard.cards.sugarContent": "साखर प्रमाण",
    "farmerDashboard.labels.max": "कमाल",
    "farmerDashboard.labels.min": "किमान",
    "farmerDashboard.cards.organicCarbonDensity": "सेंद्रिय कार्बन घनता",
    "farmerDashboard.cards.stressEvents": "ताण घटना",
    "farmerDashboard.cards.irrigationEvents": "सिंचन घटना",
    "farmerDashboard.labels.events": "घटना",
    "farmerDashboard.cards.totalBiomass": "एकूण बायोमास",
    "farmerDashboard.cards.soilPHLevel": "मातीचा pH स्तर",
    "farmerDashboard.labels.ph": "pH",
    "farmerDashboard.cards.recoveryRate": "रिकव्हरी रेट",
    "farmerDashboard.labels.percent": "%",
    "farmerDashboard.units.tPerAcre": "टी/एकर",

    "farmerDashboard.charts.fieldIndicesAnalysis": "शेत निर्देशांक विश्लेषण",

    "farmerDashboard.cards.sugarcaneYieldProjection": "ऊस उत्पन्न अंदाज",
    "farmerDashboard.cards.sugarcaneYieldForecast": "ऊस उत्पन्न पूर्वानुमान",
    "farmerDashboard.labels.minWithColon": "किमान:",
    "farmerDashboard.labels.meanWithColon": "सरासरी:",
    "farmerDashboard.labels.maxWithColon": "कमाल:",
    "farmerDashboard.labels.performance": "कामगिरी:",
    "farmerDashboard.labels.optimalYieldPercentSuffix": "% सर्वोत्तम उत्पन्नाचे",

    "farmerDashboard.charts.biomassPerformance": "बायोमास कामगिरी",
    "farmerDashboard.charts.biomassDistributionChart": "बायोमास वितरण चार्ट",
    "farmerDashboard.biomassDistribution.total": "एकूण:",
    "farmerDashboard.biomassDistribution.underground": "भूमिगत:",

    "farmerDashboard.charts.recoveryRateComparison": "रिकव्हरी रेट तुलना",
    "farmerDashboard.labels.yourFarm": "तुमचा फार्म:",
    "farmerDashboard.labels.regionalAvg": "प्रादेशिक सरासरी:",
    "farmerDashboard.tooltip.recoveryRateLabel": "रिकव्हरी रेट",

    "farmerDashboard.labels.selectPlot": "प्लॉट निवडा:",
    "farmerDashboard.chatbot.openChatbotAria": "चॅटबॉट उघडा",
    "farmerDashboard.chatbot.openCropEyeAssistantTitle": "CropEye Assistant उघडा",
    "headerFarm.languageLabel": "भाषा",

    "headerFarm.loading": "लोड होत आहे...",
    "headerFarm.failedToLoad": "प्रोफाइल लोड करण्यात अयशस्वी",
    "headerFarm.unknown": "अज्ञात",
    "headerFarm.totalPlotsLabel": "एकूण प्लॉट्स:",
  },
  kn: {
    "farmerDashboard.lineStyles.growth": "ಬೆಳೆ ಬೆಳವಣಿಗೆ ಸೂಚ್ಯಂಕ",
    "farmerDashboard.lineStyles.stress": "ಒತ್ತಡ ಸೂಚ್ಯಂಕ",
    "farmerDashboard.lineStyles.water": "ನೀರಿನ ಸೂಚ್ಯಂಕ",
    "farmerDashboard.lineStyles.moisture": "ತೇವಾಂಶ ಸೂಚ್ಯಂಕ",

    "farmerDashboard.stressLevels.high": "ಉನ್ನತ",
    "farmerDashboard.stressLevels.medium": "ಮಧ್ಯಮ",
    "farmerDashboard.stressLevels.low": "ಕಡಿಮೆ",

    "farmerDashboard.tooltip.ndreStressLevel": "NDRE ಒತ್ತಡ ಮಟ್ಟ",
    "farmerDashboard.labels.average": "ಸರಾಸರಿ",

    "farmerDashboard.noPlotsFoundTitle": "ಪ್ಲಾಟ್ಗಳು ಕಂಡುಬರಲಿಲ್ಲ",
    "farmerDashboard.noPlotsFoundDescription":
      "ನಿಮ್ಮ ಖಾತೆಗೆ ಯಾವುದೇ ಫಾರ್ಮ್ ಪ್ಲಾಟ್ ನೋಂದಾಯಿಸಲ್ಪಟ್ಟಿಲ್ಲ. ನಿಮ್ಮ ಫಾರ್ಮ್ ಪ್ಲಾಟ್ ಅನ್ನು ನೋಂದಾಯಿಸಲು ದಯವಿಟ್ಟು ನಿಮ್ಮ ಫೀಲ್ಡ್ ಆಫೀಸರ್ ಜೊತೆ ಸಂಪರ್ಕಿಸಿ.",

    "farmerDashboard.chartLegend.stress": "ಒತ್ತಡ",

    "farmerDashboard.biomassData.totalBiomass": "ಒಟ್ಟು ಬಯೋಮಾಸ್",
    "farmerDashboard.biomassData.undergroundBiomass": "ಭೂಗತ ಬಯೋಮಾಸ್",

    "farmerDashboard.recoveryComparison.yourFarm": "ನಿಮ್ಮ ಫಾರ್ಮ್",
    "farmerDashboard.recoveryComparison.yourRecoveryRateLabel": "ನಿಮ್ಮ ರಿಕವರಿ ದರ",
    "farmerDashboard.recoveryComparison.regionalAverage": "ಪ್ರಾದೇಶಿಕ ಸರಾಸರಿ",
    "farmerDashboard.recoveryComparison.top25Percent": "ಅತ್ಯುತ್ತಮ 25%",
    "farmerDashboard.recoveryComparison.topQuartileLabel": "ಅತ್ಯುತ್ತಮ ಚತುರ್ಥಾಂಶ",
    "farmerDashboard.recoveryComparison.similarFarms": "ಸಮಾನ ಫಾರ್ಮ್‌ಗಳು",
    "farmerDashboard.recoveryComparison.similarFarmsLabel": "ಸಮಾನ ಫಾರ್ಮ್‌ಗಳು",

    "farmerDashboard.cards.fieldArea": "ಗದ್ದೆಯ ವಿಸ್ತೀರ್ಣ",
    "farmerDashboard.units.acre": "ಎಕರೆ",
    "farmerDashboard.cards.cropStatus": "ಬೆಳೆ ಸ್ಥಿತಿ",
    "farmerDashboard.cards.days": "ದಿನಗಳು",
    "farmerDashboard.cards.daysToHarvest": "ಕೊಯ್ಲಿಗೆ ದಿನಗಳು",
    "farmerDashboard.cards.sugarContent": "ಸಕ್ಕರೆ ಪ್ರಮಾಣ",
    "farmerDashboard.labels.max": "ಗರಿಷ್ಠ",
    "farmerDashboard.labels.min": "ಕನಿಷ್ಠ",
    "farmerDashboard.cards.organicCarbonDensity": "ಸಾವಯವ ಕಾರ್ಬನ್ ಸಾಂದ್ರತೆ",
    "farmerDashboard.cards.stressEvents": "ಒತ್ತಡ ಘಟನೆಗಳು",
    "farmerDashboard.cards.irrigationEvents": "ನೀರಾವರಿ ಘಟನೆಗಳು",
    "farmerDashboard.labels.events": "ಘಟನೆಗಳು",
    "farmerDashboard.cards.totalBiomass": "ಒಟ್ಟು ಬಯೋಮಾಸ್",
    "farmerDashboard.cards.soilPHLevel": "ಮಣ್ಣಿನ pH ಮಟ್ಟ",
    "farmerDashboard.labels.ph": "pH",
    "farmerDashboard.cards.recoveryRate": "ರಿಕವರಿ ದರ",
    "farmerDashboard.labels.percent": "%",
    "farmerDashboard.units.tPerAcre": "ಟಿ/ಎಕರೆ",

    "farmerDashboard.charts.fieldIndicesAnalysis": "ಗದ್ದೆ ಸೂಚ್ಯಂಕ ವಿಶ್ಲೇಷಣೆ",

    "farmerDashboard.cards.sugarcaneYieldProjection": "ಕಬ್ಬಿನ ಇಳುವರಿ ಪ್ರಕ್ಷೇಪಣೆ",
    "farmerDashboard.cards.sugarcaneYieldForecast": "ಕಬ್ಬಿನ ಇಳುವರಿ ಮುನ್ಸೂಚನೆ",
    "farmerDashboard.labels.minWithColon": "ಕನಿಷ್ಠ:",
    "farmerDashboard.labels.meanWithColon": "ಸರಾಸರಿ:",
    "farmerDashboard.labels.maxWithColon": "ಗರಿಷ್ಠ:",
    "farmerDashboard.labels.performance": "ಕಾರ್ಯಕ್ಷಮತೆ:",
    "farmerDashboard.labels.optimalYieldPercentSuffix": "% ಅತ್ಯುತ್ತಮ ಇಳುವರಿ",

    "farmerDashboard.charts.biomassPerformance": "ಬಯೋಮಾಸ್ ಕಾರ್ಯಕ್ಷಮತೆ",
    "farmerDashboard.charts.biomassDistributionChart": "ಬಯೋಮಾಸ್ ವಿತರಣಾ ಚಾರ್ಟ್",
    "farmerDashboard.biomassDistribution.total": "ಒಟ್ಟು:",
    "farmerDashboard.biomassDistribution.underground": "ಭೂಗತ:",

    "farmerDashboard.charts.recoveryRateComparison": "ರಿಕವರಿ ದರ ಹೋಲಿಕೆ",
    "farmerDashboard.labels.yourFarm": "ನಿಮ್ಮ ಫಾರ್ಮ್:",
    "farmerDashboard.labels.regionalAvg": "ಪ್ರಾದೇಶಿಕ ಸರಾಸರಿ:",
    "farmerDashboard.tooltip.recoveryRateLabel": "ರಿಕವರಿ ದರ",

    "farmerDashboard.labels.selectPlot": "ಪ್ಲಾಟ್ ಆಯ್ಕೆಮಾಡಿ:",
    "farmerDashboard.chatbot.openChatbotAria": "ಚಾಟ್‌ಬಾಟ್ ತೆರೆಯಿರಿ",
    "farmerDashboard.chatbot.openCropEyeAssistantTitle": "CropEye Assistant ತೆರೆಯಿರಿ",
    "headerFarm.languageLabel": "ಭಾಷೆ",

    "headerFarm.loading": "ಲೋಡ್ ಆಗುತ್ತಿದೆ...",
    "headerFarm.failedToLoad": "ಪ್ರೊಫೈಲ್ ಲೋಡ್ ಆಗಲಿಲ್ಲ",
    "headerFarm.unknown": "ಅಜ್ಞಾತ",
    "headerFarm.totalPlotsLabel": "ಒಟ್ಟು ಪ್ಲಾಟ್ಗಳು:",
  },
};

export const useI18nLite = () => {
  const [lang, setLang] = useState<AppLanguage>(initialLanguage);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setLang(normalizeLanguage(e.newValue));
    };

    const onCustomChanged = () => {
      setLang(normalizeLanguage(localStorage.getItem(STORAGE_KEY)));
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(LANGUAGE_CHANGED_EVENT, onCustomChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(LANGUAGE_CHANGED_EVENT, onCustomChanged);
    };
  }, []);

  const t = useMemo(() => {
    return (key: string, opts?: { defaultValue?: string }) => {
      const direct = translations[lang]?.[key];
      if (direct) return direct;
      const fallback = translations.en?.[key];
      if (fallback) return fallback;
      return opts?.defaultValue ?? key;
    };
  }, [lang]);

  const setLanguage = (next: AppLanguage) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLang(next);
    window.dispatchEvent(new Event(LANGUAGE_CHANGED_EVENT));
  };

  return { lang, setLanguage, t };
};

