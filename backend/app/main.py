"""
Webwinkel Investigator - Main FastAPI Application
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from app.core.config import settings

limiter = Limiter(key_func=get_remote_address, default_limits=[f"{settings.RATE_LIMIT_PER_MINUTE}/minute"])

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Onderzoek malafide webwinkels door gegevens te verzamelen en analyseren.",
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/")
def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}


# API routes
from app.api.auth import router as auth_router
from app.api.shops import router as shops_router
from app.api.scans import router as scans_router
from app.api.settings import router as settings_router

app.include_router(auth_router, prefix="/api/v1/auth", tags=["Authenticatie"])
app.include_router(shops_router, prefix="/api/v1/shops", tags=["Webwinkels"])
app.include_router(scans_router, prefix="/api/v1/scans", tags=["Scans"])
app.include_router(settings_router, prefix="/api/v1/settings", tags=["Instellingen"])
