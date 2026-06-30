import React, { useState, useEffect } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { DashboardGrid } from "./components/DashboardGrid";
import { jwtDecode } from "jwt-decode";

import OwnerFarmDash from "./components/OwnerFarmDash"; // Import for Owner
import OwnerHarvestDash from "./components/OwnerHarvestDash"; // Import for Owner
import ManagerHomeGrid from "./components/ManagerHomeGrid";
import OwnerHomeGrid from "./components/OwnerHomeGrid";
import { Addusers } from "./components/Addusers";
import { UserList } from "./components/userList";
import Contactuser from "./components/Contactuser";
import { Addvendor } from "./components/AddVendor";
import { VendorList } from "./components/Vendorlist";
import { Addorder } from "./components/Addorder";
import { OrderList } from "./components/orderlist";
import { AddStock } from "./components/AddStock";
import { StockList } from "./components/stocklist";
import { BookingList } from "./components/Bookinglist";
import AddBooking from "./components/AddBooking";
import { FarmList } from "./components/FarmList";
import CalendarView from "./components/CalendarView";
import MyList from "./components/MyList";
import TeamList from "./components/TeamList";
import FieldOfficerHomeGrid from "./components/FieldOfficerHomeGrid";
import FarmerHomeGrid from "./components/FarmerHomeGrid";
import Calendar from "./components/Calendar";
import AddFarm from "./components/Add Farm";
import TaskCalendar from "./components/TaskCalendar";
import ViewList from "./components/ViewList";
import { Tasklist } from "./components/Tasklist";
import { PestDisease } from "./components/pestt/Pest & Disease";
import Fertilizer from "./components/Fertilizer";
import Irrigation from "./components/Irrigation/Irrigation";
import BlogCard from "./components/BlogCard";
import AgricultureData from "./components/AgricultureData";
import Map from "./components/Map";
import FarmerDashboard from "./components/FarmerDashboard";
import ProgressBarDashboard from "./components/ProgressBarDashboard";
import ProgressGridDashboard from "./components/ProgressGridDashboard";
import { PROGRESS_NAV_EVENT } from "./components/progressbar/progressNavigation";
import OfficerDashboard from "./components/FarmCropStatus";
import AgroDashboard from "./components/AgroDash/AgroDashboard";
import ManagerFarmDash from "./components/ManagerFarmDash";
import HarvestDashboard from "./components/HarvestDashboard";
import Chatbot from "./components/Chatbot";
import MyProfile from "./components/MyProfile";
import { MessageCircle } from "lucide-react";
import { getUserData, isPlanetEyeDemoUser } from "./utils/auth";

enum View {
  Home = "home",
  ManagerHomeGrid = "ManagerHomeGrid",
  HarvestDashboard = "HarvestDashboard",
  Dashboard = "dashboard",
  AgroDashboard = "AgroDashboard",
  ManagerFarmDash = "ManagerFarmDash",
  OwnerFarmDash = "OwnerFarmDash",
  OwnerHarvestDash = "OwnerHarvestDash",
  AddUsers = "addusers",
  userList = "userlist",
  Contactuser = "Contactuser",
  Addvendor = "AddVendor",
  VendorList = "Vendorlist",
  Addorder = "Addorder",
  orderlist = "orderlist",
  Addstock = "Addstock",
  stocklist = "stocklist",
  AddBooking = "AddBooking",
  Bookinglist = "Bookinglist",
  FarmList = "farmlist",
  CalendarView = "CalendarView",
  MyList = "MyList",
  TeamList = "TeamList",
  Calendar = "Calendar",
  AddFarm = "AddFarm",
  TaskCalendar = "TaskCalendar",
  ViewList = "ViewList",
  Tasklist = "Tasklist",
  Fertilizer = "Fertilizer",
  Irrigation = "Irrigation",
  BlogCard = "BlogCard",
  PestDisease = "Pest & Disease",
  AgricultureData = "AgricultureData",
  Map = "Map",
  FarmerDashboard = "FarmerDashboard",
  ProgressDashboard = "ProgressDashboard",
  ProgressGrid = "ProgressGrid",
  FarmCropStatus = "FarmCropStatus",
  MyProfile = "MyProfile",
}

interface AppProps {
  userRole: "manager" | "admin" | "fieldofficer" | "farmer" | "owner" | "planeteye";
  onLogout: () => void;
}

/** Max views to keep mounted (prevents remount/refetch when navigating back) */
const VIEW_CACHE_SIZE = 5;

const App: React.FC<AppProps> = ({ userRole, onLogout }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentView, setCurrentView] = useState<View>(View.Home);
  const [cachedViews, setCachedViews] = useState<View[]>([View.Home]);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [expandedSidebarMenu, setExpandedSidebarMenu] = useState<string | null>(
    null
  );
  const [users, setUsers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [stocks, setStocks] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [selectedPlotName, setSelectedPlotName] = useState<string | null>(null);
  const [soilData, setSoilData] = useState({
    phValue: null as number | null,
    nitrogenValue: null as number | null,
    fertilityStatus: "Moderate",
  });
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);
  const [progressNavKey, setProgressNavKey] = useState(0);

  // NEW: Add currentUser state
  const [currentUser, setCurrentUser] = useState<{
    id: number;
    role: string;
    name: string;
  } | null>(null);

  // NEW: Get user from JWT token
  useEffect(() => {
    if (isPlanetEyeDemoUser()) {
      const demoUser = getUserData();
      setCurrentUser({
        id: 0,
        role: "planeteye",
        name: demoUser?.username || "planeteye",
      });
      return;
    }

    const token = localStorage.getItem("token");

    if (token) {
      try {
        const decoded: any = jwtDecode(token);

        setCurrentUser({
          id: decoded.user_id || decoded.id,
          role: decoded.role || userRole,
          name: decoded.username || decoded.first_name || "User",
        });
      } catch (error) {
        console.error("Error decoding token:", error);
        // Fallback for development/testing
        setCurrentUser({
          id: 3, // Default field officer ID for testing
          role: userRole,
          name: "Test User",
        });
      }
    } else {
      // No token - set default for testing
      setCurrentUser({
        id: 3,
        role: userRole,
        name: "Test User",
      });
    }
  }, [userRole]);

  // Handle URL-based routing on page load/refresh
  useEffect(() => {
    // Check for view parameter in URL search params or hash
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    const hash = window.location.hash.replace('#', '').replace('#/', '');
    
    // Priority: URL param > hash > default to Home
    if (viewParam) {
      handleRouteFromURL(viewParam);
    } else if (hash) {
      handleRouteFromURL(hash);
    }
    
    // Listen for hash changes (for hash-based routing)
    const handleHashChange = () => {
      const newHash = window.location.hash.replace('#/', '').replace('#', '');
      if (newHash) {
        handleRouteFromURL(newHash);
      }
    };
    
    // Listen for popstate (browser back/forward)
    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const viewParam = urlParams.get('view');
      if (viewParam) {
        handleRouteFromURL(viewParam);
      }
    };
    
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handlePopState);
    
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Map URL routes to View enum and ensure view is in cache
  const handleRouteFromURL = (route: string) => {
    const routeMap: Record<string, View> = {
      'agroclimatic': View.AgroDashboard,
      'agro-dashboard': View.AgroDashboard,
      'agrodashboard': View.AgroDashboard,
      'farm-crop-status': View.FarmCropStatus,
      'farmcropstatus': View.FarmCropStatus,
      'harvest-dashboard': View.HarvestDashboard,
      'harvestdashboard': View.HarvestDashboard,
      'manager-farm-dash': View.ManagerFarmDash,
      'managerfarmdash': View.ManagerFarmDash,
      'owner-farm-dash': View.OwnerFarmDash,
      'ownerfarmdash': View.OwnerFarmDash,
      'owner-harvest-dash': View.OwnerHarvestDash,
      'ownerharvestdash': View.OwnerHarvestDash,
      'farmer-dashboard': View.FarmerDashboard,
      'farmerdashboard': View.FarmerDashboard,
      'progress-dashboard': View.ProgressDashboard,
      'progressdashboard': View.ProgressDashboard,
      'progress-grid': View.ProgressGrid,
      'progressgrid': View.ProgressGrid,
      'map': View.Map,
      'fertilizer': View.Fertilizer,
      'irrigation': View.Irrigation,
      'pest-disease': View.PestDisease,
      'pestdisease': View.PestDisease,
      'add-farm': View.AddFarm,
      'addfarm': View.AddFarm,
      'calendar': View.Calendar,
      'task-calendar': View.TaskCalendar,
      'taskcalendar': View.TaskCalendar,
      'tasklist': View.Tasklist,
      'farmlist': View.FarmList,
      'userlist': View.userList,
      'addusers': View.AddUsers,
    };

    const view = routeMap[route.toLowerCase()];
    if (view) {
      setCurrentView(view);
      setCachedViews((prev) => {
        if (prev.includes(view)) return prev;
        const others = prev.filter((v) => v !== View.Home);
        const newOthers = [...others, view].slice(-(VIEW_CACHE_SIZE - 1));
        return [View.Home, ...newOthers];
      });
    }
  };

  const handleMenuSelect = (menu: string) => {
    setActiveSubmenu(null);

    let nextView = View.Home;

    switch (menu) {
      case "Farm Crop Status":
      case "farm-crop-status":
        // Use ManagerFarmDash for manager/owner, FarmCropStatus for field officer
        if (userRole === "owner") {
          nextView = View.OwnerFarmDash;
        } else if (userRole === "manager") {
          nextView = View.ManagerFarmDash;
        } else {
          nextView = View.FarmCropStatus;
        }
        break;
      case "Harvesting Planning":
        if (userRole === "owner") {
          nextView = View.OwnerHarvestDash;
        } else {
          nextView = View.HarvestDashboard;
        }
        break;
      case "ViewFarmerPlot":
        nextView = View.FarmCropStatus;
        break;
      case "Agroclimatic":
        nextView = View.AgroDashboard;
        break;
      case "Plot View":
        nextView = View.Dashboard;
        setActiveSubmenu(menu);
        break;
      case "Add User":
        nextView = View.AddUsers;
        break;
      case "User List":
        nextView = View.userList;
        break;
      case "Contactuser":
        nextView = View.Contactuser;
        break;
      case "Add Vendor":
        nextView = View.Addvendor;
        break;
      case "Vendor list":
        nextView = View.VendorList;
        // Component handles its own data fetching via useEffect
        break;
      case "Add order":
        nextView = View.Addorder;
        break;
      case "order list":
        nextView = View.orderlist;
        // Component handles its own data fetching via useEffect
        break;
      case "Add Stock":
        nextView = View.Addstock;
        break;
      case "stock list":
        nextView = View.stocklist;
        // Component handles its own data fetching via useEffect
        break;
      case "Add Booking":
        nextView = View.AddBooking;
        break;
      case "Booking List":
        nextView = View.Bookinglist;
        break;
      case "Farmlist":
        nextView = View.FarmList;
        break;
      case "CalendarView":
        nextView = View.CalendarView;
        break;
      case "MyList":
        nextView = View.MyList;
        break;
      case "Team List":
      case "Team Connect":
      case "TeamConnect":
        nextView = View.TeamList;
        break;
      case "Calendar":
        nextView = View.Calendar;
        break;
      case "AddFarm":
        nextView = View.AddFarm;
        break;
      case "TaskCalendar":
        nextView = View.TaskCalendar;
        break;
      case "ViewList":
        nextView = View.ViewList;
        break;
      case "Tasklist":
        nextView = View.Tasklist;
        break;
      case "Pest & Disease":
        nextView = View.PestDisease;
        break;
      case "Fertilizer":
        nextView = View.Fertilizer;
        break;
      case "Irrigation":
        nextView = View.Irrigation;
        break;
      case "BlogCard":
        nextView = View.BlogCard;
        break;
      case "AgricultureData":
        nextView = View.AgricultureData;
        break;
      case "Map":
        nextView = View.Map;
        break;
      case "FarmerDashboard":
        nextView = View.FarmerDashboard;
        break;
      case "Progress Dashboard":
        nextView = View.ProgressDashboard;
        break;
      case "Progress Grid":
        nextView = View.ProgressGrid;
        break;
      case "MyProfile":
        nextView = View.MyProfile;
        break;
      default:
        nextView = View.Home;
        break;
    }

    setCurrentView(nextView);
    setCachedViews((prev) => {
      if (prev.includes(nextView)) return prev;
      const others = prev.filter((v) => v !== View.Home);
      const newOthers = [...others, nextView].slice(-(VIEW_CACHE_SIZE - 1));
      return [View.Home, ...newOthers];
    });
    setIsSidebarOpen(false);
    
    // Update URL for refresh support
    const viewMap: Partial<Record<View, string>> = {
      [View.Home]: 'home',
      [View.AgroDashboard]: 'agrodashboard',
      [View.FarmCropStatus]: 'farmcropstatus',
      [View.HarvestDashboard]: 'harvestdashboard',
      [View.ManagerFarmDash]: 'managerfarmdash',
      [View.OwnerFarmDash]: 'ownerfarmdash',
      [View.OwnerHarvestDash]: 'ownerharvestdash',
      [View.FarmerDashboard]: 'farmerdashboard',
      [View.ProgressDashboard]: 'progressdashboard',
      [View.ProgressGrid]: 'progressgrid',
      [View.Map]: 'map',
      [View.Fertilizer]: 'fertilizer',
      [View.Irrigation]: 'irrigation',
      [View.PestDisease]: 'pestdisease',
      [View.AddFarm]: 'addfarm',
      [View.Calendar]: 'calendar',
      [View.TaskCalendar]: 'taskcalendar',
      [View.Tasklist]: 'tasklist',
      [View.FarmList]: 'farmlist',
      [View.userList]: 'userlist',
      [View.AddUsers]: 'addusers',
      [View.Dashboard]: 'dashboard',
      [View.ManagerHomeGrid]: 'managerhomegrid',
      [View.Addvendor]: 'addvendor',
      [View.VendorList]: 'vendorlist',
      [View.Addorder]: 'addorder',
      [View.orderlist]: 'orderlist',
      [View.Addstock]: 'addstock',
      [View.stocklist]: 'stocklist',
      [View.AddBooking]: 'addbooking',
      [View.Bookinglist]: 'bookinglist',
      [View.CalendarView]: 'calendarview',
      [View.MyList]: 'mylist',
      [View.TeamList]: 'teamlist',
      [View.ViewList]: 'viewlist',
      [View.BlogCard]: 'blogcard',
      [View.AgricultureData]: 'agriculturedata',
      [View.Contactuser]: 'contactuser',
    };
    
    const urlName = viewMap[nextView] || 'home';
    const newURL = `${window.location.pathname}?view=${urlName}`;
    window.history.pushState({ view: urlName }, '', newURL);
  };

  useEffect(() => {
    const openProgressDashboard = () => {
      setCurrentView(View.ProgressDashboard);
      setCachedViews((prev) => {
        if (prev.includes(View.ProgressDashboard)) return prev;
        const others = prev.filter((v) => v !== View.Home);
        return [View.Home, ...others, View.ProgressDashboard].slice(-VIEW_CACHE_SIZE);
      });
      setIsSidebarOpen(false);
      setProgressNavKey((k) => k + 1);
    };
    window.addEventListener(PROGRESS_NAV_EVENT, openProgressDashboard);
    return () => window.removeEventListener(PROGRESS_NAV_EVENT, openProgressDashboard);
  }, []);

  const handleHomeClick = () => {
    setCurrentView(View.Home);
    if (!cachedViews.includes(View.Home)) {
      setCachedViews((prev) => [View.Home, ...prev.filter((v) => v !== View.Home)].slice(0, VIEW_CACHE_SIZE));
    }
    setIsSidebarOpen(false);
    setActiveSubmenu(null);
  };

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => !prev);
  };

  const openSidebarWithMenu = (menuTitle: string) => {
    setIsSidebarOpen(true);
    setExpandedSidebarMenu(menuTitle);
    // Clear the expanded menu after a longer delay to allow the sidebar to open and expand
    setTimeout(() => {
      setExpandedSidebarMenu(null);
    }, 1000);
  };

  const handleSoilDataChange = (data: {
    plotName: string;
    phValue: number | null;
    nitrogenValue?: number | null;
    phStatistics?: { phh2o_0_5cm_mean_mean: number };
  }) => {
    setSoilData((prev) => ({
      ...prev,
      phValue: data.phValue,
      nitrogenValue:
        data.nitrogenValue !== undefined ? data.nitrogenValue : null,
    }));
    setSelectedPlotName(data.plotName || null);
  };

  const renderHomeGrid = () => {
    switch (userRole) {
      case "manager":
        return (
          <ManagerHomeGrid
            onMenuClick={handleMenuSelect}
            onOpenSidebarWithMenu={openSidebarWithMenu}
          />
        );
      case "owner":
        return <OwnerHomeGrid onMenuClick={handleMenuSelect} />;
      case "fieldofficer":
        return (
          <FieldOfficerHomeGrid
            onMenuClick={handleMenuSelect}
            onOpenSidebarWithMenu={openSidebarWithMenu}
          />
        );
      case "farmer":
        return <FarmerHomeGrid />;
      case "planeteye":
        return (
          <ProgressBarDashboard key={progressNavKey} navKey={progressNavKey} />
        );
      default:
        return <div>Invalid user role: {userRole}</div>;
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header toggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} onNavigate={handleMenuSelect} />

      <div className="flex flex-1">
        <div
          className={`fixed top-0 left-0 h-full z-40 transition-all duration-300 ease-in-out ${
            isSidebarOpen ? "w-64" : "w-0"
          } overflow-hidden`}
        >
          <Sidebar
            isOpen={isSidebarOpen}
            onMenuSelect={handleMenuSelect}
            onHomeClick={handleHomeClick}
            onLogout={onLogout}
            userRole={userRole}
            expandedMenu={expandedSidebarMenu}
          />
        </div>

        <main
          className={`flex-1 transition-all duration-300 ease-in-out ml-0 ${
            isSidebarOpen ? "ml-64" : "ml-0"
          } overflow-auto`}
        >
          <div className="w-full h-full">
            {cachedViews.includes(View.Home) && (
              <div style={{ display: currentView === View.Home ? 'block' : 'none' }}>{renderHomeGrid()}</div>
            )}

            {cachedViews.includes(View.Dashboard) && activeSubmenu && (
              <div style={{ display: currentView === View.Dashboard ? 'block' : 'none' }}>
                <DashboardGrid submenu={activeSubmenu} userRole={userRole} onClose={() => setActiveSubmenu(null)} />
              </div>
            )}

            {cachedViews.includes(View.AddUsers) && (
              <div style={{ display: currentView === View.AddUsers ? 'block' : 'none' }}>
                <Addusers setUsers={setUsers} users={users} />
              </div>
            )}

            {cachedViews.includes(View.userList) && currentUser && (
              <div style={{ display: currentView === View.userList ? 'block' : 'none' }}>
                <UserList
                  currentUserId={currentUser.id}
                  currentUserRole={
                    currentUser.role as "owner" | "manager" | "fieldofficer" | "farmer"
                  }
                />
              </div>
            )}

            {cachedViews.includes(View.Contactuser) && (
              <div style={{ display: currentView === View.Contactuser ? 'block' : 'none' }}>
                <Contactuser users={users} setUsers={setUsers} />
              </div>
            )}

            {cachedViews.includes(View.Addvendor) && (
              <div style={{ display: currentView === View.Addvendor ? 'block' : 'none' }}>
                <Addvendor setUsers={setUsers} users={users} />
              </div>
            )}

            {cachedViews.includes(View.VendorList) && (
              <div style={{ display: currentView === View.VendorList ? 'block' : 'none' }}>
                <VendorList users={users} setUsers={setUsers} />
              </div>
            )}

            {cachedViews.includes(View.Addorder) && (
              <div style={{ display: currentView === View.Addorder ? 'block' : 'none' }}>
                <Addorder setItems={setItems} items={items} />
              </div>
            )}

            {cachedViews.includes(View.orderlist) && (
              <div style={{ display: currentView === View.orderlist ? 'block' : 'none' }}>
                <OrderList items={items} setItems={setItems} />
              </div>
            )}

            {cachedViews.includes(View.Addstock) && (
              <div style={{ display: currentView === View.Addstock ? 'block' : 'none' }}>
                <AddStock setStocks={setStocks} />
              </div>
            )}

            {cachedViews.includes(View.stocklist) && (
              <div style={{ display: currentView === View.stocklist ? 'block' : 'none' }}>
                <StockList stocks={stocks} setStocks={setStocks} />
              </div>
            )}

            {cachedViews.includes(View.AddBooking) && (
              <div style={{ display: currentView === View.AddBooking ? 'block' : 'none' }}>
                <AddBooking bookings={bookings} setBookings={setBookings} />
              </div>
            )}

            {cachedViews.includes(View.Bookinglist) && (
              <div style={{ display: currentView === View.Bookinglist ? 'block' : 'none' }}>
                <BookingList bookings={bookings} setBookings={setBookings} />
              </div>
            )}

            {cachedViews.includes(View.FarmList) && (
              <div style={{ display: currentView === View.FarmList ? 'block' : 'none' }}>
                <FarmList users={users} setUsers={setUsers} />
              </div>
            )}

            {cachedViews.includes(View.CalendarView) && (
              <div style={{ display: currentView === View.CalendarView ? 'block' : 'none' }}>
                <CalendarView />
              </div>
            )}

            {cachedViews.includes(View.MyList) && (
              <div style={{ display: currentView === View.MyList ? 'block' : 'none' }}>
                <MyList />
              </div>
            )}

            {cachedViews.includes(View.TeamList) && (
              <div style={{ display: currentView === View.TeamList ? 'block' : 'none' }}>
                <TeamList />
              </div>
            )}

            {cachedViews.includes(View.Calendar) && currentUser && (
              <div style={{ display: currentView === View.Calendar ? 'block' : 'none' }}>
                <Calendar
                  currentUserId={currentUser.id}
                  currentUserRole={currentUser.role as "manager" | "fieldofficer" | "farmer"}
                />
              </div>
            )}

            {cachedViews.includes(View.AddFarm) && (
              <div style={{ display: currentView === View.AddFarm ? 'block' : 'none' }}>
                <AddFarm />
              </div>
            )}

            {cachedViews.includes(View.TaskCalendar) && currentUser && (
              <div style={{ display: currentView === View.TaskCalendar ? 'block' : 'none' }}>
                <TaskCalendar
                  currentUserId={currentUser.id}
                  currentUserRole={currentUser.role as "manager" | "fieldofficer" | "farmer"}
                />
              </div>
            )}

            {cachedViews.includes(View.ViewList) && currentUser && (
              <div style={{ display: currentView === View.ViewList ? 'block' : 'none' }}>
                <ViewList
                  currentUserId={currentUser.id}
                  currentUserRole={currentUser.role as "manager" | "fieldofficer" | "farmer"}
                  currentUserName={currentUser.name}
                />
              </div>
            )}

            {cachedViews.includes(View.Tasklist) && currentUser && (
              <div style={{ display: currentView === View.Tasklist ? 'block' : 'none' }}>
                <Tasklist
                  currentUserId={currentUser.id}
                  currentUserRole={currentUser.role as "manager" | "fieldofficer" | "farmer"}
                  currentUserName={currentUser.name}
                />
              </div>
            )}

            {cachedViews.includes(View.PestDisease) && (
              <div style={{ display: currentView === View.PestDisease ? 'block' : 'none' }}>
                <PestDisease />
              </div>
            )}

            {cachedViews.includes(View.Fertilizer) && (
              <div style={{ display: currentView === View.Fertilizer ? 'block' : 'none' }}>
                <Fertilizer />
              </div>
            )}

            {cachedViews.includes(View.Irrigation) && (
              <div style={{ display: currentView === View.Irrigation ? 'block' : 'none' }}>
                <Irrigation selectedPlotName={selectedPlotName} />
              </div>
            )}

            {cachedViews.includes(View.BlogCard) && (
              <div style={{ display: currentView === View.BlogCard ? 'block' : 'none' }}>
                <BlogCard />
              </div>
            )}

            {cachedViews.includes(View.AgricultureData) && (
              <div style={{ display: currentView === View.AgricultureData ? 'block' : 'none' }}>
                <AgricultureData />
              </div>
            )}

            {cachedViews.includes(View.Map) && (
              <div style={{ display: currentView === View.Map ? 'block' : 'none' }}>
                <Map onSoilDataChange={handleSoilDataChange} />
              </div>
            )}

            {cachedViews.includes(View.FarmerDashboard) && (
              <div style={{ display: currentView === View.FarmerDashboard ? 'block' : 'none' }}>
                <FarmerDashboard />
              </div>
            )}

            {cachedViews.includes(View.ProgressDashboard) && (
              <div style={{ display: currentView === View.ProgressDashboard ? 'block' : 'none' }}>
                <ProgressBarDashboard key={progressNavKey} navKey={progressNavKey} />
              </div>
            )}

            {cachedViews.includes(View.ProgressGrid) && (
              <div style={{ display: currentView === View.ProgressGrid ? 'block' : 'none' }}>
                <ProgressGridDashboard />
              </div>
            )}

            {cachedViews.includes(View.MyProfile) && (
              <div style={{ display: currentView === View.MyProfile ? 'block' : 'none' }}>
                <MyProfile onClose={() => setCurrentView(View.Home)} />
              </div>
            )}

            {cachedViews.includes(View.FarmCropStatus) && (
              <div style={{ display: currentView === View.FarmCropStatus ? 'block' : 'none' }}>
                <OfficerDashboard />
              </div>
            )}

            {cachedViews.includes(View.ManagerFarmDash) && (
              <div style={{ display: currentView === View.ManagerFarmDash ? 'block' : 'none' }}>
                <ManagerFarmDash />
              </div>
            )}

            {cachedViews.includes(View.AgroDashboard) && (
              <div style={{ display: currentView === View.AgroDashboard ? 'block' : 'none' }}>
                <AgroDashboard />
              </div>
            )}

            {cachedViews.includes(View.HarvestDashboard) && (
              <div style={{ display: currentView === View.HarvestDashboard ? 'block' : 'none' }}>
                <HarvestDashboard />
              </div>
            )}

            {cachedViews.includes(View.OwnerFarmDash) && (
              <div style={{ display: currentView === View.OwnerFarmDash ? 'block' : 'none' }}>
                <OwnerFarmDash />
              </div>
            )}

            {cachedViews.includes(View.OwnerHarvestDash) && (
              <div style={{ display: currentView === View.OwnerHarvestDash ? 'block' : 'none' }}>
                <OwnerHarvestDash />
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Global Chatbot Component - Single Frame Design */}
      <Chatbot 
        isOpen={isChatbotOpen} 
        onClose={() => setIsChatbotOpen(false)}
        userRole={userRole}
      />

      {/* Floating Button - Only show when chatbot is closed */}
      {!isChatbotOpen && (
        <button
          onClick={() => setIsChatbotOpen(true)}
          className="fixed bottom-6 right-6 z-[99998] bg-gradient-to-r from-green-600 to-emerald-600 text-white p-4 rounded-full shadow-2xl hover:shadow-green-500/50 transition-all duration-300 hover:scale-110 active:scale-95 animate-bounce"
          aria-label="Open Chatbot"
          title="Open CropEye Assistant"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}
    </div>
  );
};

export default App;