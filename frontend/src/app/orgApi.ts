/**
 * The organisation API — Story H16: departments, employees and HR grants.
 *
 * Thin wrappers over the shared `apiRequest`, so every call inherits the same
 * session, CSRF, timeout and error-envelope handling as the rest of the app. The
 * backend already refuses bad input with `error.fields`, and `ApiError` carries
 * that through, so callers can show WHICH field failed instead of a generic line.
 */
import { apiRequest } from "./api";

export type ServerEmployee = {
  id: number;
  email: string;
  full_name: string;
  role: "EMPLOYEE" | "MANAGER" | "HR";
  is_active: boolean;
  employee_number: string | null;
  job_title: string;
  manager_id: number | null;
  manager_name: string | null;
  department_id: number | null;
  department_code: string | null;
  department_name_ar: string | null;
  department_name_en: string | null;
};

export type ServerDepartment = {
  id: number;
  code: string;
  name_ar: string;
  name_en: string;
  is_active: boolean;
  manager_id: number | null;
  manager_name: string | null;
  member_count: number;
};

export type ServerGrant = {
  id: number;
  manager_id: number;
  manager_name: string;
  employee_id: number;
  employee_name: string;
  scope: string;
  is_active: boolean;
};

export type EmployeeInput = {
  email: string;
  full_name: string;
  role: "EMPLOYEE" | "MANAGER";
  department: number | null;
  manager?: number | null;
  job_title?: string;
  employee_number?: string;
};

/** The employee list is paginated by the backend; the roster reads the first page. */
export async function listEmployees(locale: string): Promise<ServerEmployee[]> {
  const payload = await apiRequest<{ data: ServerEmployee[] | { results: ServerEmployee[] } }>("/employees", {
    acceptLanguage: locale,
  });
  const data = payload.data;
  return Array.isArray(data) ? data : (data?.results ?? []);
}

export async function createEmployee(input: EmployeeInput, locale: string): Promise<ServerEmployee> {
  const payload = await apiRequest<{ data: ServerEmployee }>("/employees", {
    method: "POST",
    body: input,
    acceptLanguage: locale,
  });
  return payload.data;
}

export async function updateEmployee(
  id: number,
  patch: Partial<EmployeeInput> & { is_active?: boolean },
  locale: string,
): Promise<ServerEmployee> {
  const payload = await apiRequest<{ data: ServerEmployee }>(`/employees/${id}`, {
    method: "PATCH",
    body: patch,
    acceptLanguage: locale,
  });
  return payload.data;
}

export async function listDepartments(locale: string): Promise<ServerDepartment[]> {
  const payload = await apiRequest<{ data: ServerDepartment[] }>("/departments", { acceptLanguage: locale });
  return payload.data ?? [];
}

export async function createDepartment(
  input: { code: string; name_ar: string; name_en?: string; manager?: number | null },
  locale: string,
): Promise<ServerDepartment> {
  const payload = await apiRequest<{ data: ServerDepartment }>("/departments", {
    method: "POST",
    body: input,
    acceptLanguage: locale,
  });
  return payload.data;
}

export async function updateDepartment(
  id: number,
  patch: { name_ar?: string; name_en?: string; manager?: number | null; is_active?: boolean },
  locale: string,
): Promise<ServerDepartment> {
  const payload = await apiRequest<{ data: ServerDepartment }>(`/departments/${id}`, {
    method: "PATCH",
    body: patch,
    acceptLanguage: locale,
  });
  return payload.data;
}

export async function listGrants(locale: string): Promise<ServerGrant[]> {
  const payload = await apiRequest<{ data: ServerGrant[] }>("/manager-grants", { acceptLanguage: locale });
  return payload.data ?? [];
}

export async function createGrant(
  input: { manager: number; employee: number; scope: string },
  locale: string,
): Promise<ServerGrant> {
  const payload = await apiRequest<{ data: ServerGrant }>("/manager-grants", {
    method: "POST",
    body: input,
    acceptLanguage: locale,
  });
  return payload.data;
}

/** Revoking soft-deletes the grant; the backend keeps the row for the record. */
export async function revokeGrant(id: number, locale: string): Promise<ServerGrant> {
  const payload = await apiRequest<{ data: ServerGrant }>(`/manager-grants/${id}`, {
    method: "DELETE",
    acceptLanguage: locale,
  });
  return payload.data;
}
