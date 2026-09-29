from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Настройки приложения. Все значения переопределяются переменными окружения."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Robo-Factory"
    app_version: str = "0.1.0"
    environment: str = "development"

    postgres_user: str = "robo"
    postgres_password: str = "robo"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "robofactory"
    # Полный DSN (DATABASE_URL) имеет приоритет над отдельными POSTGRES_* переменными.
    database_url_override: str | None = Field(default=None, validation_alias="DATABASE_URL")
    db_echo: bool = False

    secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 12 * 60

    cors_origins: str = "http://localhost:5173,http://localhost:8080"

    upload_dir: Path = Path("/data/uploads")
    max_upload_mb: int = 20
    # Фотографии товаров: предел размера файла и стороны сохранённого изображения.
    max_image_mb: int = 10
    image_max_side: int = 1600
    image_thumb_side: int = 560

    demo_admin_email: str = "admin@example.com"
    demo_admin_password: str = "admin12345"
    demo_user_email: str = "user@example.com"
    demo_user_password: str = "user12345"
    demo_vendor_email: str = "vendor@example.com"
    demo_vendor_password: str = "vendor12345"

    # Версия расчётной модели фиксируется в каждом запуске расчёта (п. 3.1.5 ТЗ).
    calc_model_version: str = "0.1.0"
    openai_api_key: SecretStr = SecretStr("")
    openai_proxy_url: SecretStr = SecretStr("")
    openai_model: str = "gpt-4.1-mini"
    openai_base_url: str = "https://api.openai.com/v1"

    @property
    def database_url(self) -> str:
        if self.database_url_override:
            return self.database_url_override
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
