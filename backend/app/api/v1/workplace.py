from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.jwt import AuthContext
from app.db.session import get_db
from app.schemas.workplace_kpi import WorkplaceKpiDashboardOut
from app.services.workplace.kpi_dashboard import build_workplace_kpi_dashboard

router = APIRouter(prefix="/workplace", tags=["workplace"])


@router.get("/kpi", response_model=WorkplaceKpiDashboardOut)
def read_workplace_kpi(
    auth: AuthContext = Depends(get_current_user),
    db: Session = Depends(get_db),
    period_from: str | None = Query(default=None, alias="from"),
    period_to: str | None = Query(default=None, alias="to"),
) -> WorkplaceKpiDashboardOut:
    return build_workplace_kpi_dashboard(
        db,
        user_id=auth.user_id,
        period_from=period_from,
        period_to=period_to,
    )
