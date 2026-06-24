import { clearAllAppCache } from "../components/utils/cache";

// Authentication utility functions
export const AUTH_TOKEN_KEY = 'token';
export const REFRESH_TOKEN_KEY = 'refresh_token'; // Add refresh token key
export const FASTAPI_TOKEN_KEY = 'fastapi_token';
export const USER_ROLE_KEY = 'role';
export const USER_DATA_KEY = 'userData';
export const IS_AUTHENTICATED_KEY = 'isAuthenticated';

// Get authentication token from localStorage
export const getAuthToken = (): string | null => {
  return localStorage.getItem(AUTH_TOKEN_KEY);
};

// Set authentication token in localStorage
export const setAuthToken = (token: string): void => {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
};

// Remove authentication token from localStorage
export const removeAuthToken = (): void => {
  localStorage.removeItem(AUTH_TOKEN_KEY);
};

// Check if user is authenticated
export const isAuthenticated = (): boolean => {
  const token = getAuthToken();
  return token !== null && token !== '';
};

// Get user role from localStorage
export const getUserRole = (): string | null => {
  return localStorage.getItem(USER_ROLE_KEY);
};

// Set user role in localStorage
export const setUserRole = (role: string): void => {
  localStorage.setItem(USER_ROLE_KEY, role);
};

// Remove user role from localStorage
export const removeUserRole = (): void => {
  localStorage.removeItem(USER_ROLE_KEY);
};

// Get user data from localStorage
export const getUserData = (): any => {
  const userData = localStorage.getItem(USER_DATA_KEY);
  return userData ? JSON.parse(userData) : null;
};

// Set user data in localStorage
export const setUserData = (userData: any): void => {
  localStorage.setItem(USER_DATA_KEY, JSON.stringify(userData));
};

// Remove user data from localStorage
export const removeUserData = (): void => {
  localStorage.removeItem(USER_DATA_KEY);
};

// Get refresh token from localStorage
export const getRefreshToken = (): string | null => {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
};

// Get FastAPI token from localStorage (used for events microservice auth)
export const getFastApiToken = (): string | null => {
  return localStorage.getItem(FASTAPI_TOKEN_KEY);
};

// Set refresh token in localStorage
export const setRefreshToken = (token: string): void => {
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
};

// Set FastAPI token in localStorage
export const setFastApiToken = (token: string): void => {
  localStorage.setItem(FASTAPI_TOKEN_KEY, token);
};

// Remove refresh token from localStorage
export const removeRefreshToken = (): void => {
  localStorage.removeItem(REFRESH_TOKEN_KEY);
};

// Remove FastAPI token from localStorage
export const removeFastApiToken = (): void => {
  localStorage.removeItem(FASTAPI_TOKEN_KEY);
};

// Clear all authentication data
export const clearAuthData = (): void => {
  removeAuthToken();
  removeRefreshToken();
  removeFastApiToken();
  removeUserRole();
  removeUserData();
  localStorage.removeItem(IS_AUTHENTICATED_KEY);
};

// Clear ALL localStorage and sessionStorage (used on logout - no local cache remains)
export const clearAllLocalStorage = (): void => {
  try {
    clearAllAppCache();
  } catch (e) {
    // Ignore cache clear errors
  }
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {
    // Ignore if storage is disabled (e.g. private mode)
  }
};

// Set all authentication data after successful login
export const setAuthData = (token: string, role: string, userData?: any, refreshToken?: string): void => {
  setAuthToken(token);
  if (refreshToken) {
    setRefreshToken(refreshToken);
  }
  setUserRole(role);
  if (userData) {
    setUserData(userData);
  }
  localStorage.setItem(IS_AUTHENTICATED_KEY, 'true');
};

// Get authorization header for API calls
export const getAuthHeader = (): { Authorization: string } | {} => {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// Validate token format (basic validation) — demo session is not a JWT for API calls
export const isValidToken = (token: string): boolean => {
  if (isPlanetEyeDemoToken(token)) return false;
  return token && token.length > 0 && token.includes('.');
};

/** Demo login for progress dashboards only (no backend account). */
export const PLANETEYE_DEMO_USERNAME = 'planeteye';
export const PLANETEYE_DEMO_PASSWORD = 'pass@123';
export const PLANETEYE_DEMO_TOKEN = 'planeteye-demo-session';

export const isPlanetEyeDemoToken = (token: string | null | undefined): boolean =>
  token === PLANETEYE_DEMO_TOKEN;

export const isPlanetEyeDemoUser = (): boolean => {
  if (isPlanetEyeDemoToken(getAuthToken())) return true;
  const user = getUserData();
  return (
    user?.isPlanetEyeDemo === true ||
    String(user?.username ?? '').toLowerCase() === PLANETEYE_DEMO_USERNAME
  );
};

export const matchesPlanetEyeDemoLogin = (
  identifier: string,
  password: string,
): boolean =>
  identifier.trim().toLowerCase() === PLANETEYE_DEMO_USERNAME &&
  password === PLANETEYE_DEMO_PASSWORD;
