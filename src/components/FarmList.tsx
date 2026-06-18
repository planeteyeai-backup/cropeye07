import React, { useState, useEffect } from 'react';
import { Download, Edit, Search, Trash2, Loader2, Eye, X, User, Ruler, Map, Droplets, Save, LandPlot } from 'lucide-react';
import { getRecentFarmers, patchFarm, updateUser, patchPlot, patchIrrigation } from '../api';
// import {
//   formatFarmerDisplayName,
//   // formatPlantationDate,
//   formatRecordAddress,
//   getPlantationFromRecord,
// } from '../utils/plantation';

const ITEMS_PER_PAGE = 5;

const ACRES_PER_HECTARE = 2.47105381;
const HECTARES_PER_ACRE = 1 / ACRES_PER_HECTARE;

const parseNumericValue = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const hectaresToAcres = (value: unknown): number => parseNumericValue(value) * ACRES_PER_HECTARE;
const acresToHectares = (value: unknown): number => parseNumericValue(value) * HECTARES_PER_ACRE;

const formatAcresValue = (value: unknown, fractionDigits = 2): string =>
  parseNumericValue(value).toFixed(fractionDigits);

const formatAcresFromHectaresOrNA = (value: unknown, fractionDigits = 2): string => {
  if (value === null || value === undefined || value === "") {
    return "N/A";
  }
  const acres = hectaresToAcres(value);
  return Number.isFinite(acres) ? acres.toFixed(fractionDigits) : "N/A";
};

const formatPlantationDate = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return 'N/A';
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

interface Farmer {
  id: number;
  farmer_name: string;
  phone_number: string;
  area: number;
  area_hectares?: number;
  plantation_date: string;
  plantation_type: string;
  crop_type: string;
  crop_variety: string;
  farmer?: {
    id: number;
    username: string;
    email: string;
    phone_number?: string;
  };
  // Additional fields for detailed view
  first_name?: string;
  last_name?: string;
  email?: string;
  address?: string;
  village?: string;
  state?: string;
  district?: string;
  taluka?: string;
  created_at?: string;
  plots?: any[];
  farms?: any[];
  irrigation?: any;
}
interface FarmlistProps {
  users?: Farmer[];
  setUsers?: React.Dispatch<React.SetStateAction<Farmer[]>>;
}

export const FarmList: React.FC<FarmlistProps> = ({ users: propUsers, setUsers: propSetUsers }) => {
  const [users, setUsers] = useState<Farmer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedFarmer, setSelectedFarmer] = useState<Farmer | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedFarmers, setSelectedFarmers] = useState<Set<number>>(new Set());
  
  // Loading states for filter operations
  const [filtering, setFiltering] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  
  // Edit modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingFarmer, setEditingFarmer] = useState<Farmer | null>(null);
  const [allFarms, setAllFarms] = useState<any[]>([]); // Store all farms for the farmer
  const [editForm, setEditForm] = useState({
    farmer_name: '',
    first_name: '',
    last_name: '',
    phone_number: '',
  });
  // Store edit forms for each farm (indexed by farm ID)
  const [farmEditForms, setFarmEditForms] = useState<Record<string, {
    area: string;
    plantation_type: string;
    crop_type: string;
    crop_variety: string;
  }>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  
  // View Details Modal Edit State
  const [isViewModalEditMode, setIsViewModalEditMode] = useState(false);
  const [viewModalEditForm, setViewModalEditForm] = useState<any>({});
  const [viewModalPlotForms, setViewModalPlotForms] = useState<Record<string, any>>({});
  const [viewModalFarmForms, setViewModalFarmForms] = useState<Record<string, any>>({});
  const [viewModalIrrigationForms, setViewModalIrrigationForms] = useState<Record<string, any>>({});
  const [savingViewModalEdit, setSavingViewModalEdit] = useState(false);
  const [viewModalEditError, setViewModalEditError] = useState<string | null>(null);

  // Fetch farms data from API
  const fetchFarms = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await getRecentFarmers();
        console.log('API Response:', response.data);
        
        let farmersData = response.data;
        
        // Handle the new response structure: { farmers: [...] }
        if (farmersData && farmersData.farmers && Array.isArray(farmersData.farmers)) {
          farmersData = farmersData.farmers;
        } else if (farmersData && farmersData.results && Array.isArray(farmersData.results)) {
          // If response has pagination structure like { results: [...], count: ... }
          farmersData = farmersData.results;
        } else if (farmersData && farmersData.data && Array.isArray(farmersData.data)) {
          // If response has nested data structure
          farmersData = farmersData.data;
        } else if (!Array.isArray(farmersData)) {
          console.error('Expected array but got:', typeof farmersData, farmersData);
          setError('Invalid data format received from server');
          return;
        }
        
        // Transform the data to match our interface based on new API response structure
        const transformedData: Farmer[] = farmersData.map((farmer: any) => {
          console.log('Processing farmer:', farmer.username, 'Farms:', farmer.farms);
          
          // Get the first farm from the farmer's farms array or from plots
          let firstFarm = null;
          let firstIrrigation = null;
          
          // Try to get farm data from farmer.farms first
          if (farmer.farms && farmer.farms.length > 0) {
            firstFarm = farmer.farms[0];
            firstIrrigation = firstFarm.irrigations && firstFarm.irrigations.length > 0 ? firstFarm.irrigations[0] : null;
          }
          // If not found, try to get from plots[0].farms
          else if (farmer.plots && farmer.plots.length > 0 && farmer.plots[0].farms && farmer.plots[0].farms.length > 0) {
            firstFarm = farmer.plots[0].farms[0];
            firstIrrigation = firstFarm.irrigations && firstFarm.irrigations.length > 0 ? firstFarm.irrigations[0] : null;
          }
          
          console.log('First farm data:', firstFarm);
          console.log('First irrigation data:', firstIrrigation);

          const farmAreaHectares = firstFarm ? parseNumericValue(firstFarm.area_size) : 0;
          const farmAreaAcresRaw = firstFarm ? hectaresToAcres(firstFarm.area_size) : 0;
          const transformed = {
            id: farmer.id,
            farmer_name: farmer.username || `${farmer.first_name || ''} ${farmer.last_name || ''}`.trim() || 'N/A',
            phone_number: farmer.phone_number || 'N/A',
            area: Number(farmAreaAcresRaw.toFixed(2)),
            area_hectares: Number(farmAreaHectares.toFixed(4)),
            plantation_date: formatPlantationDate(firstFarm?.plantation_date),
            plantation_type: firstFarm?.plantation_type || 'N/A',
            crop_type: firstFarm?.crop_type?.crop_type || firstFarm?.crop_type_name || 'Sugarcane',
            crop_variety: firstFarm?.crop_type?.crop_variety || firstFarm?.crop_variety || '',
            farmer: {
              id: farmer.id,
              username: farmer.username,
              email: farmer.email,
              phone_number: farmer.phone_number
            },
            // Additional fields for detailed view
            first_name: farmer.first_name,
            last_name: farmer.last_name,
            email: farmer.email,
            address: farmer.address,
            village: farmer.village,
            state: farmer.state,
            district: farmer.district,
            taluka: farmer.taluka,
            created_at: farmer.date_joined || farmer.created_at,
            plots: farmer.plots,
            farms: farmer.farms,
            // Store irrigation data for easy access
            irrigation: firstIrrigation
          };
          
          console.log('Transformed farmer data:', transformed);
          return transformed;
        });
        
        console.log('Transformed data:', transformedData);
        setUsers(transformedData);
        if (propSetUsers) {
          propSetUsers(transformedData);
        }
      } catch (err: any) {
        console.error('Error fetching farms:', err);
        setError(err.message || 'Failed to fetch farms data');
      } finally {
        setLoading(false);
      }
    };

  useEffect(() => {
    fetchFarms();
  }, [propSetUsers]);

  // Use prop users if provided, otherwise use state users
  const displayUsers = propUsers || users;

  const handleEdit = (id: number) => {
    const farmer = displayUsers.find((u) => u.id === id);
    if (!farmer) {
      setError('Farmer not found');
      return;
    }

    console.log('🔍 Editing farmer:', farmer.id, {
      farmer_name: farmer.farmer_name,
      farms: farmer.farms,
      plots: farmer.plots,
    });

    // Collect ALL farms from both farmer.farms and farmer.plots[].farms
    const farmsList: any[] = [];
    
    // Add farms from farmer.farms
    if (farmer.farms && farmer.farms.length > 0) {
      farmsList.push(...farmer.farms);
    }
    
    // Add farms from plots
    if (farmer.plots && farmer.plots.length > 0) {
      farmer.plots.forEach((plot: any) => {
        if (plot.farms && plot.farms.length > 0) {
          farmsList.push(...plot.farms);
        }
      });
    }

    console.log('📋 All farms found:', farmsList.length, farmsList);

    // Populate farmer edit form
    setEditForm({
      farmer_name: farmer.farmer_name || '',
      first_name: farmer.first_name || '',
      last_name: farmer.last_name || '',
      phone_number: farmer.phone_number || '',
    });

    // Populate farm edit forms for each farm
    const farmForms: Record<string, {
      area: string;
      plantation_type: string;
      crop_type: string;
      crop_variety: string;
    }> = {};

    farmsList.forEach((farm: any) => {
      if (farm.id) {
        const areaInAcres = farm.area_size ? formatAcresFromHectaresOrNA(farm.area_size) : formatAcresValue(farmer.area);
        farmForms[farm.id.toString()] = {
          area: areaInAcres !== 'N/A' ? areaInAcres : formatAcresValue(farmer.area),
          plantation_type: farm.plantation_type || farmer.plantation_type || '',
          crop_type: farm.crop_type?.crop_type || farm.crop_type_name || farmer.crop_type || 'Sugarcane',
          crop_variety: farm.crop_type?.crop_variety || farm.crop_variety || farmer.crop_variety || '',
        };
      }
    });

    // If no farms found, create a default form entry
    if (farmsList.length === 0) {
      console.warn('⚠️ No farms found for farmer:', farmer.id);
      // Still allow editing farmer details
    }

    setAllFarms(farmsList);
    setFarmEditForms(farmForms);
    setEditingFarmer(farmer);
    setIsEditModalOpen(true);
    setEditError(null);
  };

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false);
    setEditingFarmer(null);
    setAllFarms([]);
    setEditForm({
      farmer_name: '',
      first_name: '',
      last_name: '',
      phone_number: '',
    });
    setFarmEditForms({});
    setEditError(null);
  };

  const handleFarmFormChange = (farmId: string, field: 'area' | 'plantation_type' | 'crop_type' | 'crop_variety', value: string) => {
    setFarmEditForms(prev => ({
      ...prev,
      [farmId]: {
        ...prev[farmId],
        [field]: value
      }
    }));
  };

  const handleViewModalPlotFormChange = (plotId: string, field: string, value: string) => {
    setViewModalPlotForms(prev => ({
      ...prev,
      [plotId]: {
        ...prev[plotId],
        [field]: value
      }
    }));
  };

  const handleViewModalFarmFormChange = (farmId: string, field: string, value: string) => {
    setViewModalFarmForms(prev => ({
      ...prev,
      [farmId]: {
        ...prev[farmId],
        [field]: value
      }
    }));
  };

  const handleViewModalIrrigationFormChange = (irrigationId: string, field: string, value: string) => {
    setViewModalIrrigationForms(prev => ({
      ...prev,
      [irrigationId]: {
        ...prev[irrigationId],
        [field]: value
      }
    }));
  };

  const handleSaveEdit = async () => {
    if (!editingFarmer) return;

    setSavingEdit(true);
    setEditError(null);

    try {
      // Update all farms
      const farmUpdatePromises: Promise<any>[] = [];
      
      allFarms.forEach((farm: any) => {
        if (!farm.id) return;
        
        const farmForm = farmEditForms[farm.id.toString()];
        if (!farmForm) return;

        // Prepare farm update data (PATCH - only send changed fields)
        const farmUpdateData: any = {};
        
        // Check if plantation_type changed
        if (farmForm.plantation_type && farmForm.plantation_type !== farm.plantation_type) {
          farmUpdateData.plantation_type = farmForm.plantation_type;
        }
        
        // Check if crop_type changed
        const currentCropType = farm.crop_type?.crop_type || farm.crop_type_name || farm.crop_type;
        if (farmForm.crop_type && farmForm.crop_type !== currentCropType) {
          farmUpdateData.crop_type = farmForm.crop_type;
        }
        
        // Check if crop_variety changed
        const currentCropVariety = farm.crop_type?.crop_variety || farm.crop_variety;
        if (farmForm.crop_variety !== undefined && farmForm.crop_variety !== currentCropVariety) {
          farmUpdateData.crop_variety = farmForm.crop_variety;
        }
        
        // Check if area changed
        const currentAreaInAcres = farm.area_size ? formatAcresFromHectaresOrNA(farm.area_size) : '0';
        const currentAreaValue = currentAreaInAcres !== 'N/A' ? parseFloat(currentAreaInAcres) : 0;
        const newAreaValue = parseFloat(farmForm.area) || 0;
        if (farmForm.area && newAreaValue !== currentAreaValue) {
          const areaInHectares = acresToHectares(newAreaValue);
          farmUpdateData.area_size = areaInHectares;
        }

        // Update farm if there are changes
        if (Object.keys(farmUpdateData).length > 0) {
          farmUpdatePromises.push(patchFarm(farm.id.toString(), farmUpdateData));
        }
      });

      // Execute all farm updates in parallel
      if (farmUpdatePromises.length > 0) {
        await Promise.all(farmUpdatePromises);
      }

      // Update farmer/user data if changed
      const farmerUpdateData: any = {};
      
      // Split farmer_name into first_name and last_name if needed
      if (editForm.first_name && editForm.first_name !== editingFarmer.first_name) {
        farmerUpdateData.first_name = editForm.first_name;
      }
      
      if (editForm.last_name && editForm.last_name !== editingFarmer.last_name) {
        farmerUpdateData.last_name = editForm.last_name;
      }
      
      if (editForm.phone_number && editForm.phone_number !== editingFarmer.phone_number) {
        farmerUpdateData.phone_number = editForm.phone_number;
      }

      // Update user if there are changes
      if (Object.keys(farmerUpdateData).length > 0 && editingFarmer.farmer?.id) {
        await updateUser(editingFarmer.farmer.id.toString(), farmerUpdateData);
      }

      // Refresh the data
      const response = await getRecentFarmers();
      let farmersData = response.data;
      
      if (farmersData && farmersData.farmers && Array.isArray(farmersData.farmers)) {
        farmersData = farmersData.farmers;
      } else if (farmersData && farmersData.results && Array.isArray(farmersData.results)) {
        farmersData = farmersData.results;
      } else if (farmersData && farmersData.data && Array.isArray(farmersData.data)) {
        farmersData = farmersData.data;
      }

      const transformedData: Farmer[] = farmersData.map((farmer: any) => {
        let firstFarm = null;
        let firstIrrigation = null;
        
        if (farmer.farms && farmer.farms.length > 0) {
          firstFarm = farmer.farms[0];
          firstIrrigation = firstFarm.irrigations && firstFarm.irrigations.length > 0 ? firstFarm.irrigations[0] : null;
        } else if (farmer.plots && farmer.plots.length > 0 && farmer.plots[0].farms && farmer.plots[0].farms.length > 0) {
          firstFarm = farmer.plots[0].farms[0];
          firstIrrigation = firstFarm.irrigations && firstFarm.irrigations.length > 0 ? firstFarm.irrigations[0] : null;
        }

        const farmAreaHectares = firstFarm ? parseNumericValue(firstFarm.area_size) : 0;
        const farmAreaAcresRaw = firstFarm ? hectaresToAcres(firstFarm.area_size) : 0;
        
        return {
          id: farmer.id,
          farmer_name: farmer.username || `${farmer.first_name || ''} ${farmer.last_name || ''}`.trim() || 'N/A',
          phone_number: farmer.phone_number || 'N/A',
          area: Number(farmAreaAcresRaw.toFixed(2)),
          area_hectares: Number(farmAreaHectares.toFixed(4)),
          plantation_date: formatPlantationDate(firstFarm?.plantation_date),
          plantation_type: firstFarm?.plantation_type || 'N/A',
          crop_type: firstFarm?.crop_type?.crop_type || firstFarm?.crop_type_name || 'Sugarcane',
          crop_variety: firstFarm?.crop_type?.crop_variety || firstFarm?.crop_variety || '',
          farmer: {
            id: farmer.id,
            username: farmer.username,
            email: farmer.email,
            phone_number: farmer.phone_number
          },
          first_name: farmer.first_name,
          last_name: farmer.last_name,
          email: farmer.email,
          address: farmer.address,
          village: farmer.village,
          state: farmer.state,
          district: farmer.district,
          taluka: farmer.taluka,
          created_at: farmer.date_joined || farmer.created_at,
          plots: farmer.plots,
          farms: farmer.farms,
          irrigation: firstIrrigation
        };
      });

      setUsers(transformedData);
      if (propSetUsers) {
        propSetUsers(transformedData);
      }

      handleCloseEditModal();
    } catch (err: any) {
      console.error('Error updating farm:', err);
      setEditError(err.response?.data?.detail || err.message || 'Failed to update farm. Please try again.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeleting(id);
    try {
      // Simulate async operation for better UX
      await new Promise(resolve => setTimeout(resolve, 300));
      const updatedUsers = displayUsers.filter((user) => user.id !== id);
      setUsers(updatedUsers);
      if (propSetUsers) {
        propSetUsers(updatedUsers);
      }
    } finally {
      setDeleting(null);
    }
  };

  const handleViewDetails = (farmer: Farmer) => {
    setSelectedFarmer(farmer);
    setIsModalOpen(true);
    setIsViewModalEditMode(false);
    // Initialize edit forms with current data
    initializeViewModalEditForms(farmer);
  };

  const initializeViewModalEditForms = (farmer: Farmer) => {
    // Initialize farmer form
    setViewModalEditForm({
      farmer_name: farmer.farmer_name || '',
      first_name: farmer.first_name || '',
      last_name: farmer.last_name || '',
      phone_number: farmer.phone_number || '',
      email: farmer.email || '',
      address: farmer.address || '',
      taluka: farmer.taluka || '',
      state: farmer.state || '',
      district: farmer.district || '',
    });

    // Initialize plot forms
    const plotForms: Record<string, any> = {};
    const farmForms: Record<string, any> = {};
    const irrigationForms: Record<string, any> = {};

    if (farmer.plots && farmer.plots.length > 0) {
      farmer.plots.forEach((plot: any) => {
        if (plot.id) {
          plotForms[plot.id.toString()] = {
            village: plot.village || '',
            pin_code: plot.pin_code || '',
            gat_number: plot.gat_number || '',
            area_size: plot.area_size ? formatAcresFromHectaresOrNA(plot.area_size) : '0',
          };
        }

        if (plot.farms && plot.farms.length > 0) {
          plot.farms.forEach((farm: any) => {
            if (farm.id) {
              farmForms[farm.id.toString()] = {
                crop_type: farm.crop_type || '',
                crop_variety: farm.crop_type?.crop_variety || farm.crop_variety || '',
                plantation_type: farm.plantation_type || '',
                plantation_date: farm.plantation_date || '',
                planting_method: farm.planting_method || '',
                spacing_a: farm.spacing_a || '',
                spacing_b: farm.spacing_b || '',
                area_size: farm.area_size ? formatAcresFromHectaresOrNA(farm.area_size) : '0',
              };
            }

            if (farm.irrigations && farm.irrigations.length > 0) {
              farm.irrigations.forEach((irrigation: any) => {
                if (irrigation.id) {
                  irrigationForms[irrigation.id.toString()] = {
                    irrigation_type: irrigation.irrigation_type || '',
                    plants_per_acre: irrigation.plants_per_acre || '',
                    flow_rate_lph: irrigation.flow_rate_lph || '',
                    emitters_count: irrigation.emitters_count || '',
                    motor_horsepower: irrigation.motor_horsepower || '',
                    pipe_width_inches: irrigation.pipe_width_inches || '',
                    distance_motor_to_plot_m: irrigation.distance_motor_to_plot_m || '',
                  };
                }
              });
            }
          });
        }
      });
    }

    setViewModalPlotForms(plotForms);
    setViewModalFarmForms(farmForms);
    setViewModalIrrigationForms(irrigationForms);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedFarmer(null);
    setIsViewModalEditMode(false);
    setViewModalEditForm({});
    setViewModalPlotForms({});
    setViewModalFarmForms({});
    setViewModalIrrigationForms({});
    setViewModalEditError(null);
  };

  const handleSaveViewModalEdit = async () => {
    if (!selectedFarmer) return;

    setSavingViewModalEdit(true);
    setViewModalEditError(null);

    try {
      // Update farmer/user data
      const farmerUpdateData: any = {};
      if (viewModalEditForm.first_name && viewModalEditForm.first_name !== selectedFarmer.first_name) {
        farmerUpdateData.first_name = viewModalEditForm.first_name;
      }
      if (viewModalEditForm.last_name && viewModalEditForm.last_name !== selectedFarmer.last_name) {
        farmerUpdateData.last_name = viewModalEditForm.last_name;
      }
      if (viewModalEditForm.phone_number && viewModalEditForm.phone_number !== selectedFarmer.phone_number) {
        farmerUpdateData.phone_number = viewModalEditForm.phone_number;
      }
      if (viewModalEditForm.email && viewModalEditForm.email !== selectedFarmer.email) {
        farmerUpdateData.email = viewModalEditForm.email;
      }
      if (viewModalEditForm.address && viewModalEditForm.address !== selectedFarmer.address) {
        farmerUpdateData.address = viewModalEditForm.address;
      }
      if (viewModalEditForm.taluka && viewModalEditForm.taluka !== selectedFarmer.taluka) {
        farmerUpdateData.taluka = viewModalEditForm.taluka;
      }
      if (viewModalEditForm.state && viewModalEditForm.state !== selectedFarmer.state) {
        farmerUpdateData.state = viewModalEditForm.state;
      }
      if (viewModalEditForm.district && viewModalEditForm.district !== selectedFarmer.district) {
        farmerUpdateData.district = viewModalEditForm.district;
      }

      const updatePromises: Promise<any>[] = [];

      // Update user if there are changes
      if (Object.keys(farmerUpdateData).length > 0 && selectedFarmer.farmer?.id) {
        updatePromises.push(updateUser(selectedFarmer.farmer.id.toString(), farmerUpdateData));
      }

      // Update plots, farms, and irrigations
      if (selectedFarmer.plots && selectedFarmer.plots.length > 0) {
        selectedFarmer.plots.forEach((plot: any) => {
          const plotForm = viewModalPlotForms[plot.id?.toString() || ''];
          if (plotForm && plot.id) {
            const plotUpdateData: any = {};
            if (plotForm.village !== plot.village) plotUpdateData.village = plotForm.village;
            if (plotForm.pin_code !== plot.pin_code) plotUpdateData.pin_code = plotForm.pin_code;
            if (plotForm.gat_number !== plot.gat_number) plotUpdateData.gat_number = plotForm.gat_number;
            if (plotForm.area_size && parseFloat(plotForm.area_size) !== parseFloat(formatAcresFromHectaresOrNA(plot.area_size) !== 'N/A' ? formatAcresFromHectaresOrNA(plot.area_size) : '0')) {
              plotUpdateData.area_size = acresToHectares(parseFloat(plotForm.area_size));
            }

            if (Object.keys(plotUpdateData).length > 0) {
              updatePromises.push(patchPlot(plot.id.toString(), plotUpdateData));
            }
          }

          if (plot.farms && plot.farms.length > 0) {
            plot.farms.forEach((farm: any) => {
              const farmForm = viewModalFarmForms[farm.id?.toString() || ''];
              if (farmForm && farm.id) {
                const farmUpdateData: any = {};
                if (farmForm.crop_type !== farm.crop_type) farmUpdateData.crop_type = farmForm.crop_type;
                if (farmForm.crop_variety !== (farm.crop_type?.crop_variety || farm.crop_variety)) farmUpdateData.crop_variety = farmForm.crop_variety;
                if (farmForm.plantation_type !== farm.plantation_type) farmUpdateData.plantation_type = farmForm.plantation_type;
                if (farmForm.plantation_date !== farm.plantation_date) farmUpdateData.plantation_date = farmForm.plantation_date;
                if (farmForm.planting_method !== farm.planting_method) farmUpdateData.planting_method = farmForm.planting_method;
                if (farmForm.spacing_a !== farm.spacing_a) farmUpdateData.spacing_a = farmForm.spacing_a;
                if (farmForm.spacing_b !== farm.spacing_b) farmUpdateData.spacing_b = farmForm.spacing_b;
                if (farmForm.area_size && parseFloat(farmForm.area_size) !== parseFloat(formatAcresFromHectaresOrNA(farm.area_size) !== 'N/A' ? formatAcresFromHectaresOrNA(farm.area_size) : '0')) {
                  farmUpdateData.area_size = acresToHectares(parseFloat(farmForm.area_size));
                }

                if (Object.keys(farmUpdateData).length > 0) {
                  updatePromises.push(patchFarm(farm.id.toString(), farmUpdateData));
                }
              }

              if (farm.irrigations && farm.irrigations.length > 0) {
                farm.irrigations.forEach((irrigation: any) => {
                  const irrigationForm = viewModalIrrigationForms[irrigation.id?.toString() || ''];
                  if (irrigationForm && irrigation.id) {
                    const irrigationUpdateData: any = {};
                    if (irrigationForm.irrigation_type !== irrigation.irrigation_type) irrigationUpdateData.irrigation_type = irrigationForm.irrigation_type;
                    if (irrigationForm.plants_per_acre !== irrigation.plants_per_acre) irrigationUpdateData.plants_per_acre = irrigationForm.plants_per_acre;
                    if (irrigationForm.flow_rate_lph !== irrigation.flow_rate_lph) irrigationUpdateData.flow_rate_lph = irrigationForm.flow_rate_lph;
                    if (irrigationForm.emitters_count !== irrigation.emitters_count) irrigationUpdateData.emitters_count = irrigationForm.emitters_count;
                    if (irrigationForm.motor_horsepower !== irrigation.motor_horsepower) irrigationUpdateData.motor_horsepower = irrigationForm.motor_horsepower;
                    if (irrigationForm.pipe_width_inches !== irrigation.pipe_width_inches) irrigationUpdateData.pipe_width_inches = irrigationForm.pipe_width_inches;
                    if (irrigationForm.distance_motor_to_plot_m !== irrigation.distance_motor_to_plot_m) irrigationUpdateData.distance_motor_to_plot_m = irrigationForm.distance_motor_to_plot_m;

                    if (Object.keys(irrigationUpdateData).length > 0) {
                      updatePromises.push(patchIrrigation(irrigation.id.toString(), irrigationUpdateData));
                    }
                  }
                });
              }
            });
          }
        });
      }

      // Execute all updates
      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
      }

      // Refresh the data
      await fetchFarms();
      
      // Update selectedFarmer with fresh data
      const response = await getRecentFarmers();
      let farmersData = response.data;
      
      if (farmersData && farmersData.farmers && Array.isArray(farmersData.farmers)) {
        farmersData = farmersData.farmers;
      } else if (farmersData && farmersData.results && Array.isArray(farmersData.results)) {
        farmersData = farmersData.results;
      } else if (farmersData && farmersData.data && Array.isArray(farmersData.data)) {
        farmersData = farmersData.data;
      }

      const updatedFarmer = farmersData.find((f: any) => f.id === selectedFarmer.id);
      if (updatedFarmer) {
        // Transform the updated farmer data
        let firstFarm = null;
        let firstIrrigation = null;
        
        if (updatedFarmer.farms && updatedFarmer.farms.length > 0) {
          firstFarm = updatedFarmer.farms[0];
          firstIrrigation = firstFarm.irrigations && firstFarm.irrigations.length > 0 ? firstFarm.irrigations[0] : null;
        } else if (updatedFarmer.plots && updatedFarmer.plots.length > 0 && updatedFarmer.plots[0].farms && updatedFarmer.plots[0].farms.length > 0) {
          firstFarm = updatedFarmer.plots[0].farms[0];
          firstIrrigation = firstFarm.irrigations && firstFarm.irrigations.length > 0 ? firstFarm.irrigations[0] : null;
        }

        const farmAreaHectares = firstFarm ? parseNumericValue(firstFarm.area_size) : 0;
        const farmAreaAcresRaw = firstFarm ? hectaresToAcres(firstFarm.area_size) : 0;
        
        const transformedFarmer: Farmer = {
          id: updatedFarmer.id,
          farmer_name: updatedFarmer.username || `${updatedFarmer.first_name || ''} ${updatedFarmer.last_name || ''}`.trim() || 'N/A',
          phone_number: updatedFarmer.phone_number || 'N/A',
          area: Number(farmAreaAcresRaw.toFixed(2)),
          area_hectares: Number(farmAreaHectares.toFixed(4)),
          plantation_date: formatPlantationDate(firstFarm?.plantation_date),
          plantation_type: firstFarm?.plantation_type || 'N/A',
          crop_type: firstFarm?.crop_type?.crop_type || firstFarm?.crop_type_name || 'Sugarcane',
          crop_variety: firstFarm?.crop_type?.crop_variety || firstFarm?.crop_variety || '',
          farmer: {
            id: updatedFarmer.id,
            username: updatedFarmer.username,
            email: updatedFarmer.email,
            phone_number: updatedFarmer.phone_number
          },
          first_name: updatedFarmer.first_name,
          last_name: updatedFarmer.last_name,
          email: updatedFarmer.email,
          address: updatedFarmer.address,
          village: updatedFarmer.village,
          state: updatedFarmer.state,
          district: updatedFarmer.district,
          taluka: updatedFarmer.taluka,
          created_at: updatedFarmer.date_joined || updatedFarmer.created_at,
          plots: updatedFarmer.plots,
          farms: updatedFarmer.farms,
          irrigation: firstIrrigation
        };
        
        setSelectedFarmer(transformedFarmer);
        initializeViewModalEditForms(transformedFarmer);
      }

      setIsViewModalEditMode(false);
    } catch (err: any) {
      console.error('Error updating view modal data:', err);
      setViewModalEditError(err.response?.data?.detail || err.message || 'Failed to update. Please try again.');
    } finally {
      setSavingViewModalEdit(false);
    }
  };

  const handleSelectFarmer = (farmerId: number) => {
    setSelectedFarmers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(farmerId)) {
        newSet.delete(farmerId);
      } else {
        newSet.add(farmerId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedFarmers.size === paginatedData.length) {
      setSelectedFarmers(new Set());
    } else {
      setSelectedFarmers(new Set(paginatedData.map(farmer => farmer.id)));
    }
  };

  const handleDownloadFarmer = (farmer: Farmer) => {
    // Create comprehensive CSV data for the farmer with proper columns
    const csvData = [];
    
    // Add header row with all column names
    csvData.push([
      'Farmer ID',
      'Farmer Name',
      'First Name',
      'Last Name',
      'Email',
      'Phone Number',
      'Address',
      'Village',
      'State',
      'District',
      'Taluka',
      'Created Date',
      'Total Area (acres)',
      'Total Area (hectares)',
      'Plantation Type',
      'Crop Type',
      'Crop Variety',
      'Irrigation Type',
      'Emitters Count',
      'Flow Rate (LPH)',
      'Plants Per Acre',
      'Plot ID',
      'Plot Number',
      'Gat Number',
      'Plot Area Size (acres)',
      'Plot Village',
      'Plot State',
      'Plot District',
      'Plot Taluka',
      'PIN Code',
      'Country',
      'Plot Created At',
      'Farm ID',
      'Farm UID',
      'Farm Area Size (acres)',
      'Crop Type',
      'Farm Plantation Type',
      'Planting Method',
      'Soil Type',
      'Farm Address',
      'Farm Created At',
      'Irrigation Type (Farm)',
      'Emitters Count (Farm)',
      'Flow Rate LPH (Farm)',
      'Plants Per Acre (Farm)',
      'Distance Motor to Plot (m)',
      'Motor Horsepower',
      'Pipe Width (inches)',
      'Irrigation Status'
    ]);
    
    // Add farmer data row
    const totalAreaAcres = formatAcresValue(farmer.area);
    const totalAreaHectares = acresToHectares(farmer.area).toFixed(2);

    const farmerRow = [
      farmer.id,
      farmer.farmer_name,
      farmer.first_name || 'N/A',
      farmer.last_name || 'N/A',
      farmer.email || 'N/A',
      farmer.phone_number,
      farmer.address || 'N/A',
      farmer.village || 'N/A',
      farmer.state || 'N/A',
      farmer.district || 'N/A',
      farmer.taluka || 'N/A',
      farmer.created_at ? new Date(farmer.created_at).toLocaleDateString('en-GB') : 'N/A',
      totalAreaAcres,
      totalAreaHectares,
      farmer.plantation_type,
      farmer.crop_type,
      farmer.crop_variety || 'N/A',
      farmer.irrigation?.irrigation_type || 'N/A',
      farmer.irrigation?.emitters_count || 'N/A',
      farmer.irrigation?.flow_rate_lph || 'N/A',
      farmer.irrigation?.plants_per_acre || 'N/A',
      '', // Plot ID - will be filled if plots exist
      '', // Plot Number
      '', // Gat Number
      '', // Plot Area Size
      '', // Plot Village
      '', // Plot State
      '', // Plot District
      '', // Plot Taluka
      '', // PIN Code
      '', // Country
      '', // Plot Created At
      '', // Farm ID
      '', // Farm UID
      '', // Farm Area Size
      '', // Crop Type
      '', // Farm Plantation Type
      '', // Planting Method
      '', // Soil Type
      '', // Farm Address
      '', // Farm Created At
      '', // Irrigation Type (Farm)
      '', // Emitters Count (Farm)
      '', // Flow Rate LPH (Farm)
      '', // Plants Per Acre (Farm)
      '', // Distance Motor to Plot
      '', // Motor Horsepower
      '', // Pipe Width
      ''  // Irrigation Status
    ];
    
    // If no plots, add the basic farmer row
    if (!farmer.plots || farmer.plots.length === 0) {
      csvData.push(farmerRow);
    } else {
      // Add detailed rows for each plot and farm
      farmer.plots.forEach((plot: any) => {
        if (plot.farms && plot.farms.length > 0) {
          plot.farms.forEach((farm: any) => {
            if (farm.irrigations && farm.irrigations.length > 0) {
              farm.irrigations.forEach((irrigation: any) => {
                const detailedRow = [...farmerRow];
                // Fill plot data
                detailedRow[20] = plot.id || 'N/A'; // Plot ID
                detailedRow[21] = plot.plot_number || 'N/A'; // Plot Number
                detailedRow[22] = plot.gat_number || 'N/A'; // Gat Number
                detailedRow[23] = formatAcresFromHectaresOrNA(plot.area_size); // Plot Area Size (acres)
                detailedRow[24] = plot.village || 'N/A'; // Plot Village
                detailedRow[25] = plot.state || 'N/A'; // Plot State
                detailedRow[26] = plot.district || 'N/A'; // Plot District
                detailedRow[27] = plot.taluka || 'N/A'; // Plot Taluka
                detailedRow[28] = plot.pin_code || 'N/A'; // PIN Code
                detailedRow[29] = plot.country || 'N/A'; // Country
                detailedRow[30] = plot.created_at ? new Date(plot.created_at).toLocaleDateString('en-GB') : 'N/A'; // Plot Created At
                
                // Fill farm data
                detailedRow[31] = farm.id || 'N/A'; // Farm ID
                detailedRow[32] = farm.farm_uid || 'N/A'; // Farm UID
                detailedRow[33] = formatAcresFromHectaresOrNA(farm.area_size); // Farm Area Size (acres)
                detailedRow[34] = farm.crop_type || 'N/A'; // Crop Type
                detailedRow[35] = farm.plantation_type || 'N/A'; // Farm Plantation Type
                detailedRow[36] = farm.planting_method || 'N/A'; // Planting Method
                detailedRow[37] = farm.soil_type || 'N/A'; // Soil Type
                detailedRow[38] = farm.address || 'N/A'; // Farm Address
                detailedRow[39] = farm.created_at ? new Date(farm.created_at).toLocaleDateString('en-GB') : 'N/A'; // Farm Created At
                
                // Fill irrigation data
                detailedRow[40] = irrigation.irrigation_type || 'N/A'; // Irrigation Type (Farm)
                detailedRow[41] = irrigation.emitters_count || 'N/A'; // Emitters Count (Farm)
                detailedRow[42] = irrigation.flow_rate_lph || 'N/A'; // Flow Rate LPH (Farm)
                detailedRow[43] = irrigation.plants_per_acre || 'N/A'; // Plants Per Acre (Farm)
                detailedRow[44] = irrigation.distance_motor_to_plot_m || 'N/A'; // Distance Motor to Plot
                detailedRow[45] = irrigation.motor_horsepower || 'N/A'; // Motor Horsepower
                detailedRow[46] = irrigation.pipe_width_inches || 'N/A'; // Pipe Width
                detailedRow[47] = irrigation.status ? 'Active' : 'Inactive'; // Irrigation Status
                
                csvData.push(detailedRow);
              });
            } else {
              // No irrigation data, just farm data
              const farmRow = [...farmerRow];
              // Fill plot data
              farmRow[20] = plot.id || 'N/A';
              farmRow[21] = plot.plot_number || 'N/A';
              farmRow[22] = plot.gat_number || 'N/A';
              farmRow[23] = formatAcresFromHectaresOrNA(plot.area_size);
              farmRow[24] = plot.village || 'N/A';
              farmRow[25] = plot.state || 'N/A';
              farmRow[26] = plot.district || 'N/A';
              farmRow[27] = plot.taluka || 'N/A';
              farmRow[28] = plot.pin_code || 'N/A';
              farmRow[29] = plot.country || 'N/A';
              farmRow[30] = plot.created_at ? new Date(plot.created_at).toLocaleDateString('en-GB') : 'N/A';
              
              // Fill farm data
              farmRow[31] = farm.id || 'N/A';
              farmRow[32] = farm.farm_uid || 'N/A';
              farmRow[33] = formatAcresFromHectaresOrNA(farm.area_size);
              farmRow[34] = farm.crop_type || 'N/A';
              farmRow[35] = farm.plantation_type || 'N/A';
              farmRow[36] = farm.planting_method || 'N/A';
              farmRow[37] = farm.soil_type || 'N/A';
              farmRow[38] = farm.address || 'N/A';
              farmRow[39] = farm.created_at ? new Date(farm.created_at).toLocaleDateString('en-GB') : 'N/A';
              
              csvData.push(farmRow);
            }
          });
        } else {
          // No farms, just plot data
          const plotRow = [...farmerRow];
          plotRow[20] = plot.id || 'N/A';
          plotRow[21] = plot.plot_number || 'N/A';
          plotRow[22] = plot.gat_number || 'N/A';
          plotRow[23] = formatAcresFromHectaresOrNA(plot.area_size);
          plotRow[24] = plot.village || 'N/A';
          plotRow[25] = plot.state || 'N/A';
          plotRow[26] = plot.district || 'N/A';
          plotRow[27] = plot.taluka || 'N/A';
          plotRow[28] = plot.pin_code || 'N/A';
          plotRow[29] = plot.country || 'N/A';
          plotRow[30] = plot.created_at ? new Date(plot.created_at).toLocaleDateString('en-GB') : 'N/A';
          
          csvData.push(plotRow);
        }
      });
    }
    
    // Convert to CSV string
    const csvContent = csvData
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');
    
    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${farmer.farmer_name.replace(/\s+/g, '_')}_Farm_Details.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBulkDownload = async () => {
    if (selectedFarmers.size === 0) {
      alert('Please select at least one farmer to download.');
      return;
    }

    setDownloading(true);
    try {
      // Simulate async filter operation
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Get selected farmers data
      const selectedFarmersData = displayUsers.filter(farmer => selectedFarmers.has(farmer.id));
    
    // Create comprehensive CSV data for all selected farmers with proper columns
    const csvData = [];
    
    // Add header row with all column names
    csvData.push([
      'Farmer ID',
      'Farmer Name',
      'First Name',
      'Last Name',
      'Email',
      'Phone Number',
      'Address',
      'Village',
      'State',
      'District',
      'Taluka',
      'Created Date',
      'Total Area (acres)',
      'Total Area (hectares)',
      'Plantation Type',
      'Crop Type',
      'Crop Variety',
      'Irrigation Type',
      'Emitters Count',
      'Flow Rate (LPH)',
      'Plants Per Acre',
      'Plot ID',
      'Plot Number',
      'Gat Number',
      'Plot Area Size (acres)',
      'Plot Village',
      'Plot State',
      'Plot District',
      'Plot Taluka',
      'PIN Code',
      'Country',
      'Plot Created At',
      'Farm ID',
      'Farm UID',
      'Farm Area Size (acres)',
      'Crop Type',
      'Farm Plantation Type',
      'Planting Method',
      'Soil Type',
      'Farm Address',
      'Farm Created At',
      'Irrigation Type (Farm)',
      'Emitters Count (Farm)',
      'Flow Rate LPH (Farm)',
      'Plants Per Acre (Farm)',
      'Distance Motor to Plot (m)',
      'Motor Horsepower',
      'Pipe Width (inches)',
      'Irrigation Status'
    ]);
    
    // Process each selected farmer
    selectedFarmersData.forEach((farmer) => {
      // Create base farmer row
      const totalAreaAcres = formatAcresValue(farmer.area);
      const totalAreaHectares = acresToHectares(farmer.area).toFixed(2);

      const farmerRow = [
        farmer.id,
        farmer.farmer_name,
        farmer.first_name || 'N/A',
        farmer.last_name || 'N/A',
        farmer.email || 'N/A',
        farmer.phone_number,
        farmer.address || 'N/A',
        farmer.village || 'N/A',
        farmer.state || 'N/A',
        farmer.district || 'N/A',
        farmer.taluka || 'N/A',
        farmer.created_at ? new Date(farmer.created_at).toLocaleDateString('en-GB') : 'N/A',
        totalAreaAcres,
        totalAreaHectares,
        farmer.plantation_type,
        farmer.crop_type,
      farmer.crop_variety || 'N/A',
        farmer.irrigation?.irrigation_type || 'N/A',
        farmer.irrigation?.emitters_count || 'N/A',
        farmer.irrigation?.flow_rate_lph || 'N/A',
        farmer.irrigation?.plants_per_acre || 'N/A',
        '', // Plot ID - will be filled if plots exist
        '', // Plot Number
        '', // Gat Number
        '', // Plot Area Size
        '', // Plot Village
        '', // Plot State
        '', // Plot District
        '', // Plot Taluka
        '', // PIN Code
        '', // Country
        '', // Plot Created At
        '', // Farm ID
        '', // Farm UID
        '', // Farm Area Size
        '', // Crop Type
        '', // Farm Plantation Type
        '', // Planting Method
        '', // Soil Type
        '', // Farm Address
        '', // Farm Created At
        '', // Irrigation Type (Farm)
        '', // Emitters Count (Farm)
        '', // Flow Rate LPH (Farm)
        '', // Plants Per Acre (Farm)
        '', // Distance Motor to Plot
        '', // Motor Horsepower
        '', // Pipe Width
        ''  // Irrigation Status
      ];
      
      // If no plots, add the basic farmer row
      if (!farmer.plots || farmer.plots.length === 0) {
        csvData.push(farmerRow);
      } else {
        // Add detailed rows for each plot and farm
        farmer.plots.forEach((plot: any) => {
          if (plot.farms && plot.farms.length > 0) {
            plot.farms.forEach((farm: any) => {
              if (farm.irrigations && farm.irrigations.length > 0) {
                farm.irrigations.forEach((irrigation: any) => {
                  const detailedRow = [...farmerRow];
                  // Fill plot data
                  detailedRow[20] = plot.id || 'N/A'; // Plot ID
                  detailedRow[21] = plot.plot_number || 'N/A'; // Plot Number
                  detailedRow[22] = plot.gat_number || 'N/A'; // Gat Number
                detailedRow[23] = formatAcresFromHectaresOrNA(plot.area_size); // Plot Area Size (acres)
                  detailedRow[24] = plot.village || 'N/A'; // Plot Village
                  detailedRow[25] = plot.state || 'N/A'; // Plot State
                  detailedRow[26] = plot.district || 'N/A'; // Plot District
                  detailedRow[27] = plot.taluka || 'N/A'; // Plot Taluka
                  detailedRow[28] = plot.pin_code || 'N/A'; // PIN Code
                  detailedRow[29] = plot.country || 'N/A'; // Country
                  detailedRow[30] = plot.created_at ? new Date(plot.created_at).toLocaleDateString('en-GB') : 'N/A'; // Plot Created At
                  
                  // Fill farm data
                  detailedRow[31] = farm.id || 'N/A'; // Farm ID
                  detailedRow[32] = farm.farm_uid || 'N/A'; // Farm UID
                detailedRow[33] = formatAcresFromHectaresOrNA(farm.area_size); // Farm Area Size (acres)
                  detailedRow[34] = farm.crop_type || 'N/A'; // Crop Type
                  detailedRow[35] = farm.plantation_type || 'N/A'; // Farm Plantation Type
                  detailedRow[36] = farm.planting_method || 'N/A'; // Planting Method
                  detailedRow[37] = farm.soil_type || 'N/A'; // Soil Type
                  detailedRow[38] = farm.address || 'N/A'; // Farm Address
                  detailedRow[39] = farm.created_at ? new Date(farm.created_at).toLocaleDateString('en-GB') : 'N/A'; // Farm Created At
                  
                  // Fill irrigation data
                  detailedRow[40] = irrigation.irrigation_type || 'N/A'; // Irrigation Type (Farm)
                  detailedRow[41] = irrigation.emitters_count || 'N/A'; // Emitters Count (Farm)
                  detailedRow[42] = irrigation.flow_rate_lph || 'N/A'; // Flow Rate LPH (Farm)
                  detailedRow[43] = irrigation.plants_per_acre || 'N/A'; // Plants Per Acre (Farm)
                  detailedRow[44] = irrigation.distance_motor_to_plot_m || 'N/A'; // Distance Motor to Plot
                  detailedRow[45] = irrigation.motor_horsepower || 'N/A'; // Motor Horsepower
                  detailedRow[46] = irrigation.pipe_width_inches || 'N/A'; // Pipe Width
                  detailedRow[47] = irrigation.status ? 'Active' : 'Inactive'; // Irrigation Status
                  
                  csvData.push(detailedRow);
                });
              } else {
                // No irrigation data, just farm data
                const farmRow = [...farmerRow];
                // Fill plot data
                farmRow[20] = plot.id || 'N/A';
                farmRow[21] = plot.plot_number || 'N/A';
                farmRow[22] = plot.gat_number || 'N/A';
              farmRow[23] = formatAcresFromHectaresOrNA(plot.area_size);
                farmRow[24] = plot.village || 'N/A';
                farmRow[25] = plot.state || 'N/A';
                farmRow[26] = plot.district || 'N/A';
                farmRow[27] = plot.taluka || 'N/A';
                farmRow[28] = plot.pin_code || 'N/A';
                farmRow[29] = plot.country || 'N/A';
                farmRow[30] = plot.created_at ? new Date(plot.created_at).toLocaleDateString('en-GB') : 'N/A';
                
                // Fill farm data
                farmRow[31] = farm.id || 'N/A';
                farmRow[32] = farm.farm_uid || 'N/A';
              farmRow[33] = formatAcresFromHectaresOrNA(farm.area_size);
                farmRow[34] = farm.crop_type || 'N/A';
                farmRow[35] = farm.plantation_type || 'N/A';
                farmRow[36] = farm.planting_method || 'N/A';
                farmRow[37] = farm.soil_type || 'N/A';
                farmRow[38] = farm.address || 'N/A';
                farmRow[39] = farm.created_at ? new Date(farm.created_at).toLocaleDateString('en-GB') : 'N/A';
                
                csvData.push(farmRow);
              }
            });
          } else {
            // No farms, just plot data
            const plotRow = [...farmerRow];
            plotRow[20] = plot.id || 'N/A';
            plotRow[21] = plot.plot_number || 'N/A';
            plotRow[22] = plot.gat_number || 'N/A';
            plotRow[23] = formatAcresFromHectaresOrNA(plot.area_size);
            plotRow[24] = plot.village || 'N/A';
            plotRow[25] = plot.state || 'N/A';
            plotRow[26] = plot.district || 'N/A';
            plotRow[27] = plot.taluka || 'N/A';
            plotRow[28] = plot.pin_code || 'N/A';
            plotRow[29] = plot.country || 'N/A';
            plotRow[30] = plot.created_at ? new Date(plot.created_at).toLocaleDateString('en-GB') : 'N/A';
            
            csvData.push(plotRow);
          }
        });
      }
    });
    
    // Convert to CSV string
    const csvContent = csvData
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `Selected_Farmers_Details_${selectedFarmers.size}_farmers.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clear selection after download
    setSelectedFarmers(new Set());
    } finally {
      setDownloading(false);
    }
  };


  // Filter with loading state
  const [filtered, setFiltered] = useState<Farmer[]>([]);
  
  useEffect(() => {
    const performFilter = async () => {
      // Only show loading if there's a search term or if we have data to filter
      if (searchTerm || displayUsers.length > 0) {
        setFiltering(true);
      }
      
      try {
        // Simulate async filter operation for better UX (only if search term exists)
        if (searchTerm) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        const result = displayUsers.filter(
          (user) =>
            user.farmer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.phone_number.toString().includes(searchTerm) ||
            (user.email && user.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (user.address && user.address.toLowerCase().includes(searchTerm.toLowerCase())) ||
            formatAcresValue(user.area).includes(searchTerm) ||
            user.plantation_date.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.plantation_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.crop_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (user.crop_variety && user.crop_variety.toLowerCase().includes(searchTerm.toLowerCase()))
        );
        setFiltered(result);
      } finally {
        setFiltering(false);
      }
    };
    
    performFilter();
  }, [displayUsers, searchTerm]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginatedData = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

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
              <LandPlot className="h-12 w-12 text-white" />
              <h1 className="text-4xl font-bold text-white">Farmlist</h1>
            </div>
          </div>

          {/* Content Card */}
          <div className="bg-white rounded shadow-md p-2 sm:p-4 bg-opacity-95">
            {/* Header Section - Responsive */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 gap-4">

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
            {selectedFarmers.size > 0 && (
              <button 
                onClick={handleBulkDownload}
                disabled={downloading}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white px-3 sm:px-4 py-2 rounded-lg flex items-center justify-center transition-colors text-sm sm:text-base"
              >
                {downloading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    <span className="hidden sm:inline">Processing...</span>
                    <span className="sm:hidden">Processing...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    <span className="hidden sm:inline">Download Selected ({selectedFarmers.size})</span>
                    <span className="sm:hidden">Download ({selectedFarmers.size})</span>
                  </>
                )}
              </button>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-gray-400 h-4 w-4" />
              <input
                type="text"
                placeholder="Search farmers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-10 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 text-sm sm:text-base"
              />
              {filtering && (
                <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-blue-500" />
              )}
            </div>
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-100 text-gray-600">
              <tr>
                <th className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selectedFarmers.size === paginatedData.length && paginatedData.length > 0}
                    onChange={handleSelectAll}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                  />
                </th>
                <th className="px-4 py-2">Farmer Name</th>
                <th className="px-4 py-2">Phone Number</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Address</th>
                <th className="px-4 py-2">Area (acres)</th>
                <th className="px-4 py-2">Plantation Date</th>
                <th className="px-4 py-2">Plantation Type</th>
                <th className="px-4 py-2">Crop Type</th>
                <th className="px-4 py-2">Crop Variety</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="text-center py-8">
                    <div className="flex items-center justify-center">
                      <Loader2 className="w-6 h-6 animate-spin mr-2" />
                      Loading farms data...
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={11} className="text-center py-8 text-red-600">
                    Error: {error}
                  </td>
                </tr>
              ) : filtering ? (
                <tr>
                  <td colSpan={11} className="text-center py-8">
                    <div className="flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin mr-2 text-blue-500" />
                      <span className="text-gray-600">Filtering results...</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-4">No farms found</td>
                </tr>
              ) : (
                paginatedData.map((user) => (
                  <tr key={user.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={selectedFarmers.has(user.id)}
                        onChange={() => handleSelectFarmer(user.id)}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-2 font-medium">{user.farmer_name}</td>
                    <td className="px-4 py-2">{user.phone_number}</td>
                    <td className="px-4 py-2">{user.email || 'N/A'}</td>
                    <td className="px-4 py-2 max-w-[12rem] truncate" title={user.address || 'N/A'}>
                      {user.address || 'N/A'}
                    </td>
                    <td className="px-4 py-2">{formatAcresValue(user.area)} acres</td>
                    <td className="px-4 py-2">{user.plantation_date}</td>
                    <td className="px-4 py-2">{user.plantation_type}</td>
                    <td className="px-4 py-2">{user.crop_type}</td>
                    <td className="px-4 py-2">{user.crop_variety || 'N/A'}</td>
                    <td className="px-4 py-2 space-x-3">
                      <button 
                        onClick={() => handleViewDetails(user)} 
                        className="text-green-600 hover:text-green-800"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDownloadFarmer(user)} 
                        className="text-purple-600 hover:text-purple-800"
                        title="Download Details"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleEdit(user.id)} className="text-blue-600 hover:text-blue-800">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(user.id)} 
                        disabled={deleting === user.id}
                        className="text-red-600 hover:text-red-800 disabled:text-red-400 disabled:cursor-not-allowed"
                        title={deleting === user.id ? "Deleting..." : "Delete"}
                      >
                        {deleting === user.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="lg:hidden">
          {loading ? (
            <div className="text-center py-8">
              <div className="flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                Loading farms data...
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-600">
              Error: {error}
            </div>
          ) : filtering ? (
            <div className="text-center py-8">
              <div className="flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin mr-2 text-blue-500" />
                <span className="text-gray-600">Filtering results...</span>
              </div>
            </div>
          ) : paginatedData.length === 0 ? (
            <div className="text-center py-4">No farms found</div>
          ) : (
            <div className="space-y-4">
              {/* Select All for Mobile */}
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedFarmers.size === paginatedData.length && paginatedData.length > 0}
                    onChange={handleSelectAll}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700">Select All</span>
                </label>
                {selectedFarmers.size > 0 && (
                  <span className="text-sm text-blue-600 font-medium">
                    {selectedFarmers.size} selected
                  </span>
                )}
              </div>

              {/* Farmer Cards */}
              {paginatedData.map((user) => (
                <div key={user.id} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedFarmers.has(user.id)}
                        onChange={() => handleSelectFarmer(user.id)}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 mr-3"
                      />
                      <div>
                        <h3 className="font-semibold text-gray-900 text-base">{user.farmer_name}</h3>
                        <p className="text-sm text-gray-600">{user.phone_number}</p>
                        <p className="text-sm text-gray-600">{user.email || 'N/A'}</p>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button 
                        onClick={() => handleViewDetails(user)} 
                        className="p-2 text-green-600 hover:text-green-800 hover:bg-green-50 rounded-lg transition-colors"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDownloadFarmer(user)} 
                        className="p-2 text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded-lg transition-colors"
                        title="Download Details"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="col-span-2">
                      <span className="text-gray-500">Address:</span>
                      <p className="font-medium">{user.address || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Area:</span>
                      <p className="font-medium">{formatAcresValue(user.area)} acres</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Plantation Date:</span>
                      <p className="font-medium">{user.plantation_date}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Plantation Type:</span>
                      <p className="font-medium">{user.plantation_type}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Crop Type:</span>
                      <p className="font-medium">{user.crop_type}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Crop Variety:</span>
                      <p className="font-medium">{user.crop_variety || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Actions:</span>
                      <div className="flex space-x-2 mt-1">
                        <button 
                          onClick={() => handleEdit(user.id)} 
                          className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                          title="Edit"
                        >
                          <Edit className="w-3 h-3" />
                        </button>
                        <button 
                          onClick={() => handleDelete(user.id)}
                          disabled={deleting === user.id}
                          className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 disabled:text-red-400 disabled:cursor-not-allowed rounded transition-colors"
                          title={deleting === user.id ? "Deleting..." : "Delete"}
                        >
                          {deleting === user.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Responsive Pagination */}
        <div className="mt-4 flex flex-col sm:flex-row justify-between items-center gap-3 text-sm text-gray-600">
          <p className="text-center sm:text-left">
            Showing {paginatedData.length} of {filtered.length} entries
          </p>
          <div className="flex items-center space-x-2">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              Previous
            </button>
            <span className="px-2 py-1 bg-gray-100 rounded text-sm">
              Page {currentPage} of {totalPages}
            </span>
            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
              className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              Next
            </button>
          </div>
        </div>
          </div>
        </div>

      {/* Farm Details Modal - Responsive */}
      {isModalOpen && selectedFarmer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="bg-blue-600 text-white p-3 sm:p-4 rounded-t-lg flex justify-between items-center">
              <h2 className="text-lg sm:text-xl font-semibold truncate pr-2">
                {selectedFarmer.farmer_name}'s Farm Details
              </h2>
              <div className="flex items-center space-x-2">
                {!isViewModalEditMode ? (
                  <button
                    onClick={() => setIsViewModalEditMode(true)}
                    className="px-3 py-1.5 bg-white text-blue-600 rounded-md hover:bg-gray-100 transition-colors text-sm font-medium flex items-center"
                    title="Edit Details"
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    Edit
                  </button>
                ) : (
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => {
                        setIsViewModalEditMode(false);
                        initializeViewModalEditForms(selectedFarmer);
                      }}
                      className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors text-sm font-medium"
                      disabled={savingViewModalEdit}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveViewModalEdit}
                      disabled={savingViewModalEdit}
                      className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm font-medium flex items-center disabled:opacity-50"
                    >
                      {savingViewModalEdit ? (
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
                  </div>
                )}
                <button 
                  onClick={closeModal}
                  className="text-white hover:text-gray-200 transition-colors flex-shrink-0"
                >
                  <X className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              </div>
            </div>

            <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
              {viewModalEditError && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  {viewModalEditError}
                </div>
              )}

              {/* Farmer Information */}
              <div className="bg-gray-50 rounded-lg p-3 sm:p-4">
                <div className="flex items-center mb-3 sm:mb-4">
                  <User className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 mr-2" />
                  <h3 className="text-base sm:text-lg font-semibold text-gray-800">Farmer Information</h3>
                </div>
                {isViewModalEditMode ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                      <input
                        type="text"
                        value={viewModalEditForm.first_name || ''}
                        onChange={(e) => setViewModalEditForm({ ...viewModalEditForm, first_name: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={savingViewModalEdit}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                      <input
                        type="text"
                        value={viewModalEditForm.last_name || ''}
                        onChange={(e) => setViewModalEditForm({ ...viewModalEditForm, last_name: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={savingViewModalEdit}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                      <input
                        type="tel"
                        value={viewModalEditForm.phone_number || ''}
                        onChange={(e) => setViewModalEditForm({ ...viewModalEditForm, phone_number: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={savingViewModalEdit}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input
                        type="email"
                        value={viewModalEditForm.email || ''}
                        onChange={(e) => setViewModalEditForm({ ...viewModalEditForm, email: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={savingViewModalEdit}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                      <input
                        type="text"
                        value={viewModalEditForm.address || ''}
                        onChange={(e) => setViewModalEditForm({ ...viewModalEditForm, address: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={savingViewModalEdit}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Taluka</label>
                      <input
                        type="text"
                        value={viewModalEditForm.taluka || ''}
                        onChange={(e) => setViewModalEditForm({ ...viewModalEditForm, taluka: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={savingViewModalEdit}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                      <input
                        type="text"
                        value={viewModalEditForm.state || ''}
                        onChange={(e) => setViewModalEditForm({ ...viewModalEditForm, state: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={savingViewModalEdit}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">District</label>
                      <input
                        type="text"
                        value={viewModalEditForm.district || ''}
                        onChange={(e) => setViewModalEditForm({ ...viewModalEditForm, district: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={savingViewModalEdit}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-xs text-gray-500">Created: {selectedFarmer.created_at ? new Date(selectedFarmer.created_at).toLocaleDateString('en-GB') : 'N/A'}</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div className="space-y-2">
                      <p className="text-sm sm:text-base"><span className="font-medium">Name:</span> {selectedFarmer.farmer_name}</p>
                      <p className="text-sm sm:text-base"><span className="font-medium">Phone:</span> {selectedFarmer.phone_number}</p>
                      <p className="text-sm sm:text-base"><span className="font-medium">Taluka:</span> {selectedFarmer.taluka || 'N/A'}</p>
                      <p className="text-sm sm:text-base"><span className="font-medium">State:</span> {selectedFarmer.state || 'N/A'}</p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm sm:text-base"><span className="font-medium">Email:</span> {selectedFarmer.email || 'N/A'}</p>
                      <p className="text-sm sm:text-base"><span className="font-medium">Address:</span> {selectedFarmer.address || 'N/A'}</p>
                      <p className="text-sm sm:text-base"><span className="font-medium">District:</span> {selectedFarmer.district || 'N/A'}</p>
                      <p className="text-sm sm:text-base"><span className="font-medium">Created:</span> {selectedFarmer.created_at ? new Date(selectedFarmer.created_at).toLocaleDateString('en-GB') : 'N/A'}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Total Farm Area */}
              <div className="bg-green-50 rounded-lg p-3 sm:p-4">
                <div className="flex items-center mb-2">
                  <Ruler className="w-4 h-4 sm:w-5 sm:h-5 text-green-600 mr-2" />
                  <h3 className="text-base sm:text-lg font-semibold text-gray-800">Total Farm Area</h3>
                </div>
                <p className="text-lg sm:text-2xl font-bold text-green-600">
                  {formatAcresValue(selectedFarmer.area)} acres
                </p>
              </div>

              {/* Plot Details */}
              <div className="bg-gray-50 rounded-lg p-3 sm:p-4">
                <div className="flex items-center mb-3 sm:mb-4">
                  <Map className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 mr-2" />
                  <h3 className="text-base sm:text-lg font-semibold text-gray-800">
                    Plot Details ({selectedFarmer.plots?.length || 0} plots)
                  </h3>
                </div>
                
                {selectedFarmer.plots && selectedFarmer.plots.length > 0 ? (
                  selectedFarmer.plots.map((plot: any, index: number) => {
                    const plotId = plot.id?.toString() || `plot-${index}`;
                    const plotForm = viewModalPlotForms[plotId] || {
                      village: plot.village || '',
                      pin_code: plot.pin_code || '',
                      gat_number: plot.gat_number || '',
                      // If plot.area_size is missing, fall back to total farm area (selectedFarmer.area)
                      // so "Area" doesn't show as N/A.
                      area_size:
                        plot.area_size !== null &&
                        plot.area_size !== undefined &&
                        plot.area_size !== ''
                          ? formatAcresFromHectaresOrNA(plot.area_size)
                          : selectedFarmer?.area !== null &&
                            selectedFarmer?.area !== undefined
                            ? formatAcresValue(selectedFarmer.area)
                            : '0',
                    };

                    return (
                      <div key={index} className="bg-white rounded-lg p-3 sm:p-4 mb-3 sm:mb-4 border">
                        <h4 className="text-base sm:text-lg font-semibold text-green-600 mb-3">
                          Plot {index + 1} -{" "}
                          {isViewModalEditMode
                            ? `${plotForm.area_size} acres`
                            : `${(plot.area_size !== null && plot.area_size !== undefined && plot.area_size !== '') ? formatAcresFromHectaresOrNA(plot.area_size) : (selectedFarmer?.area !== null && selectedFarmer?.area !== undefined ? formatAcresValue(selectedFarmer.area) : 'N/A')} acres`}
                        </h4>
                        
                        {/* Plot Fields */}
                        {isViewModalEditMode ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Village</label>
                              <input
                                type="text"
                                value={plotForm.village}
                                onChange={(e) => handleViewModalPlotFormChange(plotId, 'village', e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                disabled={savingViewModalEdit}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">PIN Code</label>
                              <input
                                type="text"
                                value={plotForm.pin_code}
                                onChange={(e) => handleViewModalPlotFormChange(plotId, 'pin_code', e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                disabled={savingViewModalEdit}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Gat No</label>
                              <input
                                type="text"
                                value={plotForm.gat_number}
                                onChange={(e) => handleViewModalPlotFormChange(plotId, 'gat_number', e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                disabled={savingViewModalEdit}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Area (acres)</label>
                              <input
                                type="number"
                                step="0.01"
                                value={plotForm.area_size}
                                onChange={(e) => handleViewModalPlotFormChange(plotId, 'area_size', e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                disabled={savingViewModalEdit}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-4">
                            <div className="space-y-2">
                              <p className="text-sm sm:text-base"><span className="font-medium">Village:</span> {plot.village || 'N/A'}</p>
                              <p className="text-sm sm:text-base"><span className="font-medium">PIN Code:</span> {plot.pin_code || 'N/A'}</p>
                            </div>
                            <div className="space-y-2">
                              <p className="text-sm sm:text-base"><span className="font-medium">Gat No:</span> {plot.gat_number || 'N/A'}</p>
                              <p className="text-sm sm:text-base">
                                <span className="font-medium">Area:</span>{" "}
                                {(plot.area_size !== null && plot.area_size !== undefined && plot.area_size !== '')
                                  ? `${formatAcresFromHectaresOrNA(plot.area_size)}`
                                  : selectedFarmer?.area !== null &&
                                    selectedFarmer?.area !== undefined
                                  ? `${formatAcresValue(selectedFarmer.area)}`
                                  : 'N/A'}{" "}
                                acres
                              </p>
                            </div>
                          </div>
                        )}
                        
                        {plot.farms && plot.farms.length > 0 ? (
                          plot.farms.map((farm: any, farmIndex: number) => {
                            const farmId = farm.id?.toString() || `farm-${farmIndex}`;
                            const farmForm = viewModalFarmForms[farmId] || {
                              crop_type: farm.crop_type || '',
                              plantation_type: farm.plantation_type || '',
                              plantation_date: farm.plantation_date || '',
                              planting_method: farm.planting_method || '',
                              spacing_a: farm.spacing_a || '',
                              spacing_b: farm.spacing_b || '',
                              area_size: farm.area_size ? formatAcresFromHectaresOrNA(farm.area_size) : '0',
                            };
                            
                            // Get irrigation data from the first irrigation record
                            const irrigation = farm.irrigations && farm.irrigations.length > 0 ? farm.irrigations[0] : null;
                            const irrigationId = irrigation?.id?.toString() || `irrigation-${farmIndex}`;
                            const irrigationForm = irrigation ? (viewModalIrrigationForms[irrigationId] || {
                              irrigation_type: irrigation.irrigation_type || '',
                              plants_per_acre: irrigation.plants_per_acre || '',
                              flow_rate_lph: irrigation.flow_rate_lph || '',
                              emitters_count: irrigation.emitters_count || '',
                              motor_horsepower: irrigation.motor_horsepower || '',
                              pipe_width_inches: irrigation.pipe_width_inches || '',
                              distance_motor_to_plot_m: irrigation.distance_motor_to_plot_m || '',
                            }) : null;
                            
                            return (
                              <div key={farmIndex} className="border-t pt-3 sm:pt-4 mt-3 sm:mt-4">
                                <h5 className="text-sm sm:text-base font-semibold text-gray-700 mb-3">Farm {farmIndex + 1}</h5>
                                
                                {isViewModalEditMode ? (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-4">
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">Crop Type</label>
                                      <input
                                        type="text"
                                        value={farmForm.crop_type}
                                        onChange={(e) => handleViewModalFarmFormChange(farmId, 'crop_type', e.target.value)}
                                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        disabled={savingViewModalEdit}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">Crop Variety</label>
                                      <input
                                        type="text"
                                        value={farmForm.crop_variety || ''}
                                        onChange={(e) => handleViewModalFarmFormChange(farmId, 'crop_variety', e.target.value)}
                                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="Enter crop Variety"
                                        disabled={savingViewModalEdit}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">Plantation Type</label>
                                      <input
                                        type="text"
                                        value={farmForm.plantation_type}
                                        onChange={(e) => handleViewModalFarmFormChange(farmId, 'plantation_type', e.target.value)}
                                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        disabled={savingViewModalEdit}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">Plantation Date</label>
                                      <input
                                        type="date"
                                        value={farmForm.plantation_date}
                                        onChange={(e) => handleViewModalFarmFormChange(farmId, 'plantation_date', e.target.value)}
                                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        disabled={savingViewModalEdit}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">Plantation Method</label>
                                      <input
                                        type="text"
                                        value={farmForm.planting_method}
                                        onChange={(e) => handleViewModalFarmFormChange(farmId, 'planting_method', e.target.value)}
                                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        disabled={savingViewModalEdit}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">Spacing A</label>
                                      <input
                                        type="text"
                                        value={farmForm.spacing_a}
                                        onChange={(e) => handleViewModalFarmFormChange(farmId, 'spacing_a', e.target.value)}
                                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        disabled={savingViewModalEdit}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">Spacing B</label>
                                      <input
                                        type="text"
                                        value={farmForm.spacing_b}
                                        onChange={(e) => handleViewModalFarmFormChange(farmId, 'spacing_b', e.target.value)}
                                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        disabled={savingViewModalEdit}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">Area (acres)</label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={farmForm.area_size}
                                        onChange={(e) => handleViewModalFarmFormChange(farmId, 'area_size', e.target.value)}
                                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        disabled={savingViewModalEdit}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-4">
                                    <div className="space-y-2">
                                      <p className="text-sm sm:text-base"><span className="font-medium">Variety:</span> {farm.crop_type || 'N/A'}</p>
                                      <p className="text-sm sm:text-base"><span className="font-medium">Plantation Date:</span> {farm.plantation_date || 'N/A'}</p>
                                      <p className="text-sm sm:text-base"><span className="font-medium">Spacing A:</span> {farm.spacing_a || 'N/A'}</p>
                                    </div>
                                    <div className="space-y-2">
                                      <p className="text-sm sm:text-base"><span className="font-medium">Plantation Type:</span> {farm.plantation_type || 'N/A'}</p>
                                      <p className="text-sm sm:text-base"><span className="font-medium">Spacing B:</span> {farm.spacing_b || 'N/A'}</p>
                                    </div>
                                    <div className="space-y-2">
                                      <p className="text-sm sm:text-base"><span className="font-medium">Plantation Method:</span> {farm.planting_method || 'N/A'}</p>
                                    </div>
                                  </div>
                                )}

                                {/* Irrigation Details */}
                                {irrigation && (
                                  <div className="border-t pt-3 sm:pt-4 mt-3 sm:mt-4">
                                    <div className="flex items-center mb-3 sm:mb-4">
                                      <Droplets className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 mr-2" />
                                      <h4 className="text-base sm:text-lg font-semibold text-gray-900">
                                      {(() => {
                                          const type = irrigationForm?.irrigation_type || irrigation.irrigation_type;
                                          return type === "Flood Irrigation" || type === "flood"
                                            ? "Flood Irrigation Details"
                                            : "Drip Irrigation Details";
                                        })()}
                                      </h4>
                                    </div>
                                    {isViewModalEditMode && irrigationForm ? (
                                      irrigationForm.irrigation_type === "Drip Irrigation" || irrigationForm.irrigation_type === "drip" ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                                          <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Irrigation Type</label>
                                            <select
                                              value={irrigationForm.irrigation_type}
                                              onChange={(e) => handleViewModalIrrigationFormChange(irrigationId, 'irrigation_type', e.target.value)}
                                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                              disabled={savingViewModalEdit}
                                            >
                                              <option value="drip">Drip Irrigation</option>
                                              <option value="flood">Flood Irrigation</option>
                                            </select>
                                          </div>
                                          <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Plants/Acre</label>
                                            <input
                                              type="number"
                                              value={irrigationForm.plants_per_acre}
                                              onChange={(e) => handleViewModalIrrigationFormChange(irrigationId, 'plants_per_acre', e.target.value)}
                                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                              disabled={savingViewModalEdit}
                                            />
                                          </div>
                                          <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Flow Rate (LPH)</label>
                                            <input
                                              type="number"
                                              value={irrigationForm.flow_rate_lph}
                                              onChange={(e) => handleViewModalIrrigationFormChange(irrigationId, 'flow_rate_lph', e.target.value)}
                                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                              disabled={savingViewModalEdit}
                                            />
                                          </div>
                                          <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Emitters</label>
                                            <input
                                              type="number"
                                              value={irrigationForm.emitters_count}
                                              onChange={(e) => handleViewModalIrrigationFormChange(irrigationId, 'emitters_count', e.target.value)}
                                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                              disabled={savingViewModalEdit}
                                            />
                                          </div>
                                        </div>
                                      ) : irrigationForm.irrigation_type === "Flood Irrigation" || irrigationForm.irrigation_type === "flood" ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                                          <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Irrigation Type</label>
                                            <select
                                              value={irrigationForm.irrigation_type}
                                              onChange={(e) => handleViewModalIrrigationFormChange(irrigationId, 'irrigation_type', e.target.value)}
                                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                              disabled={savingViewModalEdit}
                                            >
                                              <option value="drip">Drip Irrigation</option>
                                              <option value="flood">Flood Irrigation</option>
                                            </select>
                                          </div>
                                          <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Motor Horsepower (HP)</label>
                                            <input
                                              type="number"
                                              step="0.1"
                                              value={irrigationForm.motor_horsepower}
                                              onChange={(e) => handleViewModalIrrigationFormChange(irrigationId, 'motor_horsepower', e.target.value)}
                                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                              disabled={savingViewModalEdit}
                                            />
                                          </div>
                                          <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Pipe Width (inches)</label>
                                            <input
                                              type="number"
                                              step="0.1"
                                              value={irrigationForm.pipe_width_inches}
                                              onChange={(e) => handleViewModalIrrigationFormChange(irrigationId, 'pipe_width_inches', e.target.value)}
                                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                              disabled={savingViewModalEdit}
                                            />
                                          </div>
                                          <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Distance from Motor (m)</label>
                                            <input
                                              type="number"
                                              step="0.1"
                                              value={irrigationForm.distance_motor_to_plot_m}
                                              onChange={(e) => handleViewModalIrrigationFormChange(irrigationId, 'distance_motor_to_plot_m', e.target.value)}
                                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                              disabled={savingViewModalEdit}
                                            />
                                          </div>
                                        </div>
                                      ) : null
                                    ) : (
                                      irrigation.irrigation_type === "Drip Irrigation" || irrigation.irrigation_type === "drip" ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                                          <div className="space-y-2">
                                            <p className="text-sm sm:text-base"><span className="font-medium">Plants/Acre:</span> {irrigation?.plants_per_acre || 'N/A'}</p>
                                          </div>
                                          <div className="space-y-2">
                                            <p className="text-sm sm:text-base"><span className="font-medium">Flow Rate:</span> {irrigation?.flow_rate_lph || 'N/A'} LPH</p>
                                          </div>
                                          <div className="space-y-2">
                                            <p className="text-sm sm:text-base"><span className="font-medium">Emitters:</span> {irrigation?.emitters_count || 'N/A'}</p>
                                          </div>
                                        </div>
                                      ) : irrigation.irrigation_type === "Flood Irrigation" || irrigation.irrigation_type === "flood" ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                                          <div className="space-y-2">
                                            <p className="text-sm sm:text-base"><span className="font-medium">Motor Horsepower :</span> {irrigation?.motor_horsepower || 'N/A'} HP</p>
                                          </div>
                                          <div className="space-y-2">
                                            <p className="text-sm sm:text-base"><span className="font-medium">Pipe Width:</span> {irrigation?.pipe_width_inches || 'N/A'} inches</p>
                                          </div>
                                          <div className="space-y-2">
                                            <p className="text-sm sm:text-base"><span className="font-medium">Distance from Motor:</span> {irrigation?.distance_motor_to_plot_m || 'N/A'} meters</p>
                                          </div>
                                        </div>
                                      ) : null
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-gray-500 text-sm sm:text-base">No farm details available for this plot.</p>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-gray-500 text-sm sm:text-base">No plot details available.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Farm Modal */}
      {isEditModalOpen && editingFarmer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="bg-blue-600 text-white p-4 rounded-t-lg flex justify-between items-center">
              <h2 className="text-xl font-semibold">Edit Farm Details</h2>
              <button 
                onClick={handleCloseEditModal}
                className="text-white hover:text-gray-200 transition-colors"
                disabled={savingEdit}
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {editError && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  {editError}
                </div>
              )}

              {/* Farmer Information Section */}
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Farmer Information</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Farmer Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Farmer Name
                    </label>
                    <input
                      type="text"
                      value={editForm.farmer_name}
                      onChange={(e) => setEditForm({ ...editForm, farmer_name: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      disabled={savingEdit}
                    />
                  </div>

                  {/* First Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      First Name
                    </label>
                    <input
                      type="text"
                      value={editForm.first_name}
                      onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      disabled={savingEdit}
                    />
                  </div>

                  {/* Last Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Last Name
                    </label>
                    <input
                      type="text"
                      value={editForm.last_name}
                      onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      disabled={savingEdit}
                    />
                  </div>

                  {/* Phone Number */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={editForm.phone_number}
                      onChange={(e) => setEditForm({ ...editForm, phone_number: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      disabled={savingEdit}
                    />
                  </div>
                </div>
              </div>

              {/* Farms Section */}
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-4">
                  Farms ({allFarms.length})
                </h3>
                {allFarms.length === 0 ? (
                  <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
                    No farms found for this farmer. You can still edit farmer details above.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {allFarms.map((farm: any, index: number) => {
                      const farmId = farm.id?.toString() || `farm-${index}`;
                      const farmForm = farmEditForms[farmId] || {
                        area: farm.area_size ? formatAcresFromHectaresOrNA(farm.area_size) : '0',
                        plantation_type: farm.plantation_type || '',
                        crop_type: farm.crop_type?.crop_type || farm.crop_type_name || farm.crop_type || 'Sugarcane',
                        crop_variety: farm.crop_type?.crop_variety || farm.crop_variety || '',
                      };

                      return (
                        <div key={farmId} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                          <h4 className="text-md font-semibold text-gray-700 mb-3">
                            Farm {index + 1} {farm.farm_uid ? `(ID: ${farm.farm_uid})` : `(ID: ${farm.id})`}
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {/* Area (acres) */}
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Area (acres)
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={farmForm.area}
                                onChange={(e) => handleFarmFormChange(farmId, 'area', e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                disabled={savingEdit}
                              />
                            </div>

                            {/* Plantation Type */}
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Plantation Type
                              </label>
                              <input
                                type="text"
                                value={farmForm.plantation_type}
                                onChange={(e) => handleFarmFormChange(farmId, 'plantation_type', e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                disabled={savingEdit}
                              />
                            </div>

                            {/* Crop Type */}
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Crop Type
                              </label>
                              <input
                                type="text"
                                value={farmForm.crop_type}
                                onChange={(e) => handleFarmFormChange(farmId, 'crop_type', e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                disabled={savingEdit}
                              />
                            </div>

                            {/* Crop Variety */}
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Crop Variety
                              </label>
                              <input
                                type="text"
                                value={farmForm.crop_variety}
                                onChange={(e) => handleFarmFormChange(farmId, 'crop_variety', e.target.value)}
                                placeholder="Enter crop Variety"
                                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                disabled={savingEdit}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-gray-50 px-6 py-4 rounded-b-lg flex justify-end space-x-3">
              <button
                onClick={handleCloseEditModal}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
                disabled={savingEdit}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {savingEdit ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};
