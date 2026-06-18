// import React, { useState } from 'react';
// import { Download, Edit, Search, Trash2, Save, X } from 'lucide-react';

// interface User {
//   id: number;
//   userName: string;
//   firstname: string;
//   lastname: string;
//   email: string;
//   phoneNumber: string;
//   address: string;
//   password: string;
//   role: string;
// }

// interface UserListProps {
//   users: User[];
//   setUsers: React.Dispatch<React.SetStateAction<User[]>>;
// }

// export const UserList: React.FC<UserListProps> = ({ users, setUsers }) => {
//   const [searchTerm, setSearchTerm] = useState('');
//   const [currentPage, setCurrentPage] = useState(1);
//   const ITEMS_PER_PAGE = 5;
//   const [editId, setEditId] = useState<number | null>(null);
//   const [editFormData, setEditFormData] = useState<Partial<User>>({});

//   const handleEdit = (id: number) => {
//     setEditId(id);
//     const user = users.find(u => u.id === id);
//     if (user) setEditFormData({ ...user });
//   };

//   const handleCancel = () => {
//     setEditId(null);
//     setEditFormData({});
//   };

//   const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
//     const { name, value } = e.target;
//     setEditFormData(prev => ({ ...prev, [name]: value }));
//   };

//   const handleSave = () => {
//     if (editId === null) return;
//     setUsers(users.map(user => 
//       user.id === editId ? { ...user, ...editFormData } : user
//     ));
//     setEditId(null);
//     setEditFormData({});
//   };

//   const handleDelete = (id: number) => {
//     if (window.confirm('Are you sure you want to delete this user?')) {
//       setUsers(users.filter(user => user.id !== id));
//     }
//   };

//   const handleDownload = () => {
//     const csv = [
//       ['User Name', 'First Name', 'Last Name', 'Email', 'Phone Number', 'Address', 'Role', 'Password'],
//       ...users.map(({ userName, firstname, lastname, email, phoneNumber, address, role, password }) => [
//         userName, firstname, lastname, email, phoneNumber, address, role, password
//       ])
//     ]
//       .map(row => row.join(','))
//       .join('\n');

//     const blob = new Blob([csv], { type: 'text/csv' });
//     const a = document.createElement('a');
//     a.href = URL.createObjectURL(blob);
//     a.download = 'user-list.csv';
//     a.click();
//   };

//   const filtered = users.filter(user =>
//     user.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
//     user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
//     user.phoneNumber.includes(searchTerm) ||
//     user.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
//     user.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
//     user.firstname.toLowerCase().includes(searchTerm.toLowerCase()) ||
//     user.lastname.toLowerCase().includes(searchTerm.toLowerCase())
//   );

//   const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
//   const paginatedData = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

//   // Mobile Card Component
//   const UserCard = ({ user }: { user: User }) => (
//     <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm">
//       {editId === user.id ? (
//         <div className="space-y-3">
//           <div className="grid grid-cols-1 gap-3">
//             <input
//               name="userName"
//               placeholder="Username"
//               value={editFormData.userName || ''}
//               onChange={handleInputChange}
//               className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
//             />
//             <div className="grid grid-cols-2 gap-2">
//               <input
//                 name="firstname"
//                 placeholder="First Name"
//                 value={editFormData.firstname || ''}
//                 onChange={handleInputChange}
//                 className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
//               />
//               <input
//                 name="lastname"
//                 placeholder="Last Name"
//                 value={editFormData.lastname || ''}
//                 onChange={handleInputChange}
//                 className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
//               />
//             </div>
//             <input
//               name="email"
//               placeholder="Email"
//               value={editFormData.email || ''}
//               onChange={handleInputChange}
//               className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
//             />
//             <input
//               name="phoneNumber"
//               placeholder="Phone Number"
//               value={editFormData.phoneNumber || ''}
//               onChange={handleInputChange}
//               className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
//             />
//             <input
//               name="address"
//               placeholder="Address"
//               value={editFormData.address || ''}
//               onChange={handleInputChange}
//               className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
//             />
//             <div className="grid grid-cols-2 gap-2">
//               <input
//                 name="role"
//                 placeholder="Role"
//                 value={editFormData.role || ''}
//                 onChange={handleInputChange}
//                 className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
//               />
//               <input
//                 name="password"
//                 placeholder="Password"
//                 value={editFormData.password || ''}
//                 onChange={handleInputChange}
//                 className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
//               />
//             </div>
//           </div>
//           <div className="flex justify-end space-x-2 pt-2">
//             <button
//               onClick={handleSave}
//               className="flex items-center px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
//             >
//               <Save className="w-4 h-4 mr-1" />
//               Save
//             </button>
//             <button
//               onClick={handleCancel}
//               className="flex items-center px-3 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
//             >
//               <X className="w-4 h-4 mr-1" />
//               Cancel
//             </button>
//           </div>
//         </div>
//       ) : (
//         <div>
//           <div className="flex justify-between items-start mb-3">
//             <div>
//               <h3 className="font-semibold text-gray-900">{user.userName}</h3>
//               <p className="text-sm text-gray-600">{user.firstname} {user.lastname}</p>
//             </div>
//             <div className="flex space-x-2">
//               <button
//                 onClick={() => handleEdit(user.id)}
//                 className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
//               >
//                 <Edit className="w-4 h-4" />
//               </button>
//               <button
//                 onClick={() => handleDelete(user.id)}
//                 className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
//               >
//                 <Trash2 className="w-4 h-4" />
//               </button>
//             </div>
//           </div>
//           <div className="space-y-2 text-sm">
//             <div><span className="font-medium text-gray-700">Email:</span> {user.email}</div>
//             <div><span className="font-medium text-gray-700">Phone:</span> {user.phoneNumber}</div>
//             <div><span className="font-medium text-gray-700">Address:</span> {user.address}</div>
//             <div><span className="font-medium text-gray-700">Role:</span> {user.role}</div>
//             <div><span className="font-medium text-gray-700">Password:</span> {user.password}</div>
//           </div>
//         </div>
//       )}
//     </div>
//   );

//   return (
//     <div className="p-4 sm:p-6 bg-gray-50 min-h-screen">
//       <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 max-w-7xl mx-auto">
//         <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 space-y-4 sm:space-y-0">
//           <h2 className="text-xl font-bold text-gray-700">User List</h2>
//           <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
//             <button
//               onClick={handleDownload}
//               className="flex items-center justify-center px-4 py-2 text-green-600 hover:text-green-800 hover:bg-green-50 rounded border border-green-200"
//             >
//               <Download className="w-4 h-4 mr-2" />
//               Download CSV
//             </button>
//             <div className="relative">
//               <Search className="absolute left-3 top-2.5 text-gray-400 h-4 w-4" />
//               <input
//                 type="text"
//                 placeholder="Search users..."
//                 value={searchTerm}
//                 onChange={(e) => setSearchTerm(e.target.value)}
//                 className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
//               />
//             </div>
//           </div>
//         </div>

//         {/* Mobile view - Cards */}
//         <div className="block lg:hidden">
//           {paginatedData.length === 0 ? (
//             <div className="text-center py-8 text-gray-500">No users found</div>
//           ) : (
//             paginatedData.map((user) => <UserCard key={user.id} user={user} />)
//           )}
//         </div>

//         {/* Desktop view - Table */}
//         <div className="hidden lg:block overflow-x-auto">
//           <table className="w-full text-sm text-left">
//             <thead className="bg-gray-100 text-gray-600">
//               <tr>
//                 <th className="px-4 py-3">Username</th>
//                 <th className="px-4 py-3">First Name</th>
//                 <th className="px-4 py-3">Last Name</th>
//                 <th className="px-4 py-3">Email</th>
//                 <th className="px-4 py-3">Phone</th>
//                 <th className="px-4 py-3">Address</th>
//                 <th className="px-4 py-3">Role</th>
//                 <th className="px-4 py-3">Password</th>
//                 <th className="px-4 py-3">Actions</th>
//               </tr>
//             </thead>
//             <tbody>
//               {paginatedData.length === 0 ? (
//                 <tr>
//                   <td colSpan={9} className="text-center py-8 text-gray-500">No users found</td>
//                 </tr>
//               ) : (
//                 paginatedData.map((user) => (
//                   <tr key={user.id} className="border-b hover:bg-gray-50">
//                     {editId === user.id ? (
//                       <>
//                         <td className="px-4 py-3">
//                           <input
//                             name="userName"
//                             value={editFormData.userName || ''}
//                             onChange={handleInputChange}
//                             className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
//                           />
//                         </td>
//                         <td className="px-4 py-3">
//                           <input
//                             name="firstname"
//                             value={editFormData.firstname || ''}
//                             onChange={handleInputChange}
//                             className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
//                           />
//                         </td>
//                         <td className="px-4 py-3">
//                           <input
//                             name="lastname"
//                             value={editFormData.lastname || ''}
//                             onChange={handleInputChange}
//                             className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
//                           />
//                         </td>
//                         <td className="px-4 py-3">
//                           <input
//                             name="email"
//                             value={editFormData.email || ''}
//                             onChange={handleInputChange}
//                             className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
//                           />
//                         </td>
//                         <td className="px-4 py-3">
//                           <input
//                             name="phoneNumber"
//                             value={editFormData.phoneNumber || ''}
//                             onChange={handleInputChange}
//                             className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
//                           />
//                         </td>
//                         <td className="px-4 py-3">
//                           <input
//                             name="address"
//                             value={editFormData.address || ''}
//                             onChange={handleInputChange}
//                             className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
//                           />
//                         </td>
//                         <td className="px-4 py-3">
//                           <input
//                             name="role"
//                             value={editFormData.role || ''}
//                             onChange={handleInputChange}
//                             className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
//                           />
//                         </td>
//                         <td className="px-4 py-3">
//                           <input
//                             name="password"
//                             value={editFormData.password || ''}
//                             onChange={handleInputChange}
//                             className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
//                           />
//                         </td>
//                         <td className="px-4 py-3">
//                           <div className="flex space-x-2">
//                             <button
//                               onClick={handleSave}
//                               className="flex items-center px-2 py-1 text-green-600 hover:text-green-800 hover:bg-green-50 rounded"
//                             >
//                               <Save className="w-4 h-4" />
//                             </button>
//                             <button
//                               onClick={handleCancel}
//                               className="flex items-center px-2 py-1 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded"
//                             >
//                               <X className="w-4 h-4" />
//                             </button>
//                           </div>
//                         </td>
//                       </>
//                     ) : (
//                       <>
//                         <td className="px-4 py-3 font-medium">{user.userName}</td>
//                         <td className="px-4 py-3">{user.firstname}</td>
//                         <td className="px-4 py-3">{user.lastname}</td>
//                         <td className="px-4 py-3">{user.email}</td>
//                         <td className="px-4 py-3">{user.phoneNumber}</td>
//                         <td className="px-4 py-3">{user.address}</td>
//                         <td className="px-4 py-3">{user.role}</td>
//                         <td className="px-4 py-3">{user.password}</td>
//                         <td className="px-4 py-3">
//                           <div className="flex space-x-2">
//                             <button
//                               onClick={() => handleEdit(user.id)}
//                               className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
//                             >
//                               <Edit className="w-4 h-4" />
//                             </button>
//                             <button
//                               onClick={() => handleDelete(user.id)}
//                               className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
//                             >
//                               <Trash2 className="w-4 h-4" />
//                             </button>
//                           </div>
//                         </td>
//                       </>
//                     )}
//                   </tr>
//                 ))
//               )}
//             </tbody>
//           </table>
//         </div>

//         {/* Pagination */}
//         <div className="mt-6 flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0 text-sm text-gray-600">
//           <p>Showing {paginatedData.length} of {filtered.length} entries</p>
//           <div className="flex space-x-2">
//             <button
//               disabled={currentPage === 1}
//               onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
//               className="px-3 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Previous
//             </button>
//             <span className="px-3 py-2 bg-blue-100 text-blue-800 rounded-lg">
//               {currentPage} of {totalPages}
//             </span>
//             <button
//               disabled={currentPage === totalPages}
//               onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
//               className="px-3 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Next
//             </button>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// // Demo data for testing
// const demoUsers: User[] = [
//   {
//     id: 1,
//     userName: "john_doe",
//     firstname: "John",
//     lastname: "Doe",
//     email: "john.doe@example.com",
//     phoneNumber: "123-456-7890",
//     address: "123 Main St, New York, NY 10001",
//     password: "password123",
//     role: "Admin"
//   },
//   {
//     id: 2,
//     userName: "jane_smith",
//     firstname: "Jane",
//     lastname: "Smith",
//     email: "jane.smith@example.com",
//     phoneNumber: "987-654-3210",
//     address: "456 Oak Ave, Los Angeles, CA 90210",
//     password: "secretpass",
//     role: "User"
//   },
//   {
//     id: 3,
//     userName: "bob_wilson",
//     firstname: "Bob",
//     lastname: "Wilson",
//     email: "bob.wilson@example.com",
//     phoneNumber: "555-123-4567",
//     address: "789 Pine St, Chicago, IL 60601",
//     password: "bobpass456",
//     role: "Manager"
//   }
// ];

// // Demo App Component
// export default function App() {
//   const [users, setUsers] = useState<User[]>(demoUsers);

//   return (
//     <div className="min-h-screen bg-gray-50">
//       <UserList users={users} setUsers={setUsers} />
//     </div>
//   );
// }


import React, { useState, useEffect } from 'react';
import { Download, Edit, Search, Trash2, Save, X, Loader2, Users } from 'lucide-react';
import {
  getContactDetails,
  getAllUsersPaginated,
  getCurrentUser,
  getFarmersForFieldOfficers,
  getFarmerUserProfiles,
  getFarmsWithFarmerDetailsPaginated,
  getRecentFarmers,
  getTeamConnect,
  updateUser,
} from '../api';
import {
  buildEnrichmentFromUserRecord,
  buildFarmerEnrichmentLookup,
  buildFarmerEnrichmentLookupFromFarmRows,
  buildFarmerEnrichmentLookupFromFarmerProfiles,
  extractFieldOfficersFromTeamConnect,
  extractUserRoleName,
  getFarmerEnrichment,
  isFarmerUser,
  mergeFarmerEnrichmentLookups,
  pickDisplayAddress,
  pickDisplayEmail,
  type FarmerEnrichmentLookup,
} from '../utils/plantation';

interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number?: string;
  phone?: string;
  address?: string;
  role?: string;
  role_id?: number;
  created_by?: number;
  plantation_date?: string | null;
  plantation_type?: string | null;
}

interface UserListProps {
  currentUserId: number;
  currentUserRole: 'owner' | 'manager' | 'fieldofficer' | 'farmer';
}

const isFarmerRole = (role?: string) =>
  (role ?? '').toLowerCase().includes('farmer');

const displayOrNA = (value?: string | null) => {
  const text = value?.trim();
  return text ? text : 'N/A';
};

const EMPTY_ENRICHMENT_LOOKUP: FarmerEnrichmentLookup = {
  byId: new Map(),
  byPhone: new Map(),
};

const ENRICHMENT_TIMEOUT_MS = 20_000;

const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((resolve) => {
      window.setTimeout(() => resolve(fallback), ms);
    }),
  ]);

const transformUserRow = (
  user: any,
  enrichmentLookup: FarmerEnrichmentLookup,
): User => {
  const role = extractUserRoleName(user) || String(user.role?.name || user.role || '');
  const farmer = isFarmerUser(user);
  const enrichment =
    (farmer ? getFarmerEnrichment(user, enrichmentLookup) : undefined) ??
    (farmer ? buildEnrichmentFromUserRecord(user) : undefined);

  return {
    id: user.id,
    username: user.username || '',
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    email: pickDisplayEmail(user, enrichment),
    phone_number: user.phone_number || user.phone || '',
    phone: user.phone_number || user.phone || '',
    address: pickDisplayAddress(user, enrichment),
    role,
    role_id: user.role?.id || user.role_id,
    created_by: user.created_by,
    plantation_date:
      enrichment?.plantation_date && enrichment.plantation_date !== 'N/A'
        ? enrichment.plantation_date
        : null,
    plantation_type:
      enrichment?.plantation_type && enrichment.plantation_type !== 'N/A'
        ? enrichment.plantation_type
        : null,
  };
};

const loadFarmerEnrichmentLookup = async (
  farmerUsers: any[],
): Promise<FarmerEnrichmentLookup> => {
  const load = async (): Promise<FarmerEnrichmentLookup> => {
    const lookups: FarmerEnrichmentLookup[] = [];
    const farmerIds = farmerUsers.map((user) => user.id).filter(Boolean);

    const [profilesResult, recentResult, farmsResult, teamResult] =
      await Promise.allSettled([
        getFarmerUserProfiles(farmerIds),
        getRecentFarmers(),
        getFarmsWithFarmerDetailsPaginated(15),
        getCurrentUser().then(async (me) => {
          const industryId = me?.data?.industry_id ?? me?.data?.industry?.id;
          try {
            return await getTeamConnect(industryId);
          } catch {
            return await getTeamConnect();
          }
        }),
      ]);

    if (profilesResult.status === 'fulfilled' && profilesResult.value.length > 0) {
      lookups.push(
        buildFarmerEnrichmentLookupFromFarmerProfiles(profilesResult.value),
      );
    }

    if (recentResult.status === 'fulfilled') {
      let farmers = recentResult.value?.data;
      if (farmers?.farmers && Array.isArray(farmers.farmers)) {
        farmers = farmers.farmers;
      } else if (farmers?.results && Array.isArray(farmers.results)) {
        farmers = farmers.results;
      }
      if (Array.isArray(farmers) && farmers.length > 0) {
        lookups.push(buildFarmerEnrichmentLookupFromFarmerProfiles(farmers));
      }
    }

    if (farmsResult.status === 'fulfilled') {
      const farmRows = Array.isArray(farmsResult.value) ? farmsResult.value : [];
      if (farmRows.length > 0) {
        lookups.push(buildFarmerEnrichmentLookupFromFarmRows(farmRows));
      }
    }

    if (teamResult.status === 'fulfilled') {
      const teamData = teamResult.value.data;
      lookups.push(buildFarmerEnrichmentLookup(teamData));

      const officerIds = extractFieldOfficersFromTeamConnect(teamData).map(
        (officer) => officer.id,
      );
      if (officerIds.length > 0) {
        const foFarmers = await getFarmersForFieldOfficers(officerIds);
        if (foFarmers.length > 0) {
          lookups.push(buildFarmerEnrichmentLookupFromFarmerProfiles(foFarmers));
        }
      }
    }

    return lookups.length > 0
      ? mergeFarmerEnrichmentLookups(...lookups)
      : EMPTY_ENRICHMENT_LOOKUP;
  };

  return withTimeout(load(), ENRICHMENT_TIMEOUT_MS, EMPTY_ENRICHMENT_LOOKUP);
};

export const UserList: React.FC<UserListProps> = ({ currentUserId, currentUserRole }) => {
  const showPlantationColumns = currentUserRole === 'manager';
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 5;
  const [editId, setEditId] = useState<number | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<User>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, [currentUserId, currentUserRole]);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      let usersData: any[] = [];
      try {
        usersData = await getAllUsersPaginated();
      } catch {
        const usersResult = await getContactDetails();
        const contactData = usersResult.data.contacts;
        usersData =
          contactData.field_officers || contactData.owners || [];
      }

      setUsers(usersData.map((user) => transformUserRow(user, EMPTY_ENRICHMENT_LOOKUP)));
      setLoading(false);

      const farmerUsers = usersData.filter((user) => isFarmerUser(user));
      if (farmerUsers.length === 0) {
        return;
      }

      setEnriching(true);
      try {
        const enrichmentLookup = await loadFarmerEnrichmentLookup(farmerUsers);
        setUsers(usersData.map((user) => transformUserRow(user, enrichmentLookup)));
      } finally {
        setEnriching(false);
      }
    } catch (error: any) {
      setError(error.message || 'Failed to fetch users');
      setUsers([]);
      setLoading(false);
      setEnriching(false);
    }
  };

  const handleEdit = (id: number) => {
    const user = users.find(u => u.id === id);
    if (user) {
      setEditId(id);
      setEditFormData({
        username: user.username || '',
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email || '',
        phone_number: user.phone_number || user.phone || '',
        address: user.address || '',
      });
      setEditError(null);
    }
  };

  const handleCancel = () => {
    setEditId(null);
    setEditFormData({});
    setEditError(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    if (editId === null) return;

    setSavingEdit(true);
    setEditError(null);

    try {
      const userToEdit = users.find(u => u.id === editId);
      if (!userToEdit) {
        setEditError('User not found');
        setSavingEdit(false);
        return;
      }

      // Prepare update data (PATCH - only send changed fields)
      const updateData: any = {};

      if (editFormData.username && editFormData.username !== userToEdit.username) {
        updateData.username = editFormData.username;
      }

      if (editFormData.first_name && editFormData.first_name !== userToEdit.first_name) {
        updateData.first_name = editFormData.first_name;
      }

      if (editFormData.last_name && editFormData.last_name !== userToEdit.last_name) {
        updateData.last_name = editFormData.last_name;
      }

      if (editFormData.email && editFormData.email !== userToEdit.email) {
        updateData.email = editFormData.email;
      }

      const phoneValue = editFormData.phone_number || editFormData.phone;
      const currentPhone = userToEdit.phone_number || userToEdit.phone;
      if (phoneValue && phoneValue !== currentPhone) {
        updateData.phone_number = phoneValue;
      }

      if (editFormData.address && editFormData.address !== userToEdit.address) {
        updateData.address = editFormData.address;
      }

      // Update user if there are changes
      if (Object.keys(updateData).length > 0) {
        await updateUser(editId.toString(), updateData);
        
        // Refresh the data
        await fetchUsers();
      }

      setEditId(null);
      setEditFormData({});
    } catch (err: any) {
      setEditError(err.response?.data?.detail || err.message || 'Failed to update user. Please try again.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this field officer?')) {
      // TODO: Add API call to delete field officer
      // await deleteUser(id);
      
      setUsers(users.filter(user => user.id !== id));
    }
  };

  const getPlantationDateForUser = (user: User) =>
    isFarmerRole(user.role) ? displayOrNA(user.plantation_date) : 'N/A';

  const getPlantationTypeForUser = (user: User) =>
    isFarmerRole(user.role) ? displayOrNA(user.plantation_type) : 'N/A';

  const handleDownload = () => {
    const headers = showPlantationColumns
      ? [
          'Username',
          'First Name',
          'Last Name',
          'Email',
          'Phone Number',
          'Address',
          'Role',
          'Plantation Date',
          'Plantation Type',
        ]
      : ['Username', 'First Name', 'Last Name', 'Email', 'Phone Number', 'Address', 'Role'];

    const csv = [
      headers,
      ...users.map(
        ({
          username,
          first_name,
          last_name,
          email,
          phone_number,
          phone,
          address,
          role,
          plantation_date,
          plantation_type,
        }) => {
          const row = [
            username || '',
            first_name || '',
            last_name || '',
            email || '',
            phone_number || phone || '',
            address || '',
            role || '',
          ];

          if (showPlantationColumns) {
            row.push(
              isFarmerRole(role) ? displayOrNA(plantation_date) : 'N/A',
              isFarmerRole(role) ? displayOrNA(plantation_type) : 'N/A',
            );
          }

          return row;
        },
      ),
    ]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'user-list.csv';
    a.click();
  };

  const filtered = (users || []).filter(user =>
    (user.username?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (user.email?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (user.phone_number || user.phone || '').includes(searchTerm) ||
    (user.address?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (user.first_name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (user.last_name?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginatedData = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Mobile Card Component
  const UserCard = ({ user }: { user: User }) => (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm">
      {editId === user.id ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3">
            <input
              name="username"
              placeholder="Username"
              value={editFormData.username || ''}
              onChange={handleInputChange}
              className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                name="first_name"
                placeholder="First Name"
                value={editFormData.first_name || ''}
                onChange={handleInputChange}
                className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              />
              <input
                name="last_name"
                placeholder="Last Name"
                value={editFormData.last_name || ''}
                onChange={handleInputChange}
                className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <input
              name="email"
              placeholder="Email"
              value={editFormData.email || ''}
              onChange={handleInputChange}
              className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
            <input
              name="phone_number"
              placeholder="Phone Number"
              value={editFormData.phone_number || editFormData.phone || ''}
              onChange={handleInputChange}
              className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
            <input
              name="address"
              placeholder="Address"
              value={editFormData.address || ''}
              onChange={handleInputChange}
              className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {editError && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded text-sm">
              {editError}
            </div>
          )}
          <div className="flex justify-end space-x-2 pt-2">
            <button
              onClick={handleSave}
              disabled={savingEdit}
              className="flex items-center px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingEdit ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-1" />
                  Save
                </>
              )}
            </button>
            <button
              onClick={handleCancel}
              disabled={savingEdit}
              className="flex items-center px-3 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm disabled:opacity-50"
            >
              <X className="w-4 h-4 mr-1" />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex justify-between items-start mb-3">
            <div>
              <h3 className="font-semibold text-gray-900">{user.username}</h3>
              <p className="text-sm text-gray-600">{user.first_name} {user.last_name}</p>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => handleEdit(user.id)}
                className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
              >
                <Edit className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleDelete(user.id)}
                className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div><span className="font-medium text-gray-700">Email:</span> {displayOrNA(user.email)}</div>
            <div><span className="font-medium text-gray-700">Phone:</span> {displayOrNA(user.phone_number || user.phone)}</div>
            <div><span className="font-medium text-gray-700">Address:</span> {displayOrNA(user.address)}</div>
            <div><span className="font-medium text-gray-700">Role:</span> {user.role || 'N/A'}</div>
            {showPlantationColumns && (
              <>
                <div>
                  <span className="font-medium text-gray-700">Plantation Date:</span>{' '}
                  {getPlantationDateForUser(user)}
                </div>
                <div>
                  <span className="font-medium text-gray-700">Plantation Type:</span>{' '}
                  {getPlantationTypeForUser(user)}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div 
      className="min-h-screen bg-cover bg-center bg-fixed"
      style={{
        backgroundImage: `url('/icons/sugarcane main slide.jpg')`
      }}
    >
      <div className="min-h-screen bg-black bg-opacity-40">
        <div className="max-w-7xl mx-auto px-4 py-12">
          {/* Title Section */}
          <div className="mb-8 text-center">
            <div className="flex items-center justify-center space-x-4">
              <Users className="h-12 w-12 text-white" />
              <h1 className="text-4xl font-bold text-white">User List</h1>
            </div>
          </div>

          {/* Content Card */}
          <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6 bg-opacity-95">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 space-y-4 sm:space-y-0">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
            <button
              onClick={handleDownload}
              className="flex items-center justify-center px-4 py-2 text-green-600 hover:text-green-800 hover:bg-green-50 rounded border border-green-200"
            >
              <Download className="w-4 h-4 mr-2" />
            </button>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-gray-400 h-4 w-4" />
              <input
                type="text"
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600" />
            <p className="mt-2 text-gray-500">Loading users...</p>
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-600">
            Error: {error}
          </div>
        ) : (
          <>
            {enriching && (
              <div className="flex items-center gap-2 px-4 py-2 mb-3 text-sm text-blue-700 bg-blue-50 rounded-lg border border-blue-100">
                {/* <Loader2 className="w-4 h-4 animate-spin shrink-0" /> */}
                {/* <span>Loading farmer email, address, and plantation details…</span> */}
              </div>
            )}
            {/* Mobile view - Cards */}
            <div className="block lg:hidden">
              {paginatedData.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No users found</div>
              ) : (
                paginatedData.map((user) => <UserCard key={user.id} user={user} />)
              )}
            </div>

            {/* Desktop view - Table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-100 text-gray-600">
                  <tr>
                    <th className="px-4 py-3">Username</th>
                    <th className="px-4 py-3">First Name</th>
                    <th className="px-4 py-3">Last Name</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Address</th>
                    <th className="px-4 py-3">Role</th>
                    {showPlantationColumns && (
                      <>
                        <th className="px-4 py-3">Plantation Date</th>
                        <th className="px-4 py-3">Plantation Type</th>
                      </>
                    )}
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedData.length === 0 ? (
                    <tr>
                      <td colSpan={showPlantationColumns ? 10 : 8} className="text-center py-8 text-gray-500">No users found</td>
                    </tr>
                  ) : (
                    paginatedData.map((user) => (
                      <tr key={user.id} className="border-b hover:bg-gray-50">
                        {editId === user.id ? (
                          <>
                            <td className="px-4 py-3">
                              <input
                                name="username"
                                value={editFormData.username || ''}
                                onChange={handleInputChange}
                                className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
                                disabled={savingEdit}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                name="first_name"
                                value={editFormData.first_name || ''}
                                onChange={handleInputChange}
                                className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
                                disabled={savingEdit}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                name="last_name"
                                value={editFormData.last_name || ''}
                                onChange={handleInputChange}
                                className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
                                disabled={savingEdit}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                name="email"
                                value={editFormData.email || ''}
                                onChange={handleInputChange}
                                className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
                                disabled={savingEdit}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                name="phone_number"
                                value={editFormData.phone_number || editFormData.phone || ''}
                                onChange={handleInputChange}
                                className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
                                disabled={savingEdit}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                name="address"
                                value={editFormData.address || ''}
                                onChange={handleInputChange}
                                className="border border-gray-300 rounded px-2 py-1 w-full text-sm focus:ring-2 focus:ring-blue-500"
                                disabled={savingEdit}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-gray-600">{user.role || 'N/A'}</span>
                            </td>
                            {showPlantationColumns && (
                              <>
                                <td className="px-4 py-3 text-gray-500">—</td>
                                <td className="px-4 py-3 text-gray-500">—</td>
                              </>
                            )}
                            <td className="px-4 py-3">
                              <div className="flex space-x-2">
                                <button
                                  onClick={handleSave}
                                  disabled={savingEdit}
                                  className="flex items-center px-2 py-1 text-green-600 hover:text-green-800 hover:bg-green-50 rounded disabled:opacity-50"
                                  title="Save"
                                >
                                  {savingEdit ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Save className="w-4 h-4" />
                                  )}
                                </button>
                                <button
                                  onClick={handleCancel}
                                  disabled={savingEdit}
                                  className="flex items-center px-2 py-1 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded disabled:opacity-50"
                                  title="Cancel"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 font-medium">{user.username || 'N/A'}</td>
                            <td className="px-4 py-3">{user.first_name || 'N/A'}</td>
                            <td className="px-4 py-3">{user.last_name || 'N/A'}</td>
                            <td className="px-4 py-3">{displayOrNA(user.email)}</td>
                            <td className="px-4 py-3">{displayOrNA(user.phone_number || user.phone)}</td>
                            <td className="px-4 py-3 max-w-[14rem] truncate" title={displayOrNA(user.address)}>
                              {displayOrNA(user.address)}
                            </td>
                            <td className="px-4 py-3">{user.role || 'N/A'}</td>
                            {showPlantationColumns && (
                              <>
                                <td className="px-4 py-3">{getPlantationDateForUser(user)}</td>
                                <td className="px-4 py-3">{getPlantationTypeForUser(user)}</td>
                              </>
                            )}
                            <td className="px-4 py-3">
                              <div className="flex space-x-2">
                                <button
                                  onClick={() => handleEdit(user.id)}
                                  className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDelete(user.id)}
                                  className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-6 flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0 text-sm text-gray-600">
              <p>Showing {paginatedData.length} of {filtered.length} entries</p>
              <div className="flex space-x-2">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  className="px-3 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="px-3 py-2 bg-blue-100 text-blue-800 rounded-lg">
                  {currentPage} of {totalPages}
                </span>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  className="px-3 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
          </div>
        </div>
      </div>
    </div>
  );
};