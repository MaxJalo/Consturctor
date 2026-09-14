# Admin UI registry

Единый источник моков: [`../mocks/adminMocks.ts`](../mocks/adminMocks.ts)

## Вкладка «Обзор»

| Элемент | Файл | Props / данные |
|--------|------|----------------|
| Страница | [`pages/OverviewPage.tsx`](pages/OverviewPage.tsx) | Берёт `adminOverviewMock` |
| Хлебные крошки | [`components/AdminBreadcrumb.tsx`](components/AdminBreadcrumb.tsx) | `title: string` ← `adminOverviewMock.breadcrumb` |
| Toolbar | [`components/DashboardToolbar.tsx`](components/DashboardToolbar.tsx) | `title`, `subtitle`, `periodLabel`, `dateRange`, `refreshLabel`, `onRefresh?` ← поля `dashboard*` в моке |
| Сетка KPI | [`components/MetricGrid.tsx`](components/MetricGrid.tsx) | `metrics: AdminMetricMock[]` ← `adminOverviewMock.metrics` |
| KPI-карточка | [`components/MetricCard.tsx`](components/MetricCard.tsx) | `metric: AdminMetricMock` |
| Иконка KPI | [`components/MetricIcon.tsx`](components/MetricIcon.tsx) | `variant: MetricIconVariant` |
| Панель-обёртка | [`components/DashboardPanel.tsx`](components/DashboardPanel.tsx) | `title`, `children`, `className?` |
| График динамики | [`components/LineChartCard.tsx`](components/LineChartCard.tsx) | `data: AdminLaunchDynamicsMock` ← `adminOverviewMock.launchDynamics` |
| Donut статусов | [`components/DonutChartCard.tsx`](components/DonutChartCard.tsx) | `data: AdminAgentStatusesMock` ← `adminOverviewMock.agentStatuses` |
| Интеграции | [`components/IntegrationStatusCard.tsx`](components/IntegrationStatusCard.tsx) | `items: AdminIntegrationMock[]`, `title?` ← `adminOverviewMock.integrations` |
| Стили | [`admin-overview.css`](admin-overview.css) | Классы `admin-*` |

## Моки → UI

| Mock key | Значение | Где используется |
|----------|----------|------------------|
| `breadcrumb` | «Обзор — Сводная панель администратора» | `AdminBreadcrumb` |
| `dashboardTitle` | «Сводная панель» | `DashboardToolbar.title` |
| `dashboardSubtitle` | «Ключевые показатели системы ИИ-агентов» | `DashboardToolbar.subtitle` |
| `periodLabel` | «Период: Неделя» | pill-фильтр |
| `dateRange` | «08.09.2026 — 14.09.2026» | pill даты |
| `refreshLabel` | «Обновить» | синяя кнопка |
| `metrics[]` | 8 KPI-карточек | `MetricGrid` |
| `launchDynamics` | оси, серии, легенда | `LineChartCard` |
| `agentStatuses` | donut + легенда | `DonutChartCard` |
| `integrations[]` | список систем | `IntegrationStatusCard` |

## Общие компоненты (`components/shared/`)

| Компонент | Назначение |
|-----------|------------|
| `AdminPageShell` | breadcrumb + layout |
| `AdminPageHeader` | title, subtitle, actions, period controls |
| `AdminPeriodControls` | период + диапазон дат |
| `AdminSegmentTabs` | вкладки (Процессы, Общее и т.д.) |
| `AdminFilterBar` | фильтры, поиск, экспорт |
| `AdminDataTable` | таблица данных |
| `AdminPagination` | пагинация |
| `AdminStatusBadge` | статус-пill |
| `AdminSlaIndicator` | иконка SLA |
| `AdminPrimaryButton` / `AdminOutlineButton` | кнопки |

## Вкладки admin

| Вкладка | Страница | Mock |
|---------|----------|------|
| История | `pages/HistoryPage.tsx` | `adminHistoryMock` |
| Календарь запуска | `pages/LaunchCalendarPage.tsx` | `adminLaunchCalendarMock` |
| KPI | `pages/KpiAdminPage.tsx` | `adminKpiMock` |
| Пользователи | `pages/UsersPage.tsx` | `adminUsersMock` |
| ИИ-агенты | `pages/AiAgentsPage.tsx` | `adminAiAgentsMock` |
| База знаний | `pages/KnowledgeBasePage.tsx` | `adminKnowledgeBaseMock` |

## Подключение

- Роутинг: `App.tsx` → admin tabs → соответствующие `*Page`
- CSS: `main.tsx` → `./admin/admin-pages.css`, `./admin/admin-overview.css`
- UserMenu: `variant="admin"` для всех admin tabs
