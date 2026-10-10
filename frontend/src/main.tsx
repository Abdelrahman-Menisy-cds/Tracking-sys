import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles/tokens.css";
import "./styles/global.css";
import { AppProvider, useApp } from "./app/AppContext";
import AppShell from "./app/AppShell";
import LoginPage from "./screens/LoginPage";
import HomePage from "./screens/HomePage";
import MyRequestsPage, { NewRequestPage } from "./screens/MyRequestsPage";
import RequestDetailPage from "./screens/RequestDetailPage";
import { MyTimesheetsPage, TimesheetDetailPage } from "./screens/MyTimesheetsPage";
import TeamReviewsPage, { ReviewRequestDetailPage, ReviewTimesheetDetailPage } from "./screens/TeamReviewsPage";
import NotificationsPage from "./screens/NotificationsPage";
import ProfilePage from "./screens/ProfilePage";
import AttendancePage, { AttendanceCorrectionsPage, AttendanceHistoryPage } from "./screens/AttendancePage";
import AdminOverviewPage from "./screens/admin/AdminOverviewPage";
import AdminSettingsPage from "./screens/admin/AdminSettingsPage";
import AdminPeoplePage, { AdminPeopleDetailPage } from "./screens/admin/AdminPeoplePage";
import AdminAnnouncementsPage from "./screens/admin/AdminAnnouncementsPage";
import TasksPage from "./screens/TasksPage";
import TaskDetailPage from "./screens/TaskDetailPage";

/**
 * The app screens need a session.
 *
 * In the demo build the role picker is the session, so nothing is gated. Otherwise
 * we wait for the boot-time probe to answer before deciding, so a reload with a
 * live cookie does not flash the login screen, and a stale one does not flash the
 * app with an empty role.
 */
function RequireSession() {
  const { isDemoMode, sessionChecked, serverAccount } = useApp();
  // Wait for the boot probe in BOTH modes. Rendering the demo immediately looked
  // harmless, but it raced the probe: the admin route evaluated its permission
  // against the "employee" default, redirected to /, and only then did the real
  // role arrive — so a signed-in HR user could never open an admin page by URL.
  if (!sessionChecked) return null;
  if (isDemoMode) return <AppShell />;
  if (!serverAccount) return <Navigate to="/login" replace />;
  return <AppShell />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireSession />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/requests" element={<MyRequestsPage />} />
            <Route path="/requests/new" element={<NewRequestPage />} />
            <Route path="/requests/:id" element={<RequestDetailPage />} />
            <Route path="/timesheets" element={<MyTimesheetsPage />} />
            <Route path="/timesheets/:id" element={<TimesheetDetailPage />} />
            <Route path="/reviews" element={<TeamReviewsPage />} />
            <Route path="/reviews/requests/:id" element={<ReviewRequestDetailPage />} />
            <Route path="/reviews/timesheets/:id" element={<ReviewTimesheetDetailPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/attendance/history" element={<AttendanceHistoryPage />} />
            <Route path="/attendance/corrections" element={<AttendanceCorrectionsPage />} />
            <Route path="/admin" element={<AdminOverviewPage />} />
            <Route path="/admin/settings" element={<AdminSettingsPage />} />
            <Route path="/admin/people" element={<AdminPeoplePage />} />
            <Route path="/admin/people/:employeeId" element={<AdminPeopleDetailPage />} />
            <Route path="/admin/announcements" element={<AdminAnnouncementsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  </StrictMode>,
);
