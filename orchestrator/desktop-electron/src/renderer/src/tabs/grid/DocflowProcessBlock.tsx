import { GitBranch } from 'lucide-react'

/** «Новые» из окна «Выберите вариант для отправки». Одинаковый набор у каждого документа. */
const NEW_PROCESSES =
  'согласование, регистрация, рассмотрение, приглашение, ознакомление, утверждение / подписание, комплексный процесс, обработка внутреннего документа, исполнение'

const ADVANCE_OPERATION = 'ВыдачаДенежныхСредствПодотчетнику'

const PAYMENT_TEMPLATES = [
  {
    id: 'advance',
    title: 'ПОДОТЧЕТ (НЕ ком.расходы) Согласование Заявка на ДС (комплексный процесс) по ЦФО'
  },
  {
    id: 'commercial',
    title: 'КОМ.РАСХОДЫ Согласование Заявка на ДС (комплексный процесс) по ЦФО'
  },
  {
    id: 'tickets',
    title: 'ВОЗВРАТ БИЛЕТОВ'
  }
] as const

const ADVANCE_STEPS = [
  {
    kind: 'Согласование',
    action: 'Согласовать',
    executor: 'Непосредственный руководитель',
    due: '1 день 5 часов'
  },
  {
    kind: 'Ознакомление',
    action: 'Ознакомиться',
    executor: 'Главный бухгалтер организации',
    due: '1 час'
  }
] as const

function paymentTemplateId(operationCode: string, operation: string): (typeof PAYMENT_TEMPLATES)[number]['id'] {
  const text = `${operationCode} ${operation}`.toLowerCase()
  if (text.includes('билет')) return 'tickets'
  if (operationCode === ADVANCE_OPERATION || text.includes('подотч')) return 'advance'
  return 'commercial'
}

/** Процесс отправки, который в 1С есть у каждого документа. Для заявки на ДС показывает рекомендованный шаблон. */
export function DocflowProcessBlock({
  operationCode = '',
  operation = ''
}: {
  operationCode?: string
  operation?: string
}): React.JSX.Element {
  const payment = Boolean(operationCode || operation)
  const activeId = payment ? paymentTemplateId(operationCode, operation) : null
  const active = PAYMENT_TEMPLATES.find((item) => item.id === activeId)
  const steps = activeId === 'advance' ? ADVANCE_STEPS : null
  return (
    <section className="docflow-card-block">
      <h4>
        <GitBranch size={14} aria-hidden /> Процесс
      </h4>
      {active ? (
        <>
          <p className="docflow-muted">Вид документа: Заявки на расходование ДС</p>
          <p>
            <strong>{active.title}</strong>
          </p>
          {steps ? (
            <ul className="docflow-route">
              {steps.map((step, index) => (
                <li key={step.kind}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>
                      {step.kind}: {step.action}
                    </strong>
                    <span>
                      {step.executor} · {step.due}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="docflow-muted">
              Состав этого шаблона 1С открывает на форме «Комплексный процесс». У выдачи подотчётнику (не
              коммерческие расходы) шаги другие: согласование непосредственным руководителем, затем ознакомление
              главного бухгалтера.
            </p>
          )}
          <p className="docflow-muted">
            Рекомендованные: {PAYMENT_TEMPLATES.map((item) => item.title).join('; ')}.
          </p>
          <p className="docflow-muted">
            Запуск по очереди: «Отправить» → этот шаблон → «Перейти к отправке» → «Стартовать и закрыть». Роли
            подставляет 1С, в шаблоне нет конкретных людей.
          </p>
        </>
      ) : (
        <p className="docflow-muted">
          Отправка есть у каждого документа: «Отправить» → «Выберите вариант для отправки». Новые: {NEW_PROCESSES}.
          Дальше «Перейти к отправке» и «Стартовать и закрыть». Рекомендованный шаблон зависит от вида документа.
        </p>
      )}
    </section>
  )
}
