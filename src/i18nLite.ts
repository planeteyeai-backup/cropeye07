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

    "plotBoundary.sectionTitle": "Plot boundary (KML)",
    "plotBoundary.boundarySaved": "Boundary saved — open the map to adjust corners.",
    "plotBoundary.noBoundary": "No boundary yet — draw your plot on the map.",
    "plotBoundary.plotIdMissing": "Plot ID not found in profile. Please contact support.",
    "plotBoundary.editButton": "Edit Plot Boundary",
    "plotBoundary.title": "Plot Boundary",
    "plotBoundary.plotPrefix": "Plot",
    "plotBoundary.subtitleDefault": "View or edit your farm boundary",
    "plotBoundary.close": "Close",
    "plotBoundary.howToEdit": "How to edit:",
    "plotBoundary.howToEditBody":
      "Click the square edit tool (top-right), drag corners to resize, then click Save Boundary below. Use Delete / Clear to remove the shape and draw a new one (server requires a replacement boundary — empty is not allowed).",
    "plotBoundary.drawStep1": "Optionally tap Use My Current Location to center the map on you.",
    "plotBoundary.drawStep2": "Click the pentagon icon on the top-right of the map.",
    "plotBoundary.drawStep3": "Click each corner of your plot on the satellite image.",
    "plotBoundary.drawStep4": "Click the first point again (or double-click) to close the shape.",
    "plotBoundary.drawStep5": "Check the calculated area, then click Save Boundary.",
    "plotBoundary.viewingHint":
      "Viewing plot boundary. Tap Edit Plot to make changes, or Delete to clear and redraw.",
    "plotBoundary.viewingOverlay": "Viewing plot boundary. Tap 'Edit Plot' to make changes.",
    "plotBoundary.plotCenter": "Plot center (lat / long)",
    "plotBoundary.coordsHintEdit":
      "Enter coordinates to move the map. Tap the map tools to draw or re-draw the boundary.",
    "plotBoundary.coordsHintView":
      "Enter coordinates to move the map. Tap Edit Plot to draw or re-draw the boundary.",
    "plotBoundary.latitude": "Latitude",
    "plotBoundary.longitude": "Longitude",
    "plotBoundary.goToLocation": "Go to location",
    "plotBoundary.gettingLocation": "Getting your location…",
    "plotBoundary.useMyLocation": "Use My Current Location",
    "plotBoundary.noShapeYet":
      "No shape on the map yet. Use the pentagon tool (top-right) to draw your plot.",
    "plotBoundary.calculatedArea": "Calculated area:",
    "plotBoundary.acres": "acres",
    "plotBoundary.deleteBoundary": "Delete Boundary",
    "plotBoundary.clearToRedraw": "Clear to redraw",
    "plotBoundary.cancel": "Cancel",
    "plotBoundary.editPlot": "Edit Plot",
    "plotBoundary.saveBoundary": "Save Boundary",
    "plotBoundary.areaError": "Could not calculate area for this shape. Please redraw.",
    "plotBoundary.clearConfirm":
      "Clear this boundary from the map so you can draw a new one?\n\nAfter drawing, click Save Boundary. The server does not allow removing a boundary without replacing it.",
    "plotBoundary.invalidLatLng": "Enter valid latitude and longitude.",
    "plotBoundary.latLngRange": "Latitude must be -90 to 90 and longitude -180 to 180.",
    "plotBoundary.geoUnsupported": "Geolocation is not supported by this browser.",
    "plotBoundary.geoDenied":
      "Location permission denied. Allow location access in browser settings, then try again.",
    "plotBoundary.geoFailed":
      "Unable to get your current location. Enter coordinates manually or try again.",
    "plotBoundary.permissionDenied":
      "You do not have permission to update this plot boundary. Please contact your field officer or support.",
    "plotBoundary.cannotDelete":
      "The server does not allow deleting a plot boundary. Clear the map, draw a new shape, then click Save Boundary.",
    "plotBoundary.saveFailed": "Failed to save plot boundary.",
    "plotBoundary.drawFirst":
      "Please draw the plot boundary on the map first, then click Save Boundary.",
    "plotBoundary.minCorners": "A plot boundary needs at least 3 corner points.",
    "plotBoundary.locationMissing":
      "Could not resolve plot location. Enter lat/long or redraw the boundary.",
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

    "plotBoundary.sectionTitle": "प्लॉट बाउंड्री (KML)",
    "plotBoundary.boundarySaved": "बाउंड्री सेव है — कोने बदलने के लिए मैप खोलें।",
    "plotBoundary.noBoundary": "अभी बाउंड्री नहीं है — मैप पर अपना प्लॉट बनाएँ।",
    "plotBoundary.plotIdMissing": "प्रोफ़ाइल में प्लॉट आईडी नहीं मिली। कृपया सहायता से संपर्क करें।",
    "plotBoundary.editButton": "प्लॉट बाउंड्री संपादित करें",
    "plotBoundary.title": "प्लॉट बाउंड्री",
    "plotBoundary.plotPrefix": "प्लॉट",
    "plotBoundary.subtitleDefault": "अपनी फार्म बाउंड्री देखें या संपादित करें",
    "plotBoundary.close": "बंद करें",
    "plotBoundary.howToEdit": "संपादन कैसे करें:",
    "plotBoundary.howToEditBody":
      "ऊपर-दाएँ वर्ग संपादन टूल पर क्लिक करें, कोने खींचकर आकार बदलें, फिर नीचे बाउंड्री सहेजें पर क्लिक करें। आकार हटाने और नया बनाने के लिए हटाएँ / साफ़ करें का उपयोग करें (सर्वर को नई बाउंड्री चाहिए — खाली नहीं छोड़ सकते)।",
    "plotBoundary.drawStep1": "मैप को अपने स्थान पर लाने के लिए वैकल्पिक रूप से मेरा वर्तमान स्थान उपयोग करें टैप करें।",
    "plotBoundary.drawStep2": "मैप के ऊपर-दाएँ पेंटागन आइकन पर क्लिक करें।",
    "plotBoundary.drawStep3": "सैटेलाइट चित्र पर अपने प्लॉट के प्रत्येक कोने पर क्लिक करें।",
    "plotBoundary.drawStep4": "आकार बंद करने के लिए पहले बिंदु पर फिर क्लिक करें (या डबल-क्लिक करें)।",
    "plotBoundary.drawStep5": "गणना किया गया क्षेत्रफल जाँचें, फिर बाउंड्री सहेजें पर क्लिक करें।",
    "plotBoundary.viewingHint":
      "प्लॉट बाउंड्री देख रहे हैं। बदलाव के लिए प्लॉट संपादित करें टैप करें, या साफ़ करके फिर बनाने के लिए हटाएँ।",
    "plotBoundary.viewingOverlay": "प्लॉट बाउंड्री देख रहे हैं। बदलाव के लिए 'प्लॉट संपादित करें' टैप करें।",
    "plotBoundary.plotCenter": "प्लॉट केंद्र (अक्षांश / देशांतर)",
    "plotBoundary.coordsHintEdit":
      "मैप हिलाने के लिए निर्देशांक दर्ज करें। बाउंड्री बनाने या फिर बनाने के लिए मैप टूल टैप करें।",
    "plotBoundary.coordsHintView":
      "मैप हिलाने के लिए निर्देशांक दर्ज करें। बाउंड्री बनाने या फिर बनाने के लिए प्लॉट संपादित करें टैप करें।",
    "plotBoundary.latitude": "अक्षांश",
    "plotBoundary.longitude": "देशांतर",
    "plotBoundary.goToLocation": "स्थान पर जाएँ",
    "plotBoundary.gettingLocation": "आपका स्थान लिया जा रहा है…",
    "plotBoundary.useMyLocation": "मेरा वर्तमान स्थान उपयोग करें",
    "plotBoundary.noShapeYet":
      "मैप पर अभी कोई आकार नहीं है। प्लॉट बनाने के लिए ऊपर-दाएँ पेंटागन टूल का उपयोग करें।",
    "plotBoundary.calculatedArea": "गणना किया गया क्षेत्रफल:",
    "plotBoundary.acres": "एकड़",
    "plotBoundary.deleteBoundary": "बाउंड्री हटाएँ",
    "plotBoundary.clearToRedraw": "फिर बनाने के लिए साफ़ करें",
    "plotBoundary.cancel": "रद्द करें",
    "plotBoundary.editPlot": "प्लॉट संपादित करें",
    "plotBoundary.saveBoundary": "बाउंड्री सहेजें",
    "plotBoundary.areaError": "इस आकार का क्षेत्रफल नहीं निकाला जा सका। कृपया फिर बनाएँ।",
    "plotBoundary.clearConfirm":
      "नई बाउंड्री बनाने के लिए इस बाउंड्री को मैप से साफ़ करें?\n\nबनाने के बाद बाउंड्री सहेजें पर क्लिक करें। सर्वर बिना नई बाउंड्री के हटाने की अनुमति नहीं देता।",
    "plotBoundary.invalidLatLng": "मान्य अक्षांश और देशांतर दर्ज करें।",
    "plotBoundary.latLngRange": "अक्षांश -90 से 90 और देशांतर -180 से 180 होना चाहिए।",
    "plotBoundary.geoUnsupported": "यह ब्राउज़र जियोलोकेशन सपोर्ट नहीं करता।",
    "plotBoundary.geoDenied":
      "स्थान अनुमति अस्वीकृत। ब्राउज़र सेटिंग में स्थान एक्सेस दें, फिर फिर कोशिश करें।",
    "plotBoundary.geoFailed":
      "वर्तमान स्थान नहीं मिला। निर्देशांक खुद दर्ज करें या फिर कोशिश करें।",
    "plotBoundary.permissionDenied":
      "इस प्लॉट बाउंड्री को अपडेट करने की अनुमति नहीं है। कृपया फील्ड ऑफिसर या सहायता से संपर्क करें।",
    "plotBoundary.cannotDelete":
      "सर्वर प्लॉट बाउंड्री हटाने की अनुमति नहीं देता। मैप साफ़ करें, नया आकार बनाएँ, फिर बाउंड्री सहेजें पर क्लिक करें।",
    "plotBoundary.saveFailed": "प्लॉट बाउंड्री सेव नहीं हो सकी।",
    "plotBoundary.drawFirst":
      "पहले मैप पर प्लॉट बाउंड्री बनाएँ, फिर बाउंड्री सहेजें पर क्लिक करें।",
    "plotBoundary.minCorners": "प्लॉट बाउंड्री में कम से कम 3 कोने होने चाहिए।",
    "plotBoundary.locationMissing":
      "प्लॉट स्थान नहीं मिला। अक्षांश/देशांतर दर्ज करें या बाउंड्री फिर बनाएँ।",
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

    "plotBoundary.sectionTitle": "प्लॉट सीमा (KML)",
    "plotBoundary.boundarySaved": "सीमा जतन झाली आहे — कोपरे बदलण्यासाठी नकाशा उघडा.",
    "plotBoundary.noBoundary": "अद्याप सीमा नाही — नकाशावर तुमचा प्लॉट काढा.",
    "plotBoundary.plotIdMissing": "प्रोफाइलमध्ये प्लॉट आयडी सापडला नाही. कृपया सपोर्टशी संपर्क करा.",
    "plotBoundary.editButton": "प्लॉट सीमा संपादित करा",
    "plotBoundary.title": "प्लॉट सीमा",
    "plotBoundary.plotPrefix": "प्लॉट",
    "plotBoundary.subtitleDefault": "तुमची शेत सीमा पहा किंवा संपादित करा",
    "plotBoundary.close": "बंद करा",
    "plotBoundary.howToEdit": "संपादन कसे करावे:",
    "plotBoundary.howToEditBody":
      "वर-उजवीकडील चौरस संपादन टूलवर क्लिक करा, कोपरे ओढून आकार बदला, नंतर खाली सीमा जतन करा क्लिक करा. आकार काढून नवीन काढण्यासाठी हटवा / साफ करा वापरा (सर्व्हरला नवीन सीमा हवी — रिकामी सोडता येत नाही).",
    "plotBoundary.drawStep1": "नकाशा तुमच्या जागेवर आणण्यासाठी पर्यायी माझे सध्याचे स्थान वापरा टॅप करा.",
    "plotBoundary.drawStep2": "नकाशाच्या वर-उजवीकडील पेंटागन चिन्हावर क्लिक करा.",
    "plotBoundary.drawStep3": "सॅटेलाइट चित्रावर तुमच्या प्लॉटच्या प्रत्येक कोपऱ्यावर क्लिक करा.",
    "plotBoundary.drawStep4": "आकार बंद करण्यासाठी पहिल्या बिंदूवर पुन्हा क्लिक करा (किंवा डबल-क्लिक करा).",
    "plotBoundary.drawStep5": "गणना केलेले क्षेत्रफळ तपासा, नंतर सीमा जतन करा क्लिक करा.",
    "plotBoundary.viewingHint":
      "प्लॉट सीमा पाहत आहात. बदल करण्यासाठी प्लॉट संपादित करा टॅप करा, किंवा साफ करून पुन्हा काढण्यासाठी हटवा.",
    "plotBoundary.viewingOverlay": "प्लॉट सीमा पाहत आहात. बदल करण्यासाठी 'प्लॉट संपादित करा' टॅप करा.",
    "plotBoundary.plotCenter": "प्लॉट केंद्र (अक्षांश / रेखांश)",
    "plotBoundary.coordsHintEdit":
      "नकाशा हलवण्यासाठी निर्देशांक भरा. सीमा काढण्यासाठी किंवा पुन्हा काढण्यासाठी नकाशा टूल्स टॅप करा.",
    "plotBoundary.coordsHintView":
      "नकाशा हलवण्यासाठी निर्देशांक भरा. सीमा काढण्यासाठी किंवा पुन्हा काढण्यासाठी प्लॉट संपादित करा टॅप करा.",
    "plotBoundary.latitude": "अक्षांश",
    "plotBoundary.longitude": "रेखांश",
    "plotBoundary.goToLocation": "स्थानावर जा",
    "plotBoundary.gettingLocation": "तुमचे स्थान घेत आहे…",
    "plotBoundary.useMyLocation": "माझे सध्याचे स्थान वापरा",
    "plotBoundary.noShapeYet":
      "नकाशावर अजून आकार नाही. प्लॉट काढण्यासाठी वर-उजवीकडील पेंटागन टूल वापरा.",
    "plotBoundary.calculatedArea": "गणना केलेले क्षेत्रफळ:",
    "plotBoundary.acres": "एकर",
    "plotBoundary.deleteBoundary": "सीमा हटवा",
    "plotBoundary.clearToRedraw": "पुन्हा काढण्यासाठी साफ करा",
    "plotBoundary.cancel": "रद्द करा",
    "plotBoundary.editPlot": "प्लॉट संपादित करा",
    "plotBoundary.saveBoundary": "सीमा जतन करा",
    "plotBoundary.areaError": "या आकाराचे क्षेत्रफळ काढता आले नाही. कृपया पुन्हा काढा.",
    "plotBoundary.clearConfirm":
      "नवीन सीमा काढण्यासाठी ही सीमा नकाशावरून साफ करायची?\n\nकाढल्यानंतर सीमा जतन करा क्लिक करा. सर्व्हर नवीन सीमा न देता काढू देत नाही.",
    "plotBoundary.invalidLatLng": "योग्य अक्षांश आणि रेखांश भरा.",
    "plotBoundary.latLngRange": "अक्षांश -90 ते 90 आणि रेखांश -180 ते 180 असावा.",
    "plotBoundary.geoUnsupported": "हा ब्राउझर जिओलोकेशन सपोर्ट करत नाही.",
    "plotBoundary.geoDenied":
      "स्थान परवानगी नाकारली. ब्राउझर सेटिंगमध्ये स्थान ऍक्सेस द्या, नंतर पुन्हा प्रयत्न करा.",
    "plotBoundary.geoFailed":
      "सध्याचे स्थान मिळाले नाही. निर्देशांक स्वतः भरा किंवा पुन्हा प्रयत्न करा.",
    "plotBoundary.permissionDenied":
      "ही प्लॉट सीमा अपडेट करण्याची परवानगी नाही. कृपया फील्ड ऑफिसर किंवा सपोर्टशी संपर्क करा.",
    "plotBoundary.cannotDelete":
      "सर्व्हर प्लॉट सीमा हटवू देत नाही. नकाशा साफ करा, नवीन आकार काढा, नंतर सीमा जतन करा क्लिक करा.",
    "plotBoundary.saveFailed": "प्लॉट सीमा जतन झाली नाही.",
    "plotBoundary.drawFirst":
      "आधी नकाशावर प्लॉट सीमा काढा, नंतर सीमा जतन करा क्लिक करा.",
    "plotBoundary.minCorners": "प्लॉट सीमेला किमान ३ कोपरे असावेत.",
    "plotBoundary.locationMissing":
      "प्लॉट स्थान सापडले नाही. अक्षांश/रेखांश भरा किंवा सीमा पुन्हा काढा.",
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

    "plotBoundary.sectionTitle": "ಪ್ಲಾಟ್ ಬೌಂಡರಿ (KML)",
    "plotBoundary.boundarySaved": "ಬೌಂಡರಿ ಉಳಿಸಲಾಗಿದೆ — ಮೂಲೆಗಳನ್ನು ಬದಲಾಯಿಸಲು ನಕ್ಷೆ ತೆರೆಯಿರಿ.",
    "plotBoundary.noBoundary": "ಇನ್ನೂ ಬೌಂಡರಿ ಇಲ್ಲ — ನಕ್ಷೆಯಲ್ಲಿ ನಿಮ್ಮ ಪ್ಲಾಟ್ ಚಿತ್ರಿಸಿ.",
    "plotBoundary.plotIdMissing": "ಪ್ರೊಫೈಲ್‌ನಲ್ಲಿ ಪ್ಲಾಟ್ ಐಡಿ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಬೆಂಬಲವನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    "plotBoundary.editButton": "ಪ್ಲಾಟ್ ಬೌಂಡರಿ ಸಂಪಾದಿಸಿ",
    "plotBoundary.title": "ಪ್ಲಾಟ್ ಬೌಂಡರಿ",
    "plotBoundary.plotPrefix": "ಪ್ಲಾಟ್",
    "plotBoundary.subtitleDefault": "ನಿಮ್ಮ ಫಾರ್ಮ್ ಬೌಂಡರಿ ನೋಡಿ ಅಥವಾ ಸಂಪಾದಿಸಿ",
    "plotBoundary.close": "ಮುಚ್ಚಿ",
    "plotBoundary.howToEdit": "ಹೇಗೆ ಸಂಪಾದಿಸುವುದು:",
    "plotBoundary.howToEditBody":
      "ಮೇಲೆ-ಬಲದ ಚೌಕ ಸಂಪಾದನೆ ಟೂಲ್ ಕ್ಲಿಕ್ ಮಾಡಿ, ಮೂಲೆಗಳನ್ನು ಎಳೆದು ಗಾತ್ರ ಬದಲಾಯಿಸಿ, ನಂತರ ಕೆಳಗೆ ಗಡಿ ಉಳಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ. ಆಕಾರ ತೆಗೆದು ಹೊಸದನ್ನು ಚಿತ್ರಿಸಲು ಅಳಿಸಿ / ತೆರವುಗೊಳಿಸಿ ಬಳಸಿ (ಸರ್ವರ್‌ಗೆ ಹೊಸ ಬೌಂಡರಿ ಬೇಕು — ಖಾಲಿ ಬಿಡಲಾಗುವುದಿಲ್ಲ).",
    "plotBoundary.drawStep1": "ನಕ್ಷೆಯನ್ನು ನಿಮ್ಮ ಸ್ಥಳಕ್ಕೆ ತರಲು ಐಚ್ಛಿಕವಾಗಿ ನನ್ನ ಪ್ರಸ್ತುತ ಸ್ಥಳ ಬಳಸಿ ಟ್ಯಾಪ್ ಮಾಡಿ.",
    "plotBoundary.drawStep2": "ನಕ್ಷೆಯ ಮೇಲೆ-ಬಲದ ಪೆಂಟಗನ್ ಐಕಾನ್ ಕ್ಲಿಕ್ ಮಾಡಿ.",
    "plotBoundary.drawStep3": "ಉಪಗ್ರಹ ಚಿತ್ರದಲ್ಲಿ ನಿಮ್ಮ ಪ್ಲಾಟ್‌ನ ಪ್ರತಿ ಮೂಲೆಯನ್ನು ಕ್ಲಿಕ್ ಮಾಡಿ.",
    "plotBoundary.drawStep4": "ಆಕಾರ ಮುಚ್ಚಲು ಮೊದಲ ಬಿಂದುವನ್ನು ಮತ್ತೆ ಕ್ಲಿಕ್ ಮಾಡಿ (ಅಥವಾ ಡಬಲ್-ಕ್ಲಿಕ್ ಮಾಡಿ).",
    "plotBoundary.drawStep5": "ಲೆಕ್ಕಾಚಾರದ ವಿಸ್ತೀರ್ಣ ಪರಿಶೀಲಿಸಿ, ನಂತರ ಗಡಿ ಉಳಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ.",
    "plotBoundary.viewingHint":
      "ಪ್ಲಾಟ್ ಬೌಂಡರಿ ನೋಡುತ್ತಿದ್ದೀರಿ. ಬದಲಾವಣೆಗೆ ಪ್ಲಾಟ್ ಸಂಪಾದಿಸಿ ಟ್ಯಾಪ್ ಮಾಡಿ, ಅಥವಾ ತೆರವುಗೊಳಿಸಿ ಮತ್ತೆ ಚಿತ್ರಿಸಲು ಅಳಿಸಿ.",
    "plotBoundary.viewingOverlay": "ಪ್ಲಾಟ್ ಬೌಂಡರಿ ನೋಡುತ್ತಿದ್ದೀರಿ. ಬದಲಾವಣೆಗೆ 'ಪ್ಲಾಟ್ ಸಂಪಾದಿಸಿ' ಟ್ಯಾಪ್ ಮಾಡಿ.",
    "plotBoundary.plotCenter": "ಪ್ಲಾಟ್ ಕೇಂದ್ರ (ಅಕ್ಷಾಂಶ / ರೇಖಾಂಶ)",
    "plotBoundary.coordsHintEdit":
      "ನಕ್ಷೆ ಸರಿಸಲು ನಿರ್ದೇಶಾಂಕಗಳನ್ನು ನಮೂದಿಸಿ. ಬೌಂಡರಿ ಚಿತ್ರಿಸಲು ಅಥವಾ ಮತ್ತೆ ಚಿತ್ರಿಸಲು ನಕ್ಷೆ ಟೂಲ್‌ಗಳನ್ನು ಟ್ಯಾಪ್ ಮಾಡಿ.",
    "plotBoundary.coordsHintView":
      "ನಕ್ಷೆ ಸರಿಸಲು ನಿರ್ದೇಶಾಂಕಗಳನ್ನು ನಮೂದಿಸಿ. ಬೌಂಡರಿ ಚಿತ್ರಿಸಲು ಅಥವಾ ಮತ್ತೆ ಚಿತ್ರಿಸಲು ಪ್ಲಾಟ್ ಸಂಪಾದಿಸಿ ಟ್ಯಾಪ್ ಮಾಡಿ.",
    "plotBoundary.latitude": "ಅಕ್ಷಾಂಶ",
    "plotBoundary.longitude": "ರೇಖಾಂಶ",
    "plotBoundary.goToLocation": "ಸ್ಥಳಕ್ಕೆ ಹೋಗಿ",
    "plotBoundary.gettingLocation": "ನಿಮ್ಮ ಸ್ಥಳ ಪಡೆಯಲಾಗುತ್ತಿದೆ…",
    "plotBoundary.useMyLocation": "ನನ್ನ ಪ್ರಸ್ತುತ ಸ್ಥಳ ಬಳಸಿ",
    "plotBoundary.noShapeYet":
      "ನಕ್ಷೆಯಲ್ಲಿ ಇನ್ನೂ ಆಕಾರವಿಲ್ಲ. ಪ್ಲಾಟ್ ಚಿತ್ರಿಸಲು ಮೇಲೆ-ಬಲದ ಪೆಂಟಗನ್ ಟೂಲ್ ಬಳಸಿ.",
    "plotBoundary.calculatedArea": "ಲೆಕ್ಕಾಚಾರದ ವಿಸ್ತೀರ್ಣ:",
    "plotBoundary.acres": "ಎಕರೆ",
    "plotBoundary.deleteBoundary": "ಬೌಂಡರಿ ಅಳಿಸಿ",
    "plotBoundary.clearToRedraw": "ಮತ್ತೆ ಚಿತ್ರಿಸಲು ತೆರವುಗೊಳಿಸಿ",
    "plotBoundary.cancel": "ರದ್ದುಮಾಡಿ",
    "plotBoundary.editPlot": "ಪ್ಲಾಟ್ ಸಂಪಾದಿಸಿ",
    "plotBoundary.saveBoundary": "ಗಡಿ ಉಳಿಸಿ",
    "plotBoundary.areaError": "ಈ ಆಕಾರದ ವಿಸ್ತೀರ್ಣ ಲೆಕ್ಕ ಹಾಕಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಚಿತ್ರಿಸಿ.",
    "plotBoundary.clearConfirm":
      "ಹೊಸ ಬೌಂಡರಿ ಚಿತ್ರಿಸಲು ಈ ಬೌಂಡರಿಯನ್ನು ನಕ್ಷೆಯಿಂದ ತೆರವುಗೊಳಿಸುವುದೇ?\n\nಚಿತ್ರಿಸಿದ ನಂತರ ಗಡಿ ಉಳಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ. ಸರ್ವರ್ ಹೊಸ ಬೌಂಡರಿ ಇಲ್ಲದೆ ತೆಗೆಯಲು ಅನುಮತಿಸುವುದಿಲ್ಲ.",
    "plotBoundary.invalidLatLng": "ಮಾನ್ಯ ಅಕ್ಷಾಂಶ ಮತ್ತು ರೇಖಾಂಶ ನಮೂದಿಸಿ.",
    "plotBoundary.latLngRange": "ಅಕ್ಷಾಂಶ -90 ರಿಂದ 90 ಮತ್ತು ರೇಖಾಂಶ -180 ರಿಂದ 180 ಇರಬೇಕು.",
    "plotBoundary.geoUnsupported": "ಈ ಬ್ರೌಸರ್ ಜಿಯೋಲೊಕೇಶನ್ ಬೆಂಬಲಿಸುವುದಿಲ್ಲ.",
    "plotBoundary.geoDenied":
      "ಸ್ಥಳ ಅನುಮತಿ ನಿರಾಕರಿಸಲಾಗಿದೆ. ಬ್ರೌಸರ್ ಸೆಟ್ಟಿಂಗ್‌ನಲ್ಲಿ ಸ್ಥಳ ಪ್ರವೇಶ ನೀಡಿ, ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    "plotBoundary.geoFailed":
      "ಪ್ರಸ್ತುತ ಸ್ಥಳ ಸಿಗಲಿಲ್ಲ. ನಿರ್ದೇಶಾಂಕಗಳನ್ನು ನೀವೇ ನಮೂದಿಸಿ ಅಥವಾ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    "plotBoundary.permissionDenied":
      "ಈ ಪ್ಲಾಟ್ ಬೌಂಡರಿ ನವೀಕರಿಸಲು ಅನುಮತಿ ಇಲ್ಲ. ದಯವಿಟ್ಟು ಫೀಲ್ಡ್ ಅಧಿಕಾರಿ ಅಥವಾ ಬೆಂಬಲವನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    "plotBoundary.cannotDelete":
      "ಸರ್ವರ್ ಪ್ಲಾಟ್ ಬೌಂಡರಿ ಅಳಿಸಲು ಅನುಮತಿಸುವುದಿಲ್ಲ. ನಕ್ಷೆ ತೆರವುಗೊಳಿಸಿ, ಹೊಸ ಆಕಾರ ಚಿತ್ರಿಸಿ, ನಂತರ ಗಡಿ ಉಳಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ.",
    "plotBoundary.saveFailed": "ಪ್ಲಾಟ್ ಬೌಂಡರಿ ಉಳಿಸಲಾಗಲಿಲ್ಲ.",
    "plotBoundary.drawFirst":
      "ಮೊದಲು ನಕ್ಷೆಯಲ್ಲಿ ಪ್ಲಾಟ್ ಬೌಂಡರಿ ಚಿತ್ರಿಸಿ, ನಂತರ ಗಡಿ ಉಳಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ.",
    "plotBoundary.minCorners": "ಪ್ಲಾಟ್ ಬೌಂಡರಿಗೆ ಕನಿಷ್ಠ 3 ಮೂಲೆಗಳು ಬೇಕು.",
    "plotBoundary.locationMissing":
      "ಪ್ಲಾಟ್ ಸ್ಥಳ ಸಿಗಲಿಲ್ಲ. ಅಕ್ಷಾಂಶ/ರೇಖಾಂಶ ನಮೂದಿಸಿ ಅಥವಾ ಬೌಂಡರಿ ಮತ್ತೆ ಚಿತ್ರಿಸಿ.",
  },
};

const readGoogTransLanguage = (): AppLanguage | null => {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const s = part.trim();
    if (!s.toLowerCase().startsWith("googtrans=")) continue;
    const v = s.slice("googtrans=".length).trim();
    const decoded = (() => {
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    })();
    const m = decoded.match(/^\/[^/]+\/([^/]+)$/);
    if (m?.[1]) return normalizeLanguage(m[1]);
  }
  return null;
};

export const useI18nLite = () => {
  const [lang, setLang] = useState<AppLanguage>(initialLanguage);

  useEffect(() => {
    const stored = normalizeLanguage(localStorage.getItem(STORAGE_KEY));
    const fromCookie = readGoogTransLanguage();
    setLang(fromCookie || stored);

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

