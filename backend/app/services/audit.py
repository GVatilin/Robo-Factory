from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User


def record(
    session: AsyncSession,
    user: User | None,
    entity_type: str,
    entity_id: object,
    action: str,
    changes: dict[str, Any] | None = None,
) -> None:
    """Запись в журнал изменений каталога и учётных записей. Коммит — на стороне вызывающего кода."""
    session.add(
        AuditLog(
            entity_type=entity_type,
            entity_id=str(entity_id),
            action=action,
            changes=changes or {},
            user_id=user.id if user else None,
        )
    )
