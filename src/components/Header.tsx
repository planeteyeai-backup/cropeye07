import React, { useEffect, useState } from "react";
import {
  Menu,
  X,
  Cloud,
  Thermometer,
  Wind,
  Droplet,
  MapPin,
  Navigation,
} from "lucide-react";
import NotificationSystem from "./NotificationSystem";
import "./Header.css";
import {
  fetchCurrentWeather,
  formatTemperature,
  formatWindSpeed,
  formatHumidity,
  formatPrecipitation,
  getWeatherIcon,
  getWeatherCondition,
  type WeatherData as WeatherServiceData,
} from "../services/weatherService";
import { useAppContext } from "../context/AppContext";
import { getUserRole, getUserData } from "../utils/auth";
import { useFarmerProfile } from "../hooks/useFarmerProfile";
import GoogleTranslateWidget from "./GoogleTranslateWidget";

interface HeaderProps {
  toggleSidebar: () => void;
  isSidebarOpen: boolean;
  onNavigate?: (view: string) => void;
}

/** Stable component (must not be defined inside Header) — avoids remount thrash that breaks React + Google Translate DOM. */
type WeatherMarqueeContentProps = {
  weather: WeatherServiceData | null;
  userRole: string | null;
  farmerProfileData: { plots?: unknown[] } | null | undefined;
};

const WeatherMarqueeContent: React.FC<WeatherMarqueeContentProps> = ({
  weather,
  userRole,
  farmerProfileData,
}) => {
  const getLocationText = () => {
    if (
      userRole === "farmer" &&
      farmerProfileData &&
      Array.isArray(farmerProfileData.plots) &&
      farmerProfileData.plots.length > 0
    ) {
      return "Farm Location";
    }
    return "Current Location";
  };

  return (
    <div className="weather-marquee-item">
      {weather && (
        <>
          <div className="weather-item weather-location ">
            <MapPin className="weather-icon" size={18} />
            <span className="weather-text">{getLocationText()}</span>
          </div>

          <div className="weather-item weather-condition bg-yellow-200 text-blue-600">
            <span className="weather-icon-text text-black-600">
              {getWeatherIcon(
                weather.temperature_c,
                weather.humidity,
                weather.precip_mm,
              )}
            </span>
            <span className="weather-text">
              {getWeatherCondition(
                weather.temperature_c,
                weather.humidity,
                weather.precip_mm,
              )}
            </span>
          </div>

          <div className="weather-item weather-temp ">
            <Thermometer className="weather-icon" size={18} />
            <span className="weather-text">
              {formatTemperature(weather.temperature_c)}
            </span>
          </div>

          <div className="weather-item weather-humidity">
            <Cloud className="weather-icon" size={18} />
            <span className="weather-text">
              {formatHumidity(weather.humidity)}
            </span>
          </div>

          <div className="weather-item weather-wind">
            <Wind className="weather-icon" size={18} />
            <span className="weather-text">
              {formatWindSpeed(weather.wind_kph)}
            </span>
          </div>

          {weather.precip_mm > 0 && (
            <div className="weather-item weather-precipitation">
              <Droplet className="weather-icon" size={18} />
              <span className="weather-text">
                {formatPrecipitation(weather.precip_mm)}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
};

type LocationPermissionPromptProps = {
  locationPermission: "granted" | "denied" | "prompt" | "loading";
  onAllow: () => void;
  onDeny: () => void;
};

const LocationPermissionPrompt: React.FC<LocationPermissionPromptProps> = ({
  locationPermission,
  onAllow,
  onDeny,
}) => (
  <div className="location-prompt-overlay">
    <div className="location-prompt-modal">
      <div className="location-prompt-header">
        <Navigation className="location-prompt-icon" size={24} />
        <h3>Location Access Required</h3>
      </div>
      <div className="location-prompt-content">
        <p>
          To show weather data for your current location, we need access to your
          device&apos;s location.
        </p>
        <p>
          This helps us provide accurate weather information for your area.
        </p>
      </div>
      <div className="location-prompt-actions">
        <button
          type="button"
          onClick={onAllow}
          disabled={locationPermission === "loading"}
          className="location-prompt-allow-btn"
        >
          {locationPermission === "loading"
            ? "Getting Location..."
            : "Allow Location"}
        </button>
        <button
          type="button"
          onClick={onDeny}
          className="location-prompt-deny-btn"
        >
          Use Default Location
        </button>
      </div>
    </div>
  </div>
);

export const Header: React.FC<HeaderProps> = ({
  toggleSidebar,
  isSidebarOpen,
  onNavigate,
}) => {
  const [weather, setWeather] = useState<WeatherServiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locationPermission, setLocationPermission] = useState<
    "granted" | "denied" | "prompt" | "loading"
  >("prompt");
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);
  const [userData, setUserData] = useState<any>(null);
  const { getCached, setCached } = useAppContext();

  // Conditionally use farmer profile hook only for farmers
  const userRole = getUserRole();
  const farmerProfile = useFarmerProfile();
  const { profile: farmerProfileData, loading: farmerProfileLoading } =
    farmerProfile;

  // Get user's current location using geolocation API
  const getUserCurrentLocation = (): Promise<{
    latitude: number;
    longitude: number;
  }> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by this browser"));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        (error) => {
          reject(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000, // 5 minutes
        }
      );
    });
  };

  // Request location permission and get coordinates
  const requestLocationPermission = async () => {
    try {
      setLocationPermission("loading");
      const location = await getUserCurrentLocation();
      setUserLocation(location);
      setLocationPermission("granted");
      setShowLocationPrompt(false);
    } catch (error) {
      console.error("📍 Location access denied or failed:", error);
      setLocationPermission("denied");
      setShowLocationPrompt(false);
    }
  };

  // Get location based on user role
  const getLocationForUser = async (): Promise<{
    latitude: number;
    longitude: number;
    source: string;
  }> => {
    // For farmers, prioritize farm location over current location
    if (userRole === "farmer") {

      // First try farm location
      if (
        farmerProfileData &&
        farmerProfileData.plots &&
        farmerProfileData.plots.length > 0
      ) {
        const firstPlot = farmerProfileData.plots[0];
        const coordinates = firstPlot.coordinates?.location?.coordinates;

        if (coordinates && coordinates.length === 2) {
          const [longitude, latitude] = coordinates;
          return { latitude, longitude, source: "farm" };
        }
      }

      // If no farm location, try current location
      if (userLocation) {
        return { ...userLocation, source: "current" };
      }

      // If no location available, show prompt
      if (locationPermission === "prompt") {
        setShowLocationPrompt(true);
        throw new Error("Location permission required");
      }

      // Fallback to default location
      return { latitude: 18.5204, longitude: 73.8567, source: "default" };
    }

    // For non-farmers (manager, field officer, owner), use current location
    if (userLocation) {
      return { ...userLocation, source: "current" };
    }

    // If no location available, show prompt
    if (locationPermission === "prompt") {
      setShowLocationPrompt(true);
      throw new Error("Location permission required");
    }

    // Fallback to default location (Pune, India)
    return { latitude: 18.5204, longitude: 73.8567, source: "default" };
  };

  // Load user data on component mount
  useEffect(() => {
    const loadUserData = () => {
      const currentUserData = getUserData();
      setUserData(currentUserData);
    };

    loadUserData();
  }, []);


  useEffect(() => {
    const fetchWeather = async () => {
      try {
        setLoading(true);
        setError(null);

        // For farmers, wait for profile to load
        if (userRole === "farmer" && farmerProfileLoading) {
          return;
        }

        // Get location based on user role
        const locationData = await getLocationForUser();
        const { latitude, longitude } = locationData;

        // Check cache first
        const cacheKey = `weather_${latitude}_${longitude}`;
        const cached = getCached(cacheKey);
        if (cached) {
          setWeather(cached.data);
          setError(null);
          setLoading(false);
          return;
        }

        // Fetch weather data using the new service
        const weatherData = await fetchCurrentWeather(latitude, longitude);

        setWeather(weatherData);
        setError(null);
        setLoading(false);

        // Cache the data
        const payload = { data: weatherData, timestamp: Date.now() };
        setCached(cacheKey, payload);
      } catch (err) {
        console.error("🌤️ Weather fetch error:", err);

        if (err instanceof Error) {
          if (err.message === "Location permission required") {
            setError("Location access required for weather data");
          } else {
            setError(err.message);
          }
        } else {
          setError("Failed to fetch weather data");
        }

        setLoading(false);
      }
    };

    fetchWeather();

    // Set up periodic refresh every 10 minutes
    const interval = setInterval(fetchWeather, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, [
    userData,
    userLocation,
    locationPermission,
    farmerProfileData,
    farmerProfileLoading,
  ]);

  return (
    <>
      <header
        className="header-container bg-blue-100 notranslate"
        translate="no"
      >
        {/* Main Header Section */}
        <div className="header-main">
          {/* Left side - Menu Button */}
          <button onClick={toggleSidebar} className="menu-button">
            {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>

          {/* Center - Weather Marquee */}
          <div className="marquee-section">
            <div className="marquee-container">
              {loading ? (
                <div className="loading-text">
                  {userRole === "farmer" && farmerProfileLoading
                    ? "Loading farmer profile..."
                    : "Loading weather data..."}
                </div>
              ) : error ? (
                <div className="error-text">
                  {error}
                  {error === "Location access required for weather data" && (
                    <button
                      onClick={() => setShowLocationPrompt(true)}
                      className="location-request-btn"
                    >
                      <MapPin size={16} />
                      Enable Location
                    </button>
                  )}
                </div>
              ) : (
                <div className="marquee-content">
                  <WeatherMarqueeContent
                    weather={weather}
                    userRole={userRole}
                    farmerProfileData={farmerProfileData}
                  />
                  <WeatherMarqueeContent
                    weather={weather}
                    userRole={userRole}
                    farmerProfileData={farmerProfileData}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Right side - Notifications + Google Translate + Logo */}
          <div className="logo-container">
            <NotificationSystem onNavigate={onNavigate} />
            <GoogleTranslateWidget />
            <img src="/icons/Cropeye-new.png" alt="CropEye Logo" className="logo-image" />
          </div>
        </div>
      </header>

      {/* Location Permission Prompt */}
      {showLocationPrompt && (
        <LocationPermissionPrompt
          locationPermission={locationPermission}
          onAllow={requestLocationPermission}
          onDeny={() => {
            setShowLocationPrompt(false);
            setLocationPermission("denied");
          }}
        />
      )}
    </>
  );
};

export default Header;
