from fastapi import FastAPI

app = FastAPI(title="Q Note", version="0.1.0")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "q-note"}
