from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.db.engine import engine as db_engine
from app.models.image import Image
from app.models.prompt import Prompt
from app.services.captioning import apply_caption_update, normalize_caption, persist_caption_to_media
from app.services.vlm import vlm_service
from app.services.gallery.search import build_search_text_from_image, update_gallery_fts

router = APIRouter()

# Helper to get session since we don't have global get_session dependency in all files yet
def get_session():
    with Session(db_engine) as session:
        yield session

class CaptionResponse(BaseModel):
    caption: str
    ranked_tags: List[str] = []
    model: str
    backend: str
    image_id: Optional[int] = None


class TagPromptRequest(BaseModel):
    tags: List[str] = Field(default_factory=list)
    prompt_id: Optional[int] = Field(
        default=None,
        description="Persist the expanded prompt to an existing prompt row",
    )


class TagPromptResponse(BaseModel):
    prompt: str
    ordered_tags: List[str]
    prompt_id: Optional[int] = None


@router.post("/caption", response_model=CaptionResponse)
async def caption_image(
    image: Optional[UploadFile] = File(default=None),
    file: Optional[UploadFile] = File(default=None),
    image_id: Optional[int] = Form(default=None),
    save: bool = Form(default=True),
    session: Session = Depends(get_session),
):
    upload = image or file
    if upload is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    contents = await upload.read()
    result = vlm_service.generate_caption(contents)

    if image_id and save:
        db_image = session.get(Image, image_id)
        if not db_image:
            raise HTTPException(status_code=404, detail="Image not found")
        caption_text = normalize_caption(result.get("caption") if isinstance(result, dict) else None)
        persist_caption_to_media(db_image.path, caption_text)
        apply_caption_update(
            session,
            media_path=db_image.path,
            caption=caption_text,
            image=db_image,
            source="vlm",
            meta={"backend": result.get("backend"), "model": result.get("model")},
        )
        if db_image.id is not None:
            search_text = build_search_text_from_image(db_image)
            if update_gallery_fts(session, db_image.id, search_text):
                pass
        session.commit()
        session.refresh(db_image)

    return {**result, "image_id": image_id}


@router.post("/caption/{image_id}", response_model=CaptionResponse)
def caption_stored_image(
    image_id: int,
    save: bool = True,
    session: Session = Depends(get_session),
):
    db_image = session.get(Image, image_id)
    if not db_image:
        raise HTTPException(status_code=404, detail="Image not found")
    if not db_image.path:
        raise HTTPException(status_code=400, detail="Image has no path")
    try:
        with open(db_image.path, "rb") as f:
            contents = f.read()
    except OSError:
        raise HTTPException(status_code=404, detail="Image file not found")

    result = vlm_service.generate_caption(contents)
    if save:
        caption_text = normalize_caption(result.get("caption") if isinstance(result, dict) else None)
        persist_caption_to_media(db_image.path, caption_text)
        apply_caption_update(
            session,
            media_path=db_image.path,
            caption=caption_text,
            image=db_image,
            source="vlm",
            meta={"backend": result.get("backend"), "model": result.get("model")},
        )
        if db_image.id is not None:
            search_text = build_search_text_from_image(db_image)
            update_gallery_fts(session, db_image.id, search_text)
        session.commit()

    return {**result, "image_id": image_id}


@router.post("/tags", response_model=TagPromptResponse)
async def tags_to_prompt(
    request: TagPromptRequest,
    session: Session = Depends(get_session),
):
    prompt_text = vlm_service.tags_to_prompt(request.tags)
    prompt_id = request.prompt_id

    if prompt_id:
        prompt_row = session.get(Prompt, prompt_id)
        if not prompt_row:
            raise HTTPException(status_code=404, detail="Prompt not found")
        prompt_row.tag_prompt = prompt_text
        prompt_row.tags = request.tags
        session.add(prompt_row)
        session.commit()
        session.refresh(prompt_row)

    return TagPromptResponse(prompt=prompt_text, ordered_tags=request.tags, prompt_id=prompt_id)


@router.get("/health")
def health():
    return vlm_service.status()
