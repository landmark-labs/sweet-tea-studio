import { IMAGE_API_BASE } from "@/lib/api";

// Larger thumbnails for Gallery (512px) vs ProjectGallery sidebar (256px) due to bigger cards
const GALLERY_THUMBNAIL_PX = 512;

export const buildThumbnailUrl = (imageId: number, maxPx: number = GALLERY_THUMBNAIL_PX) =>
  `${IMAGE_API_BASE}/gallery/image/${imageId}/thumbnail?max_px=${maxPx}`;

export const buildMediaUrl = (imageId: number) =>
  `${IMAGE_API_BASE}/gallery/image/${imageId}`;
