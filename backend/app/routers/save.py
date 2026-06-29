from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.db_models import DocumentState

router = APIRouter()

class SaveRequest(BaseModel):
    latex_code: str
    cursor_line: int = 1
    cursor_col: int = 1
    scroll_position: int = 0

@router.post("/save/{job_id}")
async def save_document(job_id: str, request: SaveRequest, db: Session = Depends(get_db)):
    state = db.query(DocumentState).filter(DocumentState.job_id == job_id).first()
    if not state:
        state = DocumentState(
            job_id=job_id,
            latex_code=request.latex_code,
            cursor_line=request.cursor_line,
            cursor_col=request.cursor_col,
            scroll_position=request.scroll_position
        )
        db.add(state)
    else:
        state.latex_code = request.latex_code
        state.cursor_line = request.cursor_line
        state.cursor_col = request.cursor_col
        state.scroll_position = request.scroll_position
    
    db.commit()
    return {"status": "success"}

@router.get("/save/{job_id}")
async def load_document(job_id: str, db: Session = Depends(get_db)):
    state = db.query(DocumentState).filter(DocumentState.job_id == job_id).first()
    if not state:
        raise HTTPException(status_code=404, detail="Document state not found")
    
    return {
        "latex_code": state.latex_code,
        "cursor_line": state.cursor_line,
        "cursor_col": state.cursor_col,
        "scroll_position": state.scroll_position
    }
