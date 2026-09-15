import { SpecIconCalendar, SpecIconSearch } from '../../workplace/specV04Icons'
import { SpecFilters } from '../../workplace/specV04Components'

export function StandardGridFilters({ searchPlaceholder = 'Поиск…' }: { searchPlaceholder?: string }): React.JSX.Element {
  return (
    <SpecFilters layout="row">
      <select className="wp-select spec-filter-field" defaultValue="month">
        <option value="month">Период: текущий месяц</option>
        <option value="week">Неделя</option>
      </select>
      <select className="wp-select spec-filter-field" defaultValue="">
        <option value="">Источник: все</option>
      </select>
      <select className="wp-select spec-filter-field" defaultValue="">
        <option value="">Проект: все</option>
      </select>
      <select className="wp-select spec-filter-field" defaultValue="">
        <option value="">Статус: все</option>
      </select>
      <label className="spec-filter-input spec-filter-search">
        <SpecIconSearch />
        <input className="wp-search" type="search" placeholder={searchPlaceholder} />
      </label>
      <label className="spec-filter-input spec-filter-period">
        <SpecIconCalendar />
        <select className="wp-select" defaultValue="new">
          <option value="new">Сортировка: сначала новые</option>
        </select>
      </label>
      <button type="button" className="spec-filter-reset">
        Сбросить фильтры
      </button>
    </SpecFilters>
  )
}
