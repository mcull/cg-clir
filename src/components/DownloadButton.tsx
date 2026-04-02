"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/posthog";

interface DownloadButtonProps {
  artworkId: string;
  title: string;
}

export default function DownloadButton({
  artworkId,
  title,
}: DownloadButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    try {
      setIsLoading(true);
      setError(null);

      trackEvent("artwork_download_requested", {
        artwork_id: artworkId,
        title,
      });

      const response = await fetch("/api/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ artwork_id: artworkId }),
      });

      if (!response.ok) {
        throw new Error("Failed to download image");
      }

      const { url } = await response.json();

      // Trigger download
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      trackEvent("artwork_downloaded", {
        artwork_id: artworkId,
        title,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An error occurred while downloading"
      );
      console.error("Download error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleDownload}
        disabled={isLoading}
        className="button-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? "Downloading..." : "Download Image"}
      </button>
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </div>
  );
}
