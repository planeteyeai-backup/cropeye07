import React, { useState } from 'react';
import {
  Users,
  Calendar,
  BarChart3,
  Home,
  List,
  ShoppingBag,
  Book,
  LogOut,
  Cloud,
  LandPlot,
  Route,
  LayoutGrid,
} from 'lucide-react';
import { BiWater } from 'react-icons/bi';
import { GiGrowth, GiSugarCane } from 'react-icons/gi';
import { MdPestControl } from 'react-icons/md';
import { getUserData, getUserRole } from '../utils/auth';

interface SidebarProps {
  isOpen: boolean;
  onMenuSelect: (menu: string) => void;
  onHomeClick: () => void;
  onLogout: () => void;
  userRole: 'farmer' | 'admin' | 'fieldofficer' | 'manager' | 'owner';
  expandedMenu?: string | null; // Menu to expand when sidebar opens
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onMenuSelect,
  onHomeClick,
  onLogout,
  userRole,
  expandedMenu,
}) => {
  const [openMenus, setOpenMenus] = useState<string[]>([]);

  // Get current user data
  const currentUser = getUserData();
  const currentUserRole = getUserRole();
  const username = currentUser?.username || currentUser?.first_name || 'User';
  const displayRole = currentUserRole || userRole || '';

  // Effect to expand a specific menu when expandedMenu prop changes
  React.useEffect(() => {
    if (expandedMenu && !openMenus.includes(expandedMenu)) {
      setOpenMenus(prev => [...prev, expandedMenu]);
    }
  }, [expandedMenu, openMenus]);

  const toggleSubmenu = (title: string) => {
    setOpenMenus((prev) =>
      prev.includes(title)
        ? prev.filter((t) => t !== title)
        : [...prev, title]
    );
  };

  const renderMenu = (title: string, icon: JSX.Element, submenu?: string[]) => {
    const isMenuOpen = openMenus.includes(title);

    return (
      <div key={title}>
        <div
          className="flex items-center justify-between px-4 py-2 hover:bg-gray-200 cursor-pointer"
          onClick={() => (submenu ? toggleSubmenu(title) : onMenuSelect(title))}
        >
          <div className="flex items-center space-x-2">
            {icon}
            <span className="text-gray-700">{title}</span>
          </div>
          {submenu && <span>{isMenuOpen ? '▾' : '▸'}</span>}
        </div>
        {submenu && isMenuOpen && (
          <div className="ml-6">
            {submenu.map((sub) => (
              <div
                key={sub}
                className="py-1 cursor-pointer hover:text-blue-600"
                onClick={() => onMenuSelect(sub)}
              >
                {sub}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };


  
  const getMenuItems = () => {
    switch (userRole) {
      case 'farmer':
        return [
          //  renderMenu('Progress Dashboard', <Route size={20} />),
          //  renderMenu('Progress Grid', <LayoutGrid size={20} />),
          renderMenu('FarmerDashboard', <BarChart3 size={20} />),
          renderMenu('MyTask', <Calendar size={20} />, ['Calendar', 'ViewList']),
          renderMenu('Irrigation', <BiWater size={20} />),
          renderMenu('Pest & Disease', <MdPestControl size={20} />),
          renderMenu('Fertilizer', <GiGrowth size={20} />),
          renderMenu('Contactuser', <Users size={20} />,),

          // renderMenu('BlogCard',<GiPriceTag size={20}/>),
        ];
      case 'admin':
        return [
          renderMenu('Farm Crop Status', <BarChart3 size={20} />),
          renderMenu('Harvesting Planning', <GiSugarCane size={20} />),
          renderMenu('Agroclimatic', <Cloud size={20} />),
        //  renderMenu('Resources', <ShoppingBag size={20} />),
          // renderMenu('Plot Birde View', <BarChart3 size={20} />),
          renderMenu('Team Connect', <List size={20} />),
          renderMenu('User Desk', <Users size={20} />, ['Contactuser']),
          
        ];
      case 'owner':
        return [
          renderMenu('Farm Crop Status', <BarChart3 size={20} />),
          renderMenu('Harvesting Planning', <GiSugarCane size={20} />),
          renderMenu('Agroclimatic', <Cloud size={20} />),
        //  renderMenu('Resources', <ShoppingBag size={20} />),
          // renderMenu('Plot Birde View', <BarChart3 size={20} />),
          renderMenu('Team Connect', <List size={20} />),
          renderMenu('Contactuser', <Users size={20} />,),
          
        ];
      case 'fieldofficer':
        return [
          renderMenu('ViewFarmerPlot', <LandPlot size={20}  />),
          renderMenu('User Desk', <Users size={20} />, ['AddFarm', 'Farmlist','Contactuser']),
          renderMenu('MyTask', <Calendar size={20} />, ['TaskCalendar', 'Tasklist']),
          renderMenu('Resoucres Planning', <ShoppingBag size={20} />, [
            'Add Vendor',
            'Vendor list',
            'Add order',
            'order list',
            'Add Stock',
            'stock list',
          ]),
          renderMenu('Plan & Book', <Calendar size={20} />, ['Add Booking', 'Booking List']),
        ];
      case 'manager':
        return [
          renderMenu('Farm Crop Status', <BarChart3 size={20} />),
          renderMenu('Harvesting Planning', <GiSugarCane size={20} />),
          renderMenu('Agroclimatic', <Cloud size={20} />),
          renderMenu('UserDesk', <Users size={20} />, [
            'Add User',
            'User List',
            'Contactuser',
          ]),
          renderMenu('MyTask', <Calendar size={20} />, ['CalendarView', 'MyList']),
          renderMenu('Team Connect', <List size={20} />),
          renderMenu('Resoucres Planning', <ShoppingBag size={20} />, [
            'Add Vendor',
            'Vendor list',
            'Add order',
            'order list',
            'Add Stock',
            'stock list',
          ]),
          renderMenu('Plan&Book', <Book size={20} />, ['Add Booking', 'Booking List']),
        ];
      default:
        return [];
    }
  };

  // Check if logout should be shown (for all roles including farmer)
  const shouldShowLogout = ['farmer', 'fieldofficer', 'manager', 'owner', 'admin'].includes(userRole);

  return (
    <aside
      className={`fixed top-0 left-0 h-full w-64 bg-white shadow-lg flex flex-col transition-transform duration-300 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      
      <div className="p-4 border-b flex items-center justify-between">
        <img 
          src="/icons/CROPEYE Updated.png" 
          alt="CROPEYE Logo" 
          className="h-8 w-auto object-contain"
        />
        <button onClick={onHomeClick} className="text-gray-600 hover:text-gray-900">
          <Home size={20} />
        </button>
      </div>

      {/* User Info Section - Show for all roles */}
      {shouldShowLogout && (
        <div className="p-4 border-b bg-gray-50">
          <div className="flex flex-col space-y-1">
            <div className="text-sm font-semibold text-gray-800">
              {username}
            </div>
            <div className="text-xs text-gray-600 capitalize">
              {displayRole}
            </div>
          </div>
        </div>
      )}

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {getMenuItems()}
      </nav>

      {/* Logout Button - Show for all roles including farmer */}
      {shouldShowLogout && (
        <div
          className="p-4 border-t flex items-center space-x-2 hover:bg-gray-100 cursor-pointer"
          onClick={onLogout}
        >
          <LogOut size={20} className="text-gray-600" />
          <span className="text-gray-700 font-medium">Logout</span>
        </div>
      )}
    </aside>
  );
};
