"use client";

import { usePathname } from "next/navigation";

export default function Footer() {
  const pathname = usePathname();

  // Don't show footer on admin pages
  const isAdmin = pathname?.startsWith("/admin");
  if (isAdmin) return null;

  return (
    <footer className="border-t border-gray-200 bg-white mt-16">
      <div className="container-max py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          <div>
            <h3 className="font-serif font-bold text-gray-900 mb-4">
              Creative Growth Gallery
            </h3>
            <p className="text-gray-600 text-sm">
              Exploring the contemporary art collection of the Creative Growth
              Art Center through digital accessibility and discovery.
            </p>
          </div>

          <div>
            <h3 className="font-serif font-bold text-gray-900 mb-4">Quick Links</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a href="/collection" className="text-blue-600 hover:text-blue-800">
                  View Collection
                </a>
              </li>
              <li>
                <a href="/artists" className="text-blue-600 hover:text-blue-800">
                  Browse Artists
                </a>
              </li>
              <li>
                <a href="/about" className="text-blue-600 hover:text-blue-800">
                  About This Project
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-serif font-bold text-gray-900 mb-4">Support</h3>
            <p className="text-gray-600 text-sm">
              This digitization project is supported by a grant from the Council
              on Library and Information Resources (CLIR).
            </p>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-6 text-center text-sm text-gray-600">
          <p>
            Supported by a grant from the Council on Library and Information Resources
          </p>
          <p className="mt-2">
            © {new Date().getFullYear()} Creative Growth Art Center. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
