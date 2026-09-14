import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./styles/tokens.css";
import "./styles/global.css";
import { AppProvider } from "./app/AppContext";
import AppShell from "./app/AppShell";
import LoginPage from "./screens/LoginPage";
import HomePage from "./screens/HomePage";
import MyRequestsPage, { NewRequestPage } from "./screens/MyRequestsPage";
import RequestDetailPage from "./screens/RequestDetailPage";
import { MyTimesheetsPage, TimesheetDetailPage } from "./screens/MyTimesheetsPage";
import TeamReviewsPage, { ReviewRequestDetailPage } from "./screens/TeamReviewsPage";
import NotificationsPage from "./screens/NotificationsPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/requests" element={<MyRequestsPage />} />
            <Route path="/requests/new" element={<NewRequestPage />} />
            <Route path="/requests/:id" element={<RequestDetailPage />} />
            <Route path="/timesheets" element={<MyTimesheetsPage />} />
            <Route path="/timesheets/:id" element={<TimesheetDetailPage />} />
            <Route path="/reviews" element={<TeamReviewsPage />} />
            <Route path="/reviews/requests/:id" element={<ReviewRequestDetailPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  </StrictMode>,
);
