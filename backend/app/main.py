from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import food
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(title="Clean. API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(food.router, prefix="/api/food", tags=["food"])

# TODO(T1.x): include feature routers once they exist
# from app.api import profile, history
# app.include_router(profile.router, prefix="/api/profile", tags=["profile"])
# app.include_router(history.router, prefix="/api/history", tags=["history"])
