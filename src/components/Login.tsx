
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Satellite, Leaf, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { setAuthData, setRefreshToken } from '../utils/auth';
import { getFarmerMyProfile, login, loginFarmerPlot, loginFastApi, setAuthToken as setApiAuthToken, setFastApiAuthToken } from '../api';

export type UserRole = "manager" | "admin" | "fieldofficer" | "farmer" | "owner";

interface LoginProps {
  onLoginSuccess: (role: UserRole, token: string) => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [phone_number, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // COMMENTED OUT: Send OTP to the provided email
  // const handleSendOtp = async (e: React.FormEvent) => {
  //   e.preventDefault();
  //   setLoading(true);
  //   setError('');

  //   try {
  //     const response = await fetch('http://192.168.41.51:8000/api/otp/', {
  //       method: 'POST',
  //       headers: {
  //         'Content-Type': 'application/json',
  //       },
  //       body: JSON.stringify({ 
  //         email: identifier.trim()
  //       }),
  //     });

  //     const responseText = await response.text();
      
  //     if (!response.ok) {
  //       throw new Error(responseText || 'Error sending OTP');
  //     }

  //     // Successfully sent OTP
  //     setStep('otp');
  //     setError('');
      
  //   } catch (err: any) {
  //     console.error('OTP sending error:', err);
  //     setError(err.message || 'Failed to send OTP. Please try again.');
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  // COMMENTED OUT: Verify OTP and authenticate user
  // const handleVerifyOtp = async (e: React.FormEvent) => {
  //   e.preventDefault();
  //   setLoading(true);
  //   setError('');

  //   try {
  //     const response = await fetch('http://192.168.41.51:8000/api/verify-otp/', {
  //       method: 'POST',
  //       headers: {
  //         'Content-Type': 'application/json',
  //       },
  //       body: JSON.stringify({ 
  //         email: identifier.trim(),
  //         otp: otp.trim()
  //       }),
  //     });

  //     const responseText = await response.text();
      
  //     if (!response.ok) {
  //       throw new Error(responseText || 'OTP verification failed');
  //     }

  //     const result = JSON.parse(responseText);
  //     const token = result.access || result.token;
      
  //     if (!token) {
  //       throw new Error('No authentication token received');
  //     }

  //     // Fetch user information
  //     const userResponse = await fetch('http://192.168.41.51:8000/api/users/me/', {
  //       headers: {
  //         'Authorization': `Bearer ${token}`,
  //         'Content-Type': 'application/json',
  //       },
  //     });

  //     if (!userResponse.ok) {
  //       throw new Error('Failed to fetch user information');
  //     }

  //     const userData = await userResponse.json();
  //     console.log('User data received:', userData); // Debug log
  //     console.log('userData.role:', userData.role, 'type:', typeof userData.role);
  //     console.log('userData.role_id:', userData.role_id, 'type:', typeof userData.role_id);
      
  //     // Handle both string roles and numeric role_id
  //     let userRole: UserRole;
      
  //     // Create role mapping
  //     const roleMap: { [key: number]: UserRole } = {
  //       1: 'farmer',
  //       2: 'fieldofficer', 
  //       3: 'manager',
  //       4: 'owner'
  //     };
      
  //     if (userData.role && typeof userData.role === 'object' && userData.role.name) {
  //       // If role is an object with name property, use the name
  //       userRole = userData.role.name.toLowerCase() as UserRole;
  //       console.log('Using role object name:', userRole);
  //     } else if (userData.role && typeof userData.role === 'object' && userData.role.id) {
  //       // If role is an object with id property, map the id
  //       userRole = roleMap[userData.role.id] || 'farmer';
  //       console.log('Using role object id mapping:', userData.role.id, '->', userRole);
  //     } else if (userData.role && typeof userData.role === 'string') {
  //       // If role is a string, use it directly
  //       userRole = userData.role.toLowerCase() as UserRole;
  //       console.log('Using string role:', userRole);
  //     } else if (userData.role_id && typeof userData.role_id === 'number') {
  //       // If role_id is a number, map it to role string
  //       userRole = roleMap[userData.role_id] || 'farmer';
  //       console.log('Using role_id mapping:', userData.role_id, '->', userRole);
  //     } else if (userData.role && typeof userData.role === 'number') {
  //       // If role is a number, map it to role string
  //       userRole = roleMap[userData.role] || 'farmer';
  //       console.log('Using role number mapping:', userData.role, '->', userRole);
  //     } else {
  //       // Log all available properties for debugging
  //       console.log('All userData properties:', Object.keys(userData));
  //       console.log('Full userData object:', userData);
        
  //       // Try to find any role-related property
  //       const possibleRoleKeys = ['role', 'role_id', 'user_role', 'user_type', 'type'];
  //       let foundRole = null;
        
  //       for (const key of possibleRoleKeys) {
  //         if (userData[key] !== undefined) {
  //           console.log(`Found ${key}:`, userData[key], 'type:', typeof userData[key]);
  //           if (typeof userData[key] === 'number' && roleMap[userData[key]]) {
  //             foundRole = roleMap[userData[key]];
  //             break;
  //           } else if (typeof userData[key] === 'string') {
  //             const lowerRole = userData[key].toLowerCase();
  //             if (['farmer', 'fieldofficer', 'manager', 'admin', 'owner'].includes(lowerRole)) {
  //               foundRole = lowerRole;
  //               break;
  //             }
  //           }
  //         }
  //       }
        
  //       if (foundRole) {
  //         userRole = foundRole as UserRole;
  //         console.log('Found role through property search:', foundRole);
  //       } else {
  //         console.error('Could not determine user role from userData:', userData);
  //         throw new Error(`Invalid user role format. Available data: ${JSON.stringify(userData)}`);
  //       }
  //     }

  //     // Validate role
  //     if (!userRole || !['manager', 'admin', 'fieldofficer', 'farmer', 'owner'].includes(userRole)) {
  //       throw new Error('Invalid user role');
  //     }

  //     // Store all authentication data using the utility function
  //     const userDataToStore = {
  //       first_name: userData.first_name || '',
  //       last_name: userData.last_name || '',
  //       email: userData.email || identifier,
  //       username: userData.username || '',
  //       id: userData.id || ''
  //     };
      
  //     console.log('🔐 Storing authentication data:', {
  //       token: token ? `${token.substring(0, 20)}...` : 'null',
  //       role: userRole,
  //       userData: userDataToStore
  //     });
      
  //     setAuthData(token, userRole, userDataToStore);
      
  //     // Verify token was stored
  //     const storedToken = localStorage.getItem('token');
  //     console.log('✅ Token stored verification:', storedToken ? 'Token stored successfully' : 'Token storage failed');
      
  //     // Success - call the callback with role and token
  //     onLoginSuccess(userRole, token);

  //   } catch (err: any) {
  //     console.error('OTP verification error:', err);
  //     setError(err.message || 'OTP verification failed. Please try again.');
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  // NEW: Username and Password Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const identifier = phone_number.trim();
      const pass = password.trim();

      // Keep existing login exactly as-is (phone_number + password on Django).
      const response = await login(identifier, pass);
      const result = response.data;

      const token = result.access || result.token;
      const refreshToken = result.refresh;

      if (!token) {
        throw new Error('No authentication token received');
      }

      const userData = result.user;

      let userRole: UserRole;

      if (userData.role && typeof userData.role === 'object' && userData.role.name) {
        userRole = userData.role.name.toLowerCase() as UserRole;
      } else if (userData.role && typeof userData.role === 'object' && userData.role.id) {
        const roleMap: { [key: number]: UserRole } = {
          1: 'farmer',
          2: 'fieldofficer',
          3: 'manager',
          4: 'owner'
        };
        userRole = roleMap[userData.role.id] || 'farmer';
      } else {
        userRole = 'farmer';
      }

      if (!userRole || !['manager', 'admin', 'fieldofficer', 'farmer', 'owner'].includes(userRole)) {
        throw new Error('Invalid user role');
      }

      const userDataToStore = {
        first_name: userData.first_name || '',
        last_name: userData.last_name || '',
        phone_number: userData.phone_number || identifier,
        username: userData.username || identifier,
        id: userData.id || ''
      };

      if (refreshToken) {
        setRefreshToken(refreshToken);
      }

      setAuthData(token, userRole, userDataToStore, refreshToken);
      setApiAuthToken(token);

      // After login: obtain FastAPI access_token (required for microservices).
      // - Farmer: use plot's fastapi_plot_id as username/password
      // - Other roles: use admin/admin1234
      try {
        if (userRole === "farmer") {
          const profRes = await getFarmerMyProfile();
          const plots = (profRes as any)?.data?.plots;
          const fastapiPlotId =
            Array.isArray(plots) && plots.length > 0
              ? (plots[0]?.fastapi_plot_id || plots[0]?.farm_uid || plots[0]?.plot_id || "")
              : "";

          const plotLoginId = String(fastapiPlotId || identifier).trim();
          const fastapiRes = await loginFarmerPlot(plotLoginId);
          const fastToken = (fastapiRes.data as any)?.access_token;
          if (fastToken) setFastApiAuthToken(fastToken);
        } else {
          const fastapiRes = await loginFastApi("admin", "admin123");
          const fastToken = (fastapiRes.data as any)?.access_token;
          if (fastToken) setFastApiAuthToken(fastToken);
        }
      } catch (err) {
        // If FastAPI token fetch fails, continue with the existing token
        console.error("FastAPI login failed:", err);
      }

      onLoginSuccess(userRole, token);

    } catch (err: any) {
      console.error('❌ Login error:', err);
      
      // Handle different types of errors
      if (err.response) {
        // Server responded with error status
        const status = err.response.status;
        const data = err.response.data;
        
        console.error('Server error response:', { status, data });
        
        if (status === 400) {
          setError('Invalid phone_number or password. Please check your credentials.');
        } else if (status === 401) {
          setError('Authentication failed. Please check your phone_number and password.');
        } else if (status === 403) {
          setError('Access denied. Please contact your administrator.');
        } else if (status >= 500) {
          setError('Server error. Please try again later.');
        } else {
          setError(data?.detail || data?.message || `Login failed (${status})`);
        }
      } else if (err.request) {
        // Network error      
        console.error('Network error:', err.request);
        setError('Network error. Please check your internet connection.');
      } else {
        // Other error
        setError(err.message || 'Login failed. Please check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  // COMMENTED OUT: handleBackToEmail function (no longer needed)
  // const handleBackToEmail = () => {
  //   setStep('input');
  //   setOtp('');
  //   setError('');
  // };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 relative overflow-hidden">
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.4 }}
      style={{
        backgroundImage: `url('/icons/sugarcane main slide.jpg')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
      className="absolute inset-0"
    />
   <div className="absolute top-0 left-0 w-full flex justify-center items-center p-2 md:p-4 z-20">
<img
  src="/icons/cropw.png"
  alt="SmartCropLogo"
  className="w-56 h-48 md:w-72 md:h-60 object-contain max-w-[60vw] md:max-w-[288px]"
  style={{ maxWidth: '60vw', height: 'auto' }}
/>
</div>

<div className="relative min-h-screen flex flex-col md:flex-row items-center justify-center p-1 sm:p-2 md:p-4 overflow-hidden pt-25">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl w-full max-w-5xl flex flex-col md:flex-row overflow-hidden"
        >
          <motion.div
            initial={{ x: -50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="w-full md:w-1/2 bg-emerald-600 p-6 md:p-12 flex flex-col justify-center items-center text-white relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-[url('/icons/sugarcane-plant.jpg')] bg-cover bg-center opacity-10" />
            <div className="relative z-10">
            <div className="flex items-center justify-center mb-8">
                <h1 className="text-4xl font-bold tracking-wide">CROPEYE</h1>
             </div>
            <p className="text-lg text-emerald-50 mb-6 text-center">Welcome to the future of agriculture</p>
              <div className="flex items-center justify-center space-x-2">
                <Leaf className="w-5 h-5" />
                <span>Intelligent Farming Solutions</span>
              </div>
            </div>
          </motion.div>
          {/* Right Panel - Login Form */}
          <div className="w-full md:w-1/2 p-6 md:p-12 ">
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              style={{display: 'flex',flexDirection: 'column', justifyContent: 'center', alignItems: 'center'}}
            >
              <h3 className="text-3xl font-bold text-gray-800 mb-8 text-center">
                Login
              </h3>

              {/* Error Display */}
              {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                  {error}
                </div>
              )}

              {/* Login Form */}
              <form onSubmit={handleLogin} className="space-y-6 w-[50%]">
                    <div className="relative">
                      <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-white focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500">
                        <Mail className="w-5 h-5 mr-3 text-gray-500" />
                        <input
                          type="phone_number"
                      placeholder="Enter phone_number"
                      value={phone_number}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                          className="w-full outline-none text-gray-700"
                          required
                          disabled={loading}
                        />
                      </div>
                    </div>                   
                    <div className="relative">
                      <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-white focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500">
                    <Lock className="w-5 h-5 mr-3 text-gray-500" />
                        <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full outline-none text-gray-700 pr-10"
                          required
                          disabled={loading}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="ml-2 p-1 text-gray-500 hover:text-gray-700 focus:outline-none transition-colors"
                          disabled={loading}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? (
                            <EyeOff className="w-5 h-5" />
                          ) : (
                            <Eye className="w-5 h-5" />
                          )}
                        </button>
                      </div>
                    </div>
                    
                    <button
                      type="submit"
                  disabled={loading || !phone_number.trim() || !password.trim()}
                      className="w-full bg-emerald-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {loading ? (
                        <div className="flex items-center justify-center">
                          <Satellite className="w-5 h-5 animate-spin mr-2" />
                      Submitting...
                        </div>
                      ) : (
                    'Submit'
                      )}
                    </button>
              </form>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Login;