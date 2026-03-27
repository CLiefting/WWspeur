"""
Webwinkel Investigator - Main FastAPI Application
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Onderzoek malafide webwinkels door gegevens te verzamelen en analyseren.",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

app.include_router(auth_router, prefix="/api/v1/auth", tags=["Authenticatie"])
app.include_router(shops_router, prefix="/api/v1/shops", tags=["Webwinkels"])
app.include_router(scans_router, prefix="/api/v1/scans", tags=["Scans"])
