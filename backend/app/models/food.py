from pydantic import BaseModel, Field


class Nutrient(BaseModel):
    energy_kcal: float = Field(..., description="kcal per 100g")
    fat: float
    saturated_fat: float
    carbohydrates: float
    sugars: float
    fiber: float
    proteins: float
    sodium: float


class ProductSummary(BaseModel):
    barcode: str
    name: str
    brand: str | None = None
    image_url: str | None = None
    nutri_score: str | None = None
    nova_group: int | None = None
    score: int


class ScoreFactor(BaseModel):
    factor: str
    impact: int
    reason: str


class Alternative(BaseModel):
    barcode: str
    name: str
    brand: str | None = None
    score: int
    image_url: str | None = None
    amazon_url: str | None = None


class FoodResult(BaseModel):
    barcode: str
    name: str
    brand: str | None = None
    image_url: str | None = None
    nutri_score: str | None = None
    nova_group: int | None = None
    nutrients: Nutrient
    score: int
    score_label: str
    score_breakdown: list[ScoreFactor]
    alternatives: list[Alternative]
    body_impact: str | None = None
    personalized: bool


class SearchResponse(BaseModel):
    products: list[ProductSummary]
    total: int
    page: int


class Category(BaseModel):
    slug: str
    label: str
    icon: str
