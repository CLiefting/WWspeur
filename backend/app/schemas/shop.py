"""
Pydantic schemas for shop management.
"""
from pydantic import BaseModel, Field, HttpUrl
from typing import Optional, List
from datetime import datetime
from app.models.shop import RiskLevel


class ShopCreate(BaseModel):
    """Schema for adding a new shop."""
    url: str = Field(..., max_length=2048)
    name: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None


class ShopCSVImport(BaseModel):
    """Schema for CSV import - list of URLs."""
    urls: List[str]


class ShopResponse(BaseModel):
    """Public shop information."""
    id: int
    url: str
    domain: str
    name: Optional[str]
    risk_score: Optional[float]
    risk_level: RiskLevel
    notes: Optional[str]
    added_by: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ShopListResponse(BaseModel):
    """Paginated list of shops."""
    shops: List[ShopResponse]
    total: int
    page: int
    page_size: int


class ShopUpdate(BaseModel):
    """Schema for updating shop details."""
    name: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
