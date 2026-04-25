import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-max py-12 text-center">
      <h1 className="font-serif text-4xl font-bold text-gray-900 mb-4">
        Artwork Not Found
      </h1>
      <p className="text-lg text-gray-600 mb-8">
        This artwork doesn&apos;t exist or has been removed.
      </p>

      <Link href="/" className="text-blue-600 hover:text-blue-800">
        Back to Collection
      </Link>
    </div>
  );
}
