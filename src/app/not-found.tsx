import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="container-max text-center">
        <h1 className="font-serif text-6xl font-bold text-gray-900 mb-4">404</h1>
        <p className="text-xl text-gray-600 mb-8">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>

        <div className="flex gap-4 justify-center">
          <Link href="/" className="button-primary">
            Go Home
          </Link>
          <Link href="/collection" className="button-secondary">
            Browse Collection
          </Link>
        </div>
      </div>
    </div>
  );
}
