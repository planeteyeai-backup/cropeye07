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
  clearAuthData,
  clearAllLocalStorage,
  setAuthData,
  isValidToken,
  getUserData,
  isPlanetEyeDemoToken,
} from "../utils/auth";
import { getCurrentUser } from "../api";
import { initializeTokenRefresh } from "../utils/tokenManager";
import { useAppContext } from "../context/AppContext";
import {
  prefetchAllData,
  prefetchFarmerProfile,
  prefetchFieldOfficerAgroStats,
  prefetchManagerFieldOfficers,
} from "../services/prefetchService";

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
    // Check authentication status on app start
    const token = getAuthToken();
    const savedRole = getUserRole() as UserRole | null;

    if (token && savedRole) {
      if (isPlanetEyeDemoToken(token)) {
        setAuthData(token, "planeteye", getUserData());
        setUserRole("planeteye");
        setIsAuthenticated(true);
        setLoading(false);
        return;
      }
      // Validate token with backend
      validateToken(token, savedRole);
    } else {
      setLoading(false);
    }
  }, []);

  // Initialize token refresh when authenticated (skip demo session)
  useEffect(() => {
    if (isAuthenticated && userRole && !isPlanetEyeDemoToken(getAuthToken())) {
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

      if (isPlanetEyeDemoToken(token)) {
        setAuthData(token, "planeteye", getUserData());
        setUserRole("planeteye");
        setIsAuthenticated(true);
        setLoading(false);
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

      // Handle both string roles and numeric role_id
      let normalizedRole: UserRole;

      // Create role mapping
      const roleMap: { [key: number]: UserRole } = {
        1: "farmer",
        2: "fieldofficer",
        3: "manager",
        4: "owner",
      };

      if (
        userData.role &&
        typeof userData.role === "object" &&
        userData.role.name
      ) {
        // If role is an object with name property, use the name
        normalizedRole = userData.role.name.toLowerCase() as UserRole;
      } else if (
        userData.role &&
        typeof userData.role === "object" &&
        userData.role.id
      ) {
        // If role is an object with id property, map the id
        normalizedRole = roleMap[userData.role.id] || "farmer";
      } else if (userData.role && typeof userData.role === "string") {
        // If role is a string, use it directly
        normalizedRole = userData.role.toLowerCase() as UserRole;
      } else if (userData.role_id && typeof userData.role_id === "number") {
        // If role_id is a number, map it to role string
        normalizedRole = roleMap[userData.role_id] || "farmer";
      } else {
        // Fallback: check if role is already a number
        const roleId = userData.role || userData.role_id;
        if (typeof roleId === "number") {
          normalizedRole = roleMap[roleId] || "farmer";
        } else {
          // Invalid role, logout
          handleLogout();
          return;
        }
      }

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
      const errorMessage = error.response?.data?.detail || error.message;
      
      // Handle 401/403 - Token expired or invalid
      if (status === 401 || status === 403) {
        handleLogout();
        return;
      }
      
      // Handle network errors - keep user logged in with cached credentials
      if (!error.response || error.code === 'ECONNABORTED' || error.message?.includes('Network Error')) {
        setUserRole(role);
        setIsAuthenticated(true);
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
    const isDemoLogin = isPlanetEyeDemoToken(token);

    if (!isDemoLogin) {
      // Store authentication data using utility function
      setAuthData(token, normalizedRole);
    }

    // Update state
    setUserRole(normalizedRole);
    setIsAuthenticated(true);

    if (isDemoLogin) {
      navigate("/dashboard?view=progressdashboard");
      return;
    }

    // For farmer: await profile prefetch before navigate so dashboard loads fast (no "Loading farmer profile...")
    if (normalizedRole === "farmer") {
      await prefetchFarmerProfile(setCached);
    }

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
