import React, { useState, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from "react-router-dom";
import Login from "../components/Login";
import DeleteAccountInfo from "../components/DeleteAccountInfo";
import App from "../App";
import CommonSpinner from "../components/CommanSpinner";
import {
  getAuthToken,
  getUserRole,
  clearAllLocalStorage,
  setAuthData,
  prepareFreshAuthSession,
  isValidToken,
  getUserData,
  resolveAppUserRole,
} from "../utils/auth";
import { getCurrentUser, clearFarmerMyProfileInFlight } from "../api";
import { initializeTokenRefresh } from "../utils/tokenManager";
import { useAppContext } from "../context/AppContext";
import {
  prefetchAllData,
  prefetchFarmerProfile,
  prefetchFieldOfficerAgroStats,
  prefetchManagerFieldOfficers,
} from "../services/prefetchService";
import { pruneAppCache } from "../utils/cache";

export type UserRole =
  | "manager"
  | "admin"
  | "fieldofficer"
  | "farmer"
  | "owner"
  | "planeteye";

const AppRoutesContent: React.FC = () => {
  const navigate = useNavigate();
  const { clearAppStateOnLogout, setCached } = useAppContext();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    // Drop expired / excess cropeye_cache_* keys so Local Storage does not grow forever.
    try {
      pruneAppCache();
    } catch {
      // non-critical
    }

    // Check authentication status on app start
    const token = getAuthToken();
    const savedRole = getUserRole() as UserRole | null;

    const finishLoading = () => {
      if (!cancelled) setLoading(false);
    };

    // Never leave the app on a blank loading screen
    const loadingGuard = window.setTimeout(finishLoading, 12000);

    if (token && savedRole) {
      // Validate token with backend
      void validateToken(token, savedRole).finally(() => {
        window.clearTimeout(loadingGuard);
        finishLoading();
      });
    } else {
      finishLoading();
      window.clearTimeout(loadingGuard);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(loadingGuard);
    };
  }, []);

  // Initialize token refresh when authenticated
  useEffect(() => {
    if (isAuthenticated && userRole) {
      // Set up automatic token refresh
      const cleanup = initializeTokenRefresh();
      
      // Cleanup on unmount or when authentication changes
      return cleanup;
    }
  }, [isAuthenticated, userRole]);

  const validateToken = async (token: string, role: UserRole) => {
    try {
      // Check if token exists and is valid format
      if (!token || token.trim() === "") {
        handleLogout();
        return;
      }

      // Validate token format before making API call
      if (!isValidToken(token)) {
        handleLogout();
        return;
      }

      // Use the API function to get current user (automatically uses stored token)
      const response = await getCurrentUser();
      const userData = response.data;

      // Backend role id 5 is named "admin" but is the PlanetEye progress portals.
      const normalizedRole = resolveAppUserRole(userData);

      if (
        normalizedRole &&
        ["manager", "admin", "fieldofficer", "farmer", "owner", "planeteye"].includes(
          normalizedRole
        )
      ) {
        // For farmer: preload profile before showing dashboard (reduces "Loading farmer profile...")
        if (normalizedRole === "farmer") {
          await prefetchFarmerProfile(setCached);
        }

        setUserRole(normalizedRole);
        setIsAuthenticated(true);

        // Update localStorage with normalized role
        setAuthData(token, normalizedRole, {
          first_name: userData.first_name || "",
          last_name: userData.last_name || "",
          email: userData.email || "",
          username: userData.username || "",
          id: userData.id || "",
        });

        // Pre-fetch complete data on app load (e.g. page refresh with valid token)
        triggerPrefetch(normalizedRole);
      } else {
        // Invalid role, logout
        handleLogout();
      }
    } catch (error: any) {
      const status = error.response?.status;
      
      // Handle 401/403 - Token expired or invalid
      if (status === 401 || status === 403) {
        handleLogout();
        return;
      }
      
      // Handle network errors - keep user logged in with cached credentials
      if (!error.response || error.code === 'ECONNABORTED' || error.message?.includes('Network Error')) {
        // Old sessions may have stored role "admin" for PlanetEye — remap from username.
        const cached = getUserData() ?? {};
        const fallbackRole = resolveAppUserRole({
          ...cached,
          username: cached.username || "",
          role: cached.role ?? { name: role },
        });
        const safeRole =
          String(cached.username ?? "").toLowerCase() === "planeteye"
            ? "planeteye"
            : fallbackRole || role;
        setUserRole(safeRole);
        setIsAuthenticated(true);
        if (safeRole !== role) {
          setAuthData(token, safeRole, cached);
        }
        setLoading(false);
        return;
      }
      
      // Handle other errors
      // For unknown errors, logout for security
      handleLogout();
    } finally {
      setLoading(false);
    }
  };

  const triggerPrefetch = (role: UserRole | null) => {
    try {
      pruneAppCache();
    } catch {
      // non-critical
    }
    // Pre-fetch all commonly used data on login/app load (non-blocking)
    // Loads complete data and stores in cache for fast representation
    prefetchAllData(setCached, null, role)
      .then((result) => {
        console.log('🚀 Pre-fetch result:', result);
      })
      .catch((err) => {
        console.warn('⚠️ Pre-fetch failed (non-critical):', err);
      });
  };

  const handleLoginSuccess = async (role: UserRole, token: string) => {
    const normalizedRole = role.toLowerCase() as UserRole;

    // Clear stale profile cache before prefetch — must happen before dashboard mounts.
    prepareFreshAuthSession();
    clearFarmerMyProfileInFlight();
    setAuthData(token, normalizedRole);

    // For farmer: prefetch profile BEFORE showing dashboard so fertilizer/irrigation
    // never render from a stale cache while the API fetch is still in flight.
    if (normalizedRole === "farmer") {
      await prefetchFarmerProfile(setCached);
    }

    setUserRole(normalizedRole);
    setIsAuthenticated(true);

    // For field officer: await agroStats prefetch so "View Field Plot" shows data instantly (no loading)
    if (normalizedRole === "fieldofficer") {
      const userData = getUserData();
      const fieldOfficerId = userData?.id;
      if (fieldOfficerId) {
        await prefetchFieldOfficerAgroStats(setCached, fieldOfficerId);
      }
    }

    // Manager: warm field-officer tree before dashboard so dropdowns are instant (no flash)
    if (normalizedRole === "manager") {
      await prefetchManagerFieldOfficers();
    }

    // Pre-fetch rest of data in background (non-blocking)
    triggerPrefetch(normalizedRole);

    // PlanetEye users land on Progress dashboard
    if (normalizedRole === "planeteye") {
      navigate("/dashboard?view=progressdashboard");
      return;
    }

    navigate("/dashboard");
  };

  const handleLogout = () => {
    // Clear in-memory app state (Soil Analysis, Fertilizer, selected plot, etc.) so next user doesn't see previous data
    clearAppStateOnLogout();
    // Clear ALL localStorage data (auth, cache, etc.)
    clearAllLocalStorage();

    setUserRole(null);
    setIsAuthenticated(false);
    navigate("/login");
  };

  // Show loading screen while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <CommonSpinner />
      </div>
    );
  }

  return (
    <Routes>
      {/* Login Route */}
      <Route
        path="/login"
        element={
          isAuthenticated ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <Login onLoginSuccess={handleLoginSuccess} />
          )
        }
      />

      {/* Account Deletion Info (Public) */}
      <Route path="/delete-account" element={<DeleteAccountInfo />} />

      {/* Dashboard Route */}
      <Route
        path="/dashboard"
        element={
          isAuthenticated && userRole ? (
            <App userRole={userRole} onLogout={handleLogout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Root Route */}
      <Route
        path="/"
        element={
          isAuthenticated ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Catch all route */}
      <Route
        path="*"
        element={
          isAuthenticated ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
};

const AppRoutes: React.FC = () => {
  return (
    <Router>
      <AppRoutesContent />
    </Router>
  );
};

export default AppRoutes;
