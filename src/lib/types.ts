/**
 * Core data types for the Creative Growth CLIR gallery.
 */

export interface Artist {
  id: string;
  first_name: string;
  last_name: string;
  slug: string;
  bio: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  ai_suggested: boolean;
  created_at: string;
}

export interface Artwork {
  id: string;
  artist_id: string | null;
  title: string;
  date_created: string | null;
  medium: string | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  inventory_number: string | null;
  sku: string | null;
  image_url: string | null;
  image_original: string | null;
  alt_text: string | null;
  alt_text_long: string | null;
  description_origin: "human" | "ai" | null;
  tags: string[] | null;
  genre: string | null;
  notes: string | null;
  on_website: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  // Joined fields
  artist?: Artist;
  categories?: Category[];
}

export interface DownloadEvent {
  id: string;
  artwork_id: string;
  ip_hash: string | null;
  user_agent: string | null;
  referrer: string | null;
  created_at: string;
}

/**
 * Shape of a row in the Art Cloud CSV export.
 */
export interface ArtCloudRow {
  Image: string;
  Title: string;
  "Artist First Name": string;
  "Artist Last Name": string;
  "Date Created": string;
  Medium: string;
  Height: string;
  Width: string;
  Depth: string;
  "Inventory Number": string;
  Tags: string;
  Genre: string;
  Notes: string;
  Active: string;
  "On Website": string;
  [key: string]: string; // Other columns we don't use publicly
}
