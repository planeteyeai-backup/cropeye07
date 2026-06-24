export interface PublicFactoryFarmer {
  id: number;
  farmer_name: string;
  phone_number: string;
  plantation_date: string | null;
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
