export interface PublicFactoryFarmer {
  id: number;
  farmer_name: string;
  phone_number: string;
  plantation_date: string | null;
  /** Sugarcane variety — from local/public-factory-farmers when available. */
  crop_variety?: string | null;
  /** Bud / planting method e.g. "3 Bud Method". */
  planting_method?: string | null;
  /** Season type e.g. Adsali / Pre-Seasonal (not the bud method). */
  plantation_type?: string | null;
  yield: number | null;
  date: string | null;
}

export interface PublicFactory {
  factory_id: number;
  factory_name: string;
  farmers_count: number;
  farmers: PublicFactoryFarmer[];
}

/** GET ?owner_id=5 — list all factories under an owner. */
export interface PublicFactoryFarmersListResponse {
  owner_id: number;
  factories_count: number;
  factories: PublicFactory[];
}

/** GET ?owner_id=5&name=... — single factory with farmers. */
export interface PublicFactoryByNameResponse {
  owner_id: number;
  factory_id: number;
  factory_name: string;
  farmers_count: number;
  farmers: PublicFactoryFarmer[];
}

export type FactoryId = string;
