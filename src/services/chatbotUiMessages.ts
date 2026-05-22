import type { ChatLocaleCode } from "./ruleBasedChatbot";

export type ChatbotUiMessageKey =
  | "selectLanguageFirst"
  | "selectPlotFirst"
  | "farmContextNotReady"
  | "farmContextLost"
  | "plotStillLoading"
  | "initFailedBanner"
  | "initGenericFailed"
  | "loadingPlot"
  | "loadingPlotSub"
  | "plotLocationMissing"
  | "noPlotSelected";

const MESSAGES: Record<ChatLocaleCode, Record<ChatbotUiMessageKey, string>> = {
  mr: {
    selectLanguageFirst: "कृपया वरच्या मेनूमधून चॅट भाषा निवडा.",
    selectPlotFirst:
      "कृपया आधी डॅशबोर्डवरून शेत प्लॉट निवडा. सहाय्यकाला तुमचा प्लॉट लागतो.",
    farmContextNotReady:
      "शेत माहिती अजून तयार नाही. वर Retry दाबा किंवा प्लॉट लोड होईपर्यंत थोडा वेळ थांबा.",
    farmContextLost:
      "शेत माहिती लोड झाली नाही. वर Retry दाबून पुन्हा सेटअप करा, नंतर प्रश्न पाठवा.",
    plotStillLoading: "प्लॉट डेटा अजून लोड होत आहे. कृपया थोडा वेळ थांबा...",
    initFailedBanner:
      "शेत माहिती सेटअप झाला नाही. वर Retry दाबून पुन्हा प्रयत्न करा.",
    initGenericFailed: "सेटअप अयशस्वी. कृपया पुन्हा प्रयत्न करा.",
    loadingPlot: "तुमचा प्लॉट डेटा लोड होत आहे...",
    loadingPlotSub: "प्लॉट",
    plotLocationMissing: "प्लॉट स्थान माहिती सापडली नाही. कृपया सपोर्टशी संपर्क करा.",
    noPlotSelected: "प्लॉट निवडलेला नाही.",
  },
  hi: {
    selectLanguageFirst: "कृपया ऊपर मेनू से चैट भाषा चुनें।",
    selectPlotFirst:
      "कृपया पहले डैशबोर्ड से फार्म प्लॉट चुनें। असिस्टेंट को आपका प्लॉट चाहिए।",
    farmContextNotReady:
      "फार्म डेटा तैयार नहीं है। ऊपर Retry दबाएं या प्लॉट लोड होने तक प्रतीक्षा करें।",
    farmContextLost:
      "फार्म डेटा लोड नहीं हुआ। ऊपर Retry दबाकर सेटअप फिर करें, फिर संदेश भेजें।",
    plotStillLoading: "प्लॉट डेटा अभी लोड हो रहा है। कृपया प्रतीक्षा करें...",
    initFailedBanner:
      "फार्म डेटा सेटअप नहीं हुआ। ऊपर Retry दबाकर फिर प्रयास करें।",
    initGenericFailed: "सेटअप विफल। कृपया फिर प्रयास करें।",
    loadingPlot: "आपका प्लॉट डेटा लोड हो रहा है...",
    loadingPlotSub: "प्लॉट",
    plotLocationMissing: "प्लॉट स्थान जानकारी नहीं मिली। कृपया सपोर्ट से संपर्क करें।",
    noPlotSelected: "कोई प्लॉट चयनित नहीं है।",
  },
  kn: {
    selectLanguageFirst: "ದಯವಿಟ್ಟು ಮೇಲಿನ ಮೆನುವಿನಿಂದ ಚಾಟ್ ಭಾಷೆಯನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.",
    selectPlotFirst:
      "ದಯವಿಟ್ಟು ಮೊದಲು ಡ್ಯಾಶ್‌ಬೋರ್ಡ್‌ನಿಂದ ಫಾರ್ಮ್ ಪ್ಲಾಟ್ ಆಯ್ಕೆ ಮಾಡಿ. ಸಹಾಯಕಕ್ಕೆ ನಿಮ್ಮ ಪ್ಲಾಟ್ ಬೇಕು.",
    farmContextNotReady:
      "ಫಾರ್ಮ್ ಮಾಹಿತಿ ಇನ್ನೂ ಸಿದ್ಧವಾಗಿಲ್ಲ. ಮೇಲೆ Retry ಒತ್ತಿ ಅಥವಾ ಪ್ಲಾಟ್ ಲೋಡ್ ಆಗುವವರೆಗೆ ಕಾಯಿರಿ.",
    farmContextLost:
      "ಫಾರ್ಮ್ ಮಾಹಿತಿ ಲೋಡ್ ಆಗಿಲ್ಲ. ಮೇಲೆ Retry ಒತ್ತಿ ಮತ್ತೆ ಸೆಟಪ್ ಮಾಡಿ, ನಂತರ ಪ್ರಶ್ನೆ ಕಳುಹಿಸಿ.",
    plotStillLoading: "ಪ್ಲಾಟ್ ಡೇಟಾ ಇನ್ನೂ ಲೋಡ್ ಆಗುತ್ತಿದೆ. ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಕಾಯಿರಿ...",
    initFailedBanner:
      "ಫಾರ್ಮ್ ಮಾಹಿತಿ ಸೆಟಪ್ ಆಗಿಲ್ಲ. ಮೇಲೆ Retry ಒತ್ತಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    initGenericFailed: "ಸೆಟಪ್ ವಿಫಲವಾಯಿತು. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    loadingPlot: "ನಿಮ್ಮ ಪ್ಲಾಟ್ ಡೇಟಾ ಲೋಡ್ ಆಗುತ್ತಿದೆ...",
    loadingPlotSub: "ಪ್ಲಾಟ್",
    plotLocationMissing: "ಪ್ಲಾಟ್ ಸ್ಥಳ ಮಾಹಿತಿ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಬೆಂಬಲವನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    noPlotSelected: "ಯಾವುದೇ ಪ್ಲಾಟ್ ಆಯ್ಕೆಯಾಗಿಲ್ಲ.",
  },
  en: {
    selectLanguageFirst: "Please select a chat language from the menu above first.",
    selectPlotFirst:
      "Please select a farm plot from the dashboard first. The assistant needs your plot.",
    farmContextNotReady:
      "Farm data is not ready. Tap Retry above or wait for the plot to finish loading.",
    farmContextLost:
      "Farm data was not loaded. Tap Retry above to run setup again, then send your message.",
    plotStillLoading: "Plot data is still loading. Please wait a moment...",
    initFailedBanner:
      "Farm setup did not complete. Tap Retry above to try again.",
    initGenericFailed: "Setup failed. Please try again.",
    loadingPlot: "Loading your plot data...",
    loadingPlotSub: "Plot",
    plotLocationMissing: "Plot location is missing. Please contact support.",
    noPlotSelected: "No plot selected.",
  },
};

export function getChatbotUiMessage(
  locale: ChatLocaleCode | null,
  key: ChatbotUiMessageKey,
): string {
  const lang: ChatLocaleCode = locale ?? "mr";
  return MESSAGES[lang][key] ?? MESSAGES.mr[key];
}

/** Map known English backend errors to the user's selected chat language. */
export function localizeChatbotServerError(
  raw: string,
  locale: ChatLocaleCode | null,
): string {
  const s = String(raw || "").trim();
  if (!s) return getChatbotUiMessage(locale, "initFailedBanner");

  if (/farm context|initialize-plot|not initialized/i.test(s)) {
    return getChatbotUiMessage(locale, "initFailedBanner");
  }
  if (/plot location missing/i.test(s)) {
    return getChatbotUiMessage(locale, "plotLocationMissing");
  }
  if (/plot data still loading|still loading/i.test(s)) {
    return getChatbotUiMessage(locale, "plotStillLoading");
  }
  if (/Server error: 502|Server error: 503|Server error: 504|Failed to fetch/i.test(s)) {
    return getChatbotUiMessage(locale, "initGenericFailed");
  }

  return s;
}
