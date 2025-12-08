import logging
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

GALLERY_PATH_PREFIX = "/api/v1/gallery"
logger = logging.getLogger("gallery.middleware")


def _is_gallery_request(request: Request) -> bool:
    return request.url.path.startswith(GALLERY_PATH_PREFIX)


class GalleryRequestMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = None
        try:
            response = await call_next(request)
        except HTTPException as exc:
            if _is_gallery_request(request):
                logger.exception(
                    "Gallery request failed with HTTPException",
                    extra={"path": request.url.path, "method": request.method, "status_code": exc.status_code},
                )
                response = JSONResponse(
                    status_code=exc.status_code,
                    content={
                        "error": "gallery_error",
                        "detail": exc.detail,
                        "path": request.url.path,
                    },
                )
            else:
                raise
        except Exception:
            if _is_gallery_request(request):
                logger.exception(
                    "Unhandled gallery exception",
                    extra={"path": request.url.path, "method": request.method},
                )
                response = JSONResponse(
                    status_code=500,
                    content={
                        "error": "gallery_error",
                        "detail": "Internal server error",
                        "path": request.url.path,
                    },
                )
            else:
                raise

        duration_ms = (time.perf_counter() - start) * 1000
        if _is_gallery_request(request) and response is not None:
            response.headers["X-Gallery-Request-Duration-ms"] = f"{duration_ms:.2f}"
            logger.info(
                "Gallery request completed",
                extra={
                    "path": request.url.path,
                    "method": request.method,
                    "duration_ms": duration_ms,
                    "status_code": response.status_code if response else None,
                },
            )

        return response


def register_gallery_error_handlers(app: FastAPI) -> None:
    app.add_middleware(GalleryRequestMiddleware)

    @app.exception_handler(RequestValidationError)
    async def gallery_validation_handler(request: Request, exc: RequestValidationError):
        if not _is_gallery_request(request):
            return await request_validation_exception_handler(request, exc)

        logger.exception(
            "Gallery validation error",
            extra={"path": request.url.path, "method": request.method, "errors": exc.errors()},
        )
        return JSONResponse(
            status_code=422,
            content={
                "error": "gallery_validation_error",
                "detail": exc.errors(),
                "path": request.url.path,
            },
        )

    @app.exception_handler(HTTPException)
    async def gallery_http_exception_handler(request: Request, exc: HTTPException):
        if not _is_gallery_request(request):
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

        logger.exception(
            "Gallery HTTP exception",
            extra={"path": request.url.path, "method": request.method, "status_code": exc.status_code},
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": "gallery_error", "detail": exc.detail, "path": request.url.path},
        )
