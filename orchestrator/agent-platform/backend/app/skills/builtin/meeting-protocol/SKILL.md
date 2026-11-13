---
name: meeting-protocol
title: Протоколы и совещания
description: Подготовка повестки, проверка занятости в Exchange и черновики протоколов совещаний в 1С
keywords: совещание, протокол, повестка, календарь, Exchange, ПСД, РК
---

# Протоколы и совещания

1. Для списка служебных записок на совещания используй `meetings.memo_requests` или `onec.meeting_service_notes`.
2. Для проверки занятости руководителя, места и участников в Exchange вызывай `outlook.ews_availability`.
3. Для чтения и сверки прошлых протоколов 1С используй `onec.meeting_protocols` (`pair=true` для сверки текущего и прошлого СД/ПСД).
4. Создание и обновление черновика протокола в 1С (`onec.meeting_protocol_write`) и рассылка приглашений (`outlook.ews_create_meeting`, `outlook.create_event`) требуют явного подтверждения человека через хук разрешений.
5. Сводку или повестку для печати сохраняй через `report.export_document`.
