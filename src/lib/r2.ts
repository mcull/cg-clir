import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2 credentials in environment variables");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

const BUCKET = process.env.R2_BUCKET_NAME || "cg-clir";

/**
 * Upload a file to R2.
 */
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  const client = getR2Client();

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  const publicUrl = process.env.R2_PUBLIC_URL;
  if (publicUrl) {
    return `${publicUrl}/${key}`;
  }

  // Fallback: return the key and let the caller construct the URL
  return key;
}

/**
 * Generate a short-lived signed URL for downloading an image from R2.
 * Used by the download tracking endpoint.
 */
export async function getSignedDownloadUrl(
  key: string,
  expiresIn: number = 300
): Promise<string> {
  const client = getR2Client();

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
    { expiresIn }
  );
}

/**
 * Generate a presigned URL for uploading directly from the browser.
 * Used by the admin console for image uploads.
 */
export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 600
): Promise<string> {
  const client = getR2Client();

  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn }
  );
}

/**
 * Construct the public URL for an artwork image.
 */
export function artworkImageUrl(
  inventoryNumber: string,
  variant: "original" | "thumb_400" | "medium_800" | "large_1600" = "large_1600"
): string {
  const base = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "";
  return `${base}/artworks/${encodeURIComponent(inventoryNumber)}/${variant}.jpg`;
}
