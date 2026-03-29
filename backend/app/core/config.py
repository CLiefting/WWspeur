"""
Application configuration using pydantic-settings.
"""
import secrets
from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import Optional


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "Webwinkel Investigator"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # Database — must be set via environment variable
    DATABASE_URL: str

    # JWT Authentication — must be set via environment variable
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    # Rate limiting
    RATE_LIMIT_PER_MINUTE: int = 30

    # External APIs (to be configured)
    KVK_API_KEY: Optional[str] = None
    KVK_API_URL: str = "https://api.kvk.nl/api/v1"

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_must_be_strong(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("SECRET_KEY moet minimaal 32 tekens zijn")
        weak = {"CHANGE-ME", "secret", "changeme", "password", "dev-key"}
        if any(w in v.lower() for w in weak):
            raise ValueError(
                "SECRET_KEY bevat een onveilige waarde. "
                "Genereer een veilige key met: python3 -c \"import secrets; print(secrets.token_hex(32))\""
            )
        return v

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
