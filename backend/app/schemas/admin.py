from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class AdminModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class AdminMetricOut(AdminModel):
    id: str
    label: str
    value: str
    trend: str | None = None
    trend_tone: str | None = Field(default=None, serialization_alias="trendTone")
    icon: str


class AdminChartSeriesOut(AdminModel):
    id: str
    label: str
    color: str
    points: list[int]


class AdminLaunchDynamicsOut(AdminModel):
    title: str
    y_max: int = Field(serialization_alias="yMax")
    y_ticks: list[int] = Field(serialization_alias="yTicks")
    x_labels: list[str] = Field(serialization_alias="xLabels")
    series: list[AdminChartSeriesOut]
    legend: list[dict[str, str]]


class AdminAgentStatusSliceOut(AdminModel):
    id: str
    label: str
    value: int
    color: str


class AdminAgentStatusesOut(AdminModel):
    title: str
    total: int
    slices: list[AdminAgentStatusSliceOut]


class AdminIntegrationOut(AdminModel):
    id: str
    label: str
    online: bool


class AdminOverviewOut(AdminModel):
    breadcrumb: str
    dashboard_title: str = Field(serialization_alias="dashboardTitle")
    dashboard_subtitle: str = Field(serialization_alias="dashboardSubtitle")
    period_label: str = Field(serialization_alias="periodLabel")
    date_range: str = Field(serialization_alias="dateRange")
    refresh_label: str = Field(serialization_alias="refreshLabel")
    metrics: list[AdminMetricOut]
    launch_dynamics: AdminLaunchDynamicsOut = Field(serialization_alias="launchDynamics")
    agent_statuses: AdminAgentStatusesOut = Field(serialization_alias="agentStatuses")
    integrations: list[AdminIntegrationOut]


class AdminFilterOut(AdminModel):
    id: str
    options: list[str]
    default_value: str | None = Field(default=None, serialization_alias="defaultValue")


class AdminHistoryRowOut(AdminModel):
    id: str
    process: str
    agent: str
    user: str
    status: str
    status_tone: str = Field(serialization_alias="statusTone")
    launched_at: str = Field(serialization_alias="launchedAt")
    duration: str
    sla: str
    tab: str = "processes"


class AdminHistoryOut(AdminModel):
    source: str = "admin_api"
    breadcrumb: str
    title: str
    subtitle: str
    period_label: str = Field(serialization_alias="periodLabel")
    date_range: str = Field(serialization_alias="dateRange")
    tabs: list[dict[str, str]]
    active_tab: str = Field(serialization_alias="activeTab")
    filters: list[AdminFilterOut]
    rows: list[AdminHistoryRowOut]
    pagination: dict[str, int]


class AdminCalendarEventOut(AdminModel):
    id: str
    day_index: int = Field(serialization_alias="dayIndex")
    start_hour: int = Field(serialization_alias="startHour")
    end_hour: int = Field(serialization_alias="endHour")
    title: str
    tone: str
    agent_id: str = Field(serialization_alias="agentId")


class AdminLaunchCalendarOut(AdminModel):
    source: str = "admin_api"
    breadcrumb: str
    title: str
    subtitle: str
    period_label: str = Field(serialization_alias="periodLabel")
    date_range: str = Field(serialization_alias="dateRange")
    create_label: str = Field(serialization_alias="createLabel")
    view_modes: list[str] = Field(serialization_alias="viewModes")
    active_view: str = Field(serialization_alias="activeView")
    week_range: str = Field(serialization_alias="weekRange")
    days: list[str]
    hours: list[str]
    events: list[AdminCalendarEventOut]
    agent_filters: list[dict] = Field(serialization_alias="agentFilters")
    mini_month: str = Field(serialization_alias="miniMonth")
    mini_days: list[dict] = Field(serialization_alias="miniDays")
    unscheduled: list[dict]
    schedule_all_label: str = Field(serialization_alias="scheduleAllLabel")


class AdminKpiSummaryOut(AdminModel):
    id: str
    label: str
    value: str
    trend: str | None = None
    trend_tone: str | None = Field(default=None, serialization_alias="trendTone")
    tint: str | None = None
    icon: str | None = None


class AdminKpiAgentCardOut(AdminModel):
    id: str
    name: str
    process: str
    status: str
    status_tone: str = Field(serialization_alias="statusTone")
    efficiency: int
    summaries: list[AdminKpiSummaryOut]


class AdminKpiOut(AdminModel):
    source: str = "admin_api"
    breadcrumb: str
    title: str
    subtitle: str
    period_label: str = Field(serialization_alias="periodLabel")
    date_range: str = Field(serialization_alias="dateRange")
    tabs: list[dict[str, str]]
    active_tab: str = Field(serialization_alias="activeTab")
    summaries: list[AdminKpiSummaryOut]
    agent_cards: list[AdminKpiAgentCardOut] = Field(serialization_alias="agentCards")
    dynamics: AdminLaunchDynamicsOut
    top_agents: list[dict] = Field(serialization_alias="topAgents")
    gauges: list[dict]


class AdminUserRowOut(AdminModel):
    fio: str
    position: str
    department: str
    role: str
    status: str
    agents_access: int = Field(serialization_alias="agentsAccess")
    agents_used: int = Field(serialization_alias="agentsUsed")
    last_activity: str = Field(serialization_alias="lastActivity")


class AdminUsersOut(AdminModel):
    source: str = "admin_api"
    breadcrumb: str
    title: str
    subtitle: str
    add_label: str = Field(serialization_alias="addLabel")
    filters: list[AdminFilterOut]
    rows: list[AdminUserRowOut]
    pagination: dict[str, int]


class AdminAgentRowOut(AdminModel):
    name: str
    process: str
    owner: str
    version: str
    status: str
    status_tone: str = Field(serialization_alias="statusTone")
    runs: int
    success_rate: str = Field(serialization_alias="successRate")
    used: bool


class AdminAgentDetailOut(AdminModel):
    name: str
    status: str
    status_tone: str = Field(serialization_alias="statusTone")
    description: str
    tabs: list[str]
    active_tab: str = Field(serialization_alias="activeTab")
    info: list[dict[str, str]]
    metrics: list[dict[str, str]]
    processes: list[dict]


class AdminAiAgentsOut(AdminModel):
    source: str = "admin_api"
    breadcrumb: str
    title: str
    subtitle: str
    create_label: str = Field(serialization_alias="createLabel")
    import_label: str = Field(serialization_alias="importLabel")
    filters: list[AdminFilterOut]
    rows: list[AdminAgentRowOut]
    pagination: dict[str, int]
    detail: AdminAgentDetailOut


class AdminKnowledgeRowOut(AdminModel):
    name: str
    type: str
    agents: str
    version: str
    status: str
    status_tone: str = Field(serialization_alias="statusTone")
    updated_at: str = Field(serialization_alias="updatedAt")


class AdminKnowledgeBaseOut(AdminModel):
    source: str = "admin_api"
    breadcrumb: str
    title: str
    subtitle: str
    add_label: str = Field(serialization_alias="addLabel")
    filters: list[AdminFilterOut]
    rows: list[AdminKnowledgeRowOut]
    pagination: dict[str, int]
    document: dict


class AdminSettingsOut(AdminModel):
    source: str = "admin_api"
    breadcrumb: str
    title: str
    subtitle: str
