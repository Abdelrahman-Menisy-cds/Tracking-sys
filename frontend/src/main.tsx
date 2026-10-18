import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles/tokens.css";
import "./styles/global.css";
import { AppProvider, useApp } from "./app/AppContext";
import AppShell from "./app/AppShell";
import LoginPage from "./screens/LoginPage";
import SignupPage from "./screens/SignupPage";
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
import OnboardingCompanyPage from "./screens/OnboardingCompanyPage";
import TasksPage from "./screens/TasksPage";
import TaskDetailPage from "./screens/TaskDetailPage";
import ReportsPage from "./screens/ReportsPage";

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
  // role arrive - so a signed-in HR user could never open an admin page by URL.
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
          {/* H34b: the two-step signup wizard - company data + activation code
              first, then the founding HR account; one fused POST, straight to
              /. Lives OUTSIDE RequireSession exactly like /login. */}
          <Route path="/signup" element={<SignupPage />} />
          {/* H17: the onboarding step is a real route of its own. While the gate
              holds, AppShell renders it INSTEAD of the shell; with the flag false
              this element exists for direct visits without a session redirect. */}
          <Route path="/onboarding/company" element={<OnboardingCompanyPage />} />
          <Route element={<RequireSession />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/requests" element={<MyRequestsPage />} />
            <Route path="/requests/new" element={<NewRequestPage />} />
            {/* The correction of a RETURNED (or DRAFT) request edits THAT record
                through the server's own edit+submit path — never /requests/new. */}
            <Route path="/requests/:id/correct" element={<NewRequestPage />} />
            <Route path="/requests/:id" element={<RequestDetailPage />} />
            <Route path="/timesheets" element={<MyTimesheetsPage />} />
            <Route path="/timesheets/:id" element={<TimesheetDetailPage />} />
            <Route path="/reviews" element={<TeamReviewsPage />} />
            <Route path="/reviews/requests/:id" element={<ReviewRequestDetailPage />} />
            <Route path="/reviews/timesheets/:id" element={<ReviewTimesheetDetailPage />} />
            {/* H35: one reports route for manager AND HR - the server scopes
                the data per caller; an employee gets the honest denied state. */}
            <Route path="/reports" element={<ReportsPage />} />
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
