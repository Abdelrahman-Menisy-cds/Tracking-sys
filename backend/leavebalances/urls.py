from django.urls import path

from leavebalances import views

app_name = "leavebalances"

urlpatterns = [
    path("leave-balances", views.LeaveBalanceListView.as_view(), name="leave-balance-list"),
    path("leave-balances/adjust", views.LeaveBalanceAdjustView.as_view(), name="leave-balance-adjust"),
]
