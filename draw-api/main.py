from fastapi import FastAPI

from app.api.routes.auth import router as auth_router


app = FastAPI(
    title="Draw API",
    version="1.0.0",
)


app.include_router(auth_router)


@app.get("/")
def root():
    return {
        "message": "API is running",
    }