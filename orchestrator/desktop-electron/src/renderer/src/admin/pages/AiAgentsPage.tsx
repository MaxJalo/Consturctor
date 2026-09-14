import { adminAiAgentsMock } from '../../mocks/adminMocks'
import { AdminDataTable } from '../components/shared/AdminDataTable'
import { AdminFilterBar } from '../components/shared/AdminFilterBar'
import { AdminOutlineButton } from '../components/shared/AdminOutlineButton'
import { AdminPageHeader } from '../components/shared/AdminPageHeader'
import { AdminPageShell } from '../components/shared/AdminPageShell'
import { AdminPagination } from '../components/shared/AdminPagination'
import { AdminPrimaryButton } from '../components/shared/AdminPrimaryButton'
import { AdminSegmentTabs } from '../components/shared/AdminSegmentTabs'
import { AdminStatusBadge } from '../components/shared/AdminStatusBadge'

export function AiAgentsPage(): React.JSX.Element {
  const mock = adminAiAgentsMock
  const detail = mock.detail

  return (
    <AdminPageShell breadcrumb={mock.breadcrumb}>
      <AdminPageHeader
        title={mock.title}
        subtitle={mock.subtitle}
        actions={
          <>
            <AdminPrimaryButton label={mock.createLabel} icon="plus" />
            <AdminOutlineButton label={mock.importLabel} icon="import" />
          </>
        }
      />
      <div className="admin-panel">
        <AdminFilterBar filters={mock.filters} />
        <AdminDataTable
          columns={[
            { id: 'name', label: 'Название' },
            { id: 'process', label: 'Процесс' },
            { id: 'owner', label: 'Владелец' },
            { id: 'version', label: 'Версия', width: '90px' },
            { id: 'status', label: 'Статус', width: '130px' },
            { id: 'runs', label: 'Запусков', align: 'center', width: '90px' },
            { id: 'success', label: 'Успешность', align: 'center', width: '110px' },
            { id: 'used', label: 'Используется', align: 'center', width: '120px' }
          ]}
          rows={mock.rows.map((row) => [
            <span className="admin-link">{row.name}</span>,
            row.process,
            row.owner,
            row.version,
            <AdminStatusBadge label={row.status} tone={row.statusTone} />,
            row.runs,
            row.successRate,
            <span className={row.used ? 'admin-lock admin-lock--yes' : 'admin-lock admin-lock--no'}>{row.used ? 'Да' : 'Нет'}</span>
          ])}
        />
        <AdminPagination from={mock.pagination.from} to={mock.pagination.to} total={mock.pagination.total} pages={[1, 2, 3, 'ellipsis', 8]} />
      </div>
      <section className="admin-panel admin-agent-detail">
        <div className="admin-agent-detail__head">
          <div className="admin-agent-detail__icon" />
          <div>
            <div className="admin-agent-detail__title-row">
              <h3>{detail.name}</h3>
              <AdminStatusBadge label={detail.status} tone={detail.statusTone} />
            </div>
            <p>{detail.description}</p>
          </div>
          <AdminOutlineButton label="Действия" icon="chevron" />
        </div>
        <AdminSegmentTabs tabs={detail.tabs.map((label, index) => ({ id: String(index), label }))} activeId="0" />
        <div className="admin-agent-detail__grid">
          <div>
            <h4>Общая информация</h4>
            <dl className="admin-kv-list">
              {detail.info.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.label === 'Статус' ? <AdminStatusBadge label={detail.status} tone={detail.statusTone} /> : item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h4>Показатели</h4>
            <dl className="admin-kv-list">
              {detail.metrics.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <div className="admin-agent-detail__process-head">
              <h4>Текущие процессы <span>3</span></h4>
              <button type="button" className="admin-link-btn">Смотреть все</button>
            </div>
            <ul className="admin-process-list">
              {detail.processes.map((item) => (
                <li key={item.title}>
                  <span className={`admin-process-list__icon admin-process-list__icon--${item.tone}`} />
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.time}</p>
                  </div>
                  <AdminStatusBadge label={item.status} tone={item.statusTone} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </AdminPageShell>
  )
}
