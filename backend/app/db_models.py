from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from app.database import Base

class DocumentState(Base):
    __tablename__ = "document_states"

    job_id = Column(String, primary_key=True, index=True)
    latex_code = Column(Text, nullable=False)
    cursor_line = Column(Integer, default=1)
    cursor_col = Column(Integer, default=1)
    scroll_position = Column(Integer, default=0)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), default=func.now())
