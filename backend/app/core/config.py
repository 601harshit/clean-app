from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_JWT_SECRET: str | None = None

    ANTHROPIC_API_KEY: str

    AMAZON_ACCESS_KEY: str | None = None
    AMAZON_SECRET_KEY: str | None = None
    AMAZON_PARTNER_TAG: str | None = None
    AMAZON_REGION: str | None = None

    CORS_ORIGINS: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
