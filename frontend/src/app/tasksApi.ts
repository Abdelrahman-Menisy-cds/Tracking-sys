/**
 * The tasks API. «مهامي» and «مهام أنشأتها» are two views of the same rows, so one
 * call returns both and the page never merges client-side lists.
 */
import { apiRequest } from "./api";

export type TaskStatus = "OPEN" | "IN_PROGRESS" | "DONE";

export interface Task {
  id: number;
  title: string;
  details: string;
  status: TaskStatus;
  due_date: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  owner_id: number;
  created_at: string;
}

export interface TaskLists {
  mine: Task[];
  created: Task[];
}

/** GET /tasks - the caller's own work, both sides. */
export async function fetchTasks(locale: "ar" | "en"): Promise<TaskLists> {
  const payload = await apiRequest<{ data: TaskLists }>("/tasks", { acceptLanguage: locale });
  return payload.data;
}

/** POST /tasks - create one, optionally assigned to a colleague. */
export async function createTask(
  input: { title: string; details?: string; assignee_id?: number | null; due_date?: string | null },
  locale: "ar" | "en",
): Promise<Task> {
  const payload = await apiRequest<{ data: Task }>("/tasks", {
    acceptLanguage: locale,
    method: "POST",
    body: input,
  });
  return payload.data;
}

/** PATCH /tasks/<id> - move the status. */
export async function updateTaskStatus(
  id: number,
  status: TaskStatus,
  locale: "ar" | "en",
): Promise<Task> {
  const payload = await apiRequest<{ data: Task }>(`/tasks/${id}`, {
    acceptLanguage: locale,
    method: "PATCH",
    body: { status },
  });
  return payload.data;
}
