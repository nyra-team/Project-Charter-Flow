export interface AuthUser {
  id: string;
  email: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  employee_code: string | null;
  employee_id: string | null;
  access_pmo: boolean;
  is_admin: boolean;
  is_super_admin: boolean;
}
