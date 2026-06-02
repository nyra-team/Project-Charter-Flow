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
  /** Per-app role from employee_auth.pmo_role. NULL = regular Project Hub
   *  user; 'admin' = PMO admin (gates admin-only UI like /admin/scoring). */
  pmo_role: "admin" | null;
  is_admin: boolean;
  is_super_admin: boolean;
}
