import { useEffect, useRef } from "react";

interface VideoThumbnailProps {
  src: string;
  className?: string;
  isHovering?: boolean;
}

// Hover-to-play video thumbnail component
// Uses isHovering prop from parent to control playback (overlay blocks direct mouse events)
export function VideoThumbnail({ src, className, isHovering }: VideoThumbnailProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    if (isHovering) {
      videoRef.current.play().catch(() => { });
    } else {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [isHovering]);

  return (
    <video
      ref={videoRef}
      src={src}
      className={className}
      preload="metadata"
      muted
      playsInline
      loop
    />
  );
}
