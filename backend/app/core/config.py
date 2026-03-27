"""
Application configuration using pydantic-settings.
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "Webwinkel Investigator"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True
    
    # Database
    DATABASE_URL: str = "postgresql://webwinkel:webwinkel@localhost:5432/webwinkel_investigator"
    
    # JWT Authentication
    SECRET_KEY: str = "CHANGE-ME-IN-PRODUCTION-use-a-random-256-bit-key"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    
    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    
    # Rate limiting
    RATE_LIMIT_PER_MINUTE: int = 30
    
    # External APIs (to be configured)
    KVK_API_KEY: Optional[str] = None
    KVK_API_URL: str = "https://api.kvk.nl/api/v1"
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
