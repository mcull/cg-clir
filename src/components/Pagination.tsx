"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
  preserveParams?: string[];
}

export default function Pagination({
  currentPage,
  totalPages,
  baseUrl,
  preserveParams = ["category", "tag", "q"],
}: PaginationProps) {
  const searchParams = useSearchParams();

  const buildUrl = (page: number) => {
    const params = new URLSearchParams();
    params.set("page", page.toString());

    for (const param of preserveParams) {
      const value = searchParams.get(param);
      if (value) {
        params.append(param, value);
      }
    }

    return `${baseUrl}?${params.toString()}`;
  };

  if (totalPages <= 1) return null;

  const pageNumbers: (number | string)[] = [];
  const maxVisible = 5;

  if (totalPages <= maxVisible) {
    for (let i = 1; i <= totalPages; i++) {
      pageNumbers.push(i);
    }
  } else {
    pageNumbers.push(1);

    if (currentPage > 3) {
      pageNumbers.push("...");
    }

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) {
      pageNumbers.push(i);
    }

    if (currentPage < totalPages - 2) {
      pageNumbers.push("...");
    }

    pageNumbers.push(totalPages);
  }

  return (
    <nav
      aria-label="Pagination navigation"
      className="flex items-center justify-center gap-2 my-12"
    >
      {currentPage > 1 && (
        <Link
          href={buildUrl(currentPage - 1)}
          className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          aria-label="Previous page"
        >
          Previous
        </Link>
      )}

      <div className="flex gap-1">
        {pageNumbers.map((pageNum, idx) => {
          if (pageNum === "...") {
            return (
              <span key={`ellipsis-${idx}`} className="px-3 py-2">
                ...
              </span>
            );
          }

          const page = pageNum as number;
          const isCurrentPage = page === currentPage;

          return (
            <Link
              key={page}
              href={buildUrl(page)}
              aria-label={`Go to page ${page}`}
              aria-current={isCurrentPage ? "page" : undefined}
              className={`px-3 py-2 rounded border transition-colors ${
                isCurrentPage
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-gray-300 hover:bg-gray-50"
              }`}
            >
              {page}
            </Link>
          );
        })}
      </div>

      {currentPage < totalPages && (
        <Link
          href={buildUrl(currentPage + 1)}
          className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          aria-label="Next page"
        >
          Next
        </Link>
      )}
    </nav>
  );
}
