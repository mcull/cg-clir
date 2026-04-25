"use client";

import { trackEvent } from "@/lib/posthog";

interface DownloadButtonProps {
  artworkId: string;
  title: string;
}

export default function DownloadButton({ artworkId, title }: DownloadButtonProps) {
  const handleDownload = () => {
    trackEvent("artwork_download_requested", { artwork_id: artworkId, title });
    // Navigate to the streaming download endpoint. Server responds with
    // Content-Disposition: attachment so the browser saves the file
    // instead of navigating to it.
    window.location.href = `/api/download?id=${encodeURIComponent(artworkId)}`;
  };

  return (
    <button
      onClick={handleDownload}
      className="button-primary"
    >
      Download Image
    </button>
  );
}
