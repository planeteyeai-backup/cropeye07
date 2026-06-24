export interface YieldReading {
  yield: number;
  date: string;
}

export interface IndustrialYieldFarmer {
  id: number;
  farmer_name: string;
  phone_number: string;
  plantation_date: string | null;
  yields: YieldReading[];
}

export interface IndustrialYieldFactory {
  owner_id: number;
  factory_id: number;
  factory_name: string;
  farmers_count: number;
  farmers: IndustrialYieldFarmer[];
}

export interface IndustrialYieldByOwnerResponse {
  owner_id: number;
  factories_count: number;
  factories: IndustrialYieldFactory[];
}
