import React, { useState } from 'react';
import { Store } from 'lucide-react';
import { addVendor } from '../api'; // adjust path if necessary

interface AddVendorProps {
  setUsers: React.Dispatch<React.SetStateAction<any[]>>;
  users: any[];
}

interface AddVendorForm {
  vendorName: string;
  email: string;
  mobile: string;
  gstin: string;
  state: string;
  city: string;
  address: string;
}

export const Addvendor: React.FC<AddVendorProps> = ({ users, setUsers }) => {
  const [formData, setFormData] = useState<AddVendorForm>({
    vendorName: '',
    email: '',
    mobile: '',
    gstin: '',
    state: '',
    city: '',
    address: ''
  });

  const indianStates: string[] = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
    'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
    'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
    'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
    'West Bengal'
  ];

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess('');
    setError('');

    // Prepare payload - map frontend fields to API fields
    // API expects: vendor_name, contact_person, email, phone, address, gstin_number, state, city (optional)
    const payload: any = {
      vendor_name: formData.vendorName,
      email: formData.email,
      phone: formData.mobile, // Map mobile to phone (API expects 'phone')
      address: formData.address,
      // Always send these optional fields (even if empty) so backend can store them
      gstin_number: formData.gstin ? formData.gstin.trim() : '',
      state: formData.state ? formData.state.trim() : '',
      city: formData.city ? formData.city.trim() : '',
      // Default values for required fields that we don't have
      contact_person: formData.vendorName, // Use vendor name as contact person if not provided
      // rating is optional - don't send it since it's not collected in the form
    };

    try {
      const response = await addVendor(payload);
      
      // Transform API response to match User interface before updating local state
      // Use form data as fallback in case API response doesn't include all fields immediately
      if (response.data) {
        const newVendor = {
          id: response.data.id,
          vendorName: response.data.vendor_name || response.data.vendorName || response.data.name || formData.vendorName || '',
          vendor_name: response.data.vendor_name || response.data.vendorName || response.data.name || formData.vendorName || '',
          email: response.data.email || formData.email || '',
          mobile: response.data.mobile || response.data.phone_number || response.data.phone || formData.mobile || '',
          phone_number: response.data.phone_number || response.data.phone || response.data.mobile || formData.mobile || '',
          // Prioritize API response, but fallback to form data if API doesn't return it
          gstin: response.data.gstin || response.data.gstin_number || (formData.gstin ? formData.gstin.trim() : '') || '',
          state: response.data.state || (formData.state ? formData.state.trim() : '') || '',
          city: response.data.city || (formData.city ? formData.city.trim() : '') || '',
          address: response.data.address || formData.address || '',
        };
        setUsers([...users, newVendor]);
      }

      setSuccess('Vendor added successfully! The vendor list will be updated automatically.');
      
      // Reset form
    setFormData({
      vendorName: '',
      email: '',
      mobile: '',
      gstin: '',
      state: '',
      city: '',
      address: ''
    });
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccess('');
      }, 3000);
    } catch (err: any) {
      
      let errorMessage = 'Error adding vendor. Please try again.';
      
      if (err?.response?.status === 404) {
        errorMessage = 'API endpoint not found (404). Please check the server configuration.';
      } else if (err?.response?.status === 400) {
        const errorData = err?.response?.data;
        if (errorData) {
          // Extract field-specific errors
          const fieldErrors = Object.entries(errorData)
            .filter(([key]) => key !== 'detail' && key !== 'message')
            .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
            .join('; ');
          
          errorMessage = errorData.detail || errorData.message || fieldErrors || 'Invalid data format. Please check all fields.';
        } else {
          errorMessage = 'Invalid request format (400). Please check all required fields are filled.';
        }
      } else if (err?.response?.data) {
        errorMessage = err.response.data.detail || err.response.data.message || err.message || errorMessage;
      } else {
        errorMessage = err?.message || errorMessage;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen bg-cover bg-center bg-fixed"
      style={{
        backgroundImage: `url('/icons/sugarcane main slide.jpg')`
      }}
    >
      <div className="min-h-screen bg-black bg-opacity-40">
        <div className="max-w-4xl mx-auto px-4 py-12">
          {/* Title Section */}
          <div className="mb-8 text-center">
            <div className="flex items-center justify-center space-x-4">
              <Store className="h-12 w-12 text-white" />
              <h1 className="text-4xl font-bold text-white">VendorHub</h1>
            </div>
          </div>

          {/* Form Card */}
          <div className="bg-white rounded-xl shadow-lg p-8 bg-opacity-95">
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
              {[
                { label: 'Vendor Name', name: 'vendorName', required: true },
                { label: 'Email ID', name: 'email', type: 'email', required: true },
                { label: 'Mobile Number', name: 'mobile', type: 'tel', pattern: '[0-9]{10}', required: true },
                { label: 'GSTIN Number', name: 'gstin', required: false }
              ].map(({ label, name, type = 'text', pattern, required = true }) => (
                <div key={name}>
                  <label htmlFor={name} className="block text-base font-medium text-gray-700 mb-2">
                    {label}
                  </label>
                  <input
                    type={type}
                    name={name}
                    id={name}
                    required={required}
                    pattern={pattern}
                    value={formData[name as keyof AddVendorForm]}
                    onChange={handleChange}
                    className="block w-full px-4 py-3 text-base rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
                  />
                </div>
              ))}

              <div>
                <label htmlFor="state" className="block text-base font-medium text-gray-700 mb-2">State</label>
                <select
                  name="state"
                  id="state"
                  required
                  value={formData.state}
                  onChange={handleChange}
                  className="block w-full px-4 py-3 text-base rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
                >
                  <option value="">Select State</option>
                  {indianStates.map(state => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="city" className="block text-base font-medium text-gray-700 mb-2">City</label>
                <input
                  type="text"
                  name="city"
                  id="city"
                  required
                  value={formData.city}
                  onChange={handleChange}
                  className="block w-full px-4 py-3 text-base rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="address" className="block text-base font-medium text-gray-700 mb-2">Address</label>
              <textarea
                name="address"
                id="address"
                rows={4}
                required
                value={formData.address}
                onChange={handleChange}
                className="block w-full px-4 py-3 text-base rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-3 text-base font-medium text-white bg-green-500 border border-transparent rounded-lg shadow-sm hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Adding...' : 'Add Vendor'}
              </button>
            </div>
            
            {success && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
                {success}
              </div>
            )}
            
            {error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
                {error}
              </div>
            )}
          </form>
          </div>
        </div>
      </div>
    </div>
  );
};
