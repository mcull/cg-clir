export const metadata = {
  title: "About | Creative Growth Gallery",
  description: "About the Creative Growth Art Collection digitization project",
};

export default function AboutPage() {
  return (
    <div className="container-max py-12">
      <article className="max-w-3xl">
        <h1 className="font-serif text-4xl font-bold text-gray-900 mb-8">
          About This Project
        </h1>

        <section className="mb-12">
          <h2 className="font-serif text-2xl font-bold text-gray-900 mb-4">
            Creative Growth Art Center
          </h2>
          <p className="text-lg text-gray-700 leading-relaxed mb-4">
            The Creative Growth Art Center is a community arts organization
            dedicated to providing visual art opportunities for individuals with
            developmental disabilities. For decades, the Center has supported
            artists in creating meaningful work while fostering creativity and
            self-expression.
          </p>
          <p className="text-lg text-gray-700 leading-relaxed">
            This digital collection represents a carefully curated selection of
            artworks that showcase the talent, vision, and diverse perspectives
            of our artist&apos;s community.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="font-serif text-2xl font-bold text-gray-900 mb-4">
            The Digitization Project
          </h2>
          <p className="text-lg text-gray-700 leading-relaxed mb-4">
            This digital gallery was created with generous support from the
            Council on Library and Information Resources (CLIR), which provided
            a grant to digitize and make accessible the Creative Growth Art
            Center&apos;s collection. The project aims to:
          </p>
          <ul className="list-disc list-inside space-y-2 text-gray-700 mb-4">
            <li>
              Preserve and document the works of Creative Growth artists
            </li>
            <li>Make the collection accessible to a global audience</li>
            <li>Support research and scholarship about the Center&apos;s work</li>
            <li>
              Celebrate the artistic contributions of our artist community
            </li>
          </ul>
          <p className="text-lg text-gray-700 leading-relaxed">
            Every artwork in this collection has been professionally photographed,
            cataloged, and enhanced with detailed metadata to support discovery
            and understanding.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="font-serif text-2xl font-bold text-gray-900 mb-4">
            Accessibility
          </h2>
          <p className="text-lg text-gray-700 leading-relaxed mb-4">
            This website is designed to be accessible to everyone. We strive to
            meet or exceed the Web Content Accessibility Guidelines (WCAG) 2.1
            Level AA standard, ensuring that:
          </p>
          <ul className="list-disc list-inside space-y-2 text-gray-700 mb-4">
            <li>All images have descriptive alt text</li>
            <li>Content is navigable by keyboard alone</li>
            <li>Color contrast meets accessibility standards</li>
            <li>Text is resizable and readable</li>
            <li>Content is organized with proper semantic structure</li>
          </ul>
          <p className="text-lg text-gray-700 leading-relaxed">
            If you encounter any accessibility issues, please{" "}
            <a href="mailto:info@creativegrowth.org" className="link-primary">
              let us know
            </a>
            . We&apos;re committed to continuous improvement.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="font-serif text-2xl font-bold text-gray-900 mb-4">
            Using This Collection
          </h2>
          <p className="text-lg text-gray-700 leading-relaxed mb-4">
            Images in this collection are available for download and use in
            accordance with our usage guidelines. Please respect the work of our
            artists and provide appropriate attribution when sharing these
            images.
          </p>
          <p className="text-lg text-gray-700 leading-relaxed">
            For inquiries about larger-scale downloads, research usage, or
            partnerships, please contact the Creative Growth Art Center directly.
          </p>
        </section>

        <section className="pt-8 border-t border-gray-200">
          <h2 className="font-serif text-lg font-bold text-gray-900 mb-4">
            Technical Credits
          </h2>
          <p className="text-gray-700 mb-2">
            This gallery is built with modern web technologies including
            Next.js, React, and Tailwind CSS. It is hosted on Vercel and uses
            Supabase for data management and Cloudflare R2 for image storage.
          </p>
          <p className="text-gray-700">
            Analytics are provided by PostHog to help us understand how visitors
            interact with the collection while respecting user privacy.
          </p>
        </section>
      </article>
    </div>
  );
}
