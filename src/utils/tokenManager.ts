import { jwtDecode } from "jwt-decode";
import {
  getAuthToken,
  getRefreshToken,
  setAuthToken,
  setRefreshToken,
  clearAuthData,
  clearAllLocalStorage,
  isPlanetEyeDemoToken,
} from "./auth";
import axios from "axios";

// Get API base URL from environment or use default
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://cropeye-backendd.up.railway.app/api";

interface DecodedToken {
  exp: number;
  iat?: number;
  user_id?: number;
  id?: number;
  [key: string]: any;
}

/**
 * Decode JWT token and return payload
 */
export const decodeToken = (token: string): DecodedToken | null => {
  try {
    return jwtDecode<DecodedToken>(token);
  } catch (error) {
    console.error("Error decoding token:", error);
    return null;
  }
};

/**
 * Check if token is expired or will expire soon
 * @param token - JWT token string
 * @param bufferSeconds - Number of seconds before expiration to consider token as "expiring soon" (default: 300 = 5 minutes)
 * @returns true if token is expired or expiring soon
 */
export const isTokenExpired = (
  token: string | null,
  bufferSeconds: number = 300,
): boolean => {
  if (!token || isPlanetEyeDemoToken(token)) return false;

  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return true;

  const currentTime = Math.floor(Date.now() / 1000);
  const expirationTime = decoded.exp;
  const timeUntilExpiration = expirationTime - currentTime;

  // Token is expired or will expire within bufferSeconds
  return timeUntilExpiration <= bufferSeconds;
};

/**
 * Get time until token expiration in seconds
 */
export const getTokenExpirationTime = (token: string | null): number | null => {
  if (!token) return null;

  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return null;

  const currentTime = Math.floor(Date.now() / 1000);
  return decoded.exp - currentTime;
};

/**
 * Refresh access token using refresh token
 */
export const refreshAccessToken = async (): Promise<string | null> => {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    console.warn("No refresh token available");
    return null;
  }

  try {
    const response = await axios.post(
      `${API_BASE_URL}/token/refresh/`,
      {
        refresh: refreshToken,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    const { access, refresh: newRefreshToken } = response.data;

    if (access) {
      // Update access token
      setAuthToken(access);

      // Update refresh token if a new one is provided
      if (newRefreshToken) {
        setRefreshToken(newRefreshToken);
      }

      console.log("✅ Token refreshed successfully");
      return access;
    }

    return null;
  } catch (error: any) {
    console.error("❌ Token refresh failed:", error);

    // If refresh token is invalid/expired, clear all storage (no cache left)
    if (error.response?.status === 401 || error.response?.status === 403) {
      console.warn("Refresh token is invalid, clearing all storage");
      clearAllLocalStorage();

      // Redirect to login if not already there
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }

    return null;
  }
};

/**
 * Check and refresh token if needed (proactive refresh)
 * @param bufferSeconds - Number of seconds before expiration to refresh (default: 300 = 5 minutes)
 * @returns Promise<boolean> - true if token is valid/refreshed, false if expired
 */
export const checkAndRefreshToken = async (
  bufferSeconds: number = 300,
): Promise<boolean> => {
  const accessToken = getAuthToken();

  if (isPlanetEyeDemoToken(accessToken)) return true;

  // No token at all
  if (!accessToken) {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      // Try to refresh
      const newToken = await refreshAccessToken();
      return newToken !== null;
    }
    return false;
  }

  // Check if token is expired or expiring soon
  if (isTokenExpired(accessToken, bufferSeconds)) {
    console.log("Token expired or expiring soon, refreshing...");
    const newToken = await refreshAccessToken();
    return newToken !== null;
  }

  return true;
};

/**
 * Set up automatic token refresh on interval
 * @param intervalSeconds - Check interval in seconds (default: 60 = 1 minute)
 * @param bufferSeconds - Refresh buffer in seconds (default: 300 = 5 minutes)
 * @returns cleanup function to stop the interval
 */
export const setupAutoTokenRefresh = (
  intervalSeconds: number = 60,
  bufferSeconds: number = 300,
): (() => void) => {
  const intervalId = setInterval(async () => {
    await checkAndRefreshToken(bufferSeconds);
  }, intervalSeconds * 1000);

  // Return cleanup function
  return () => clearInterval(intervalId);
};

/**
 * Set up token refresh on page visibility change
 * Refreshes token when user returns to the page
 */
export const setupVisibilityTokenRefresh = (): (() => void) => {
  const handleVisibilityChange = async () => {
    if (document.visibilityState === "visible") {
      console.log("Page became visible, checking token...");
      await checkAndRefreshToken();
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  // Return cleanup function
  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
};

/**
 * Set up token refresh on page focus
 */
export const setupFocusTokenRefresh = (): (() => void) => {
  const handleFocus = async () => {
    console.log("Window focused, checking token...");
    await checkAndRefreshToken();
  };

  window.addEventListener("focus", handleFocus);

  // Return cleanup function
  return () => {
    window.removeEventListener("focus", handleFocus);
  };
};

/**
 * Initialize all token refresh mechanisms
 * @returns cleanup function to stop all refresh mechanisms
 */
export const initializeTokenRefresh = (): (() => void) => {
  // Set up automatic refresh on interval
  const clearInterval = setupAutoTokenRefresh(60, 300); // Check every minute, refresh 5 min before expiration

  // Set up refresh on visibility change
  const clearVisibility = setupVisibilityTokenRefresh();

  // Set up refresh on window focus
  const clearFocus = setupFocusTokenRefresh();

  // Initial check
  checkAndRefreshToken().catch(console.error);

  // Return combined cleanup function
  return () => {
    clearInterval();
    clearVisibility();
    clearFocus();
  };
};
