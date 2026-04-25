from datetime import datetime

from pydantic import BaseModel


class ProfileResponse(BaseModel):
    health_conditions: list[str]


class HistoryItem(BaseModel):
    id: str
    barcode: str | None = None
    product_name: str
    brand: str | None = None
    image_url: str | None = None
    score: int
    scanned_at: datetime
