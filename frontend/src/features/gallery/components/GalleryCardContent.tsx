import { useState, type SyntheticEvent } from "react";
import { Check } from "lucide-react";

import { isVideoFile } from "@/lib/media";
import { type GalleryItem } from "@/lib/api";
import { buildMediaUrl, buildThumbnailUrl } from "@/features/gallery/utils";
import { VideoThumbnail } from "@/features/gallery/components/VideoThumbnail";

interface GalleryCardContentProps {
  item: GalleryItem;
  isSelected: boolean;
  handleImageError: (e: SyntheticEvent<HTMLImageElement>) => void;
}

// Wrapper for gallery card content to track hover state for video playback
export function GalleryCardContent({ item, isSelected, handleImageError }: GalleryCardContentProps) {
  const [isHovering, setIsHovering] = useState(false);
  const isVideo = isVideoFile(item.image.path, item.image.filename);

  return (
    <div
      className="relative bg-slate-100 aspect-square overflow-hidden"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {isSelected && (
        <div className="absolute top-2 left-2 z-20 bg-blue-500 text-white rounded-full p-0.5 shadow-sm">
          <Check className="w-3 h-3" />
        </div>
      )}

      {isVideo ? (
        <VideoThumbnail
          src={buildMediaUrl(item.image.id)}
          className="w-full h-full object-contain transition-transform group-hover:scale-105"
          isHovering={isHovering}
        />
      ) : (
        <img
          src={buildThumbnailUrl(item.image.id)}
          alt={item.image.filename}
          className="w-full h-full object-contain transition-transform group-hover:scale-105"
          loading="lazy"
          decoding="async"
          onError={handleImageError}
        />
      )}
    </div>
  );
}
