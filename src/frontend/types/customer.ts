export interface Customer {
  id: number;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  region: string;
  implementationType: string;
  vehicleCount: number;
  customerUsername?: string;
  locatorPlan?: string;
  address?: string;
}
