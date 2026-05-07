import Link from "next/link";

// Welcome page mirroring https://www.creativegrowth.org/creative-growth-public-archive
// Two-column intro (text left, featured artwork right) → wide black
// "Explore the Archive Here" CTA → acknowledgements. The "Selected
// Works" and "Audio Described Works" tiles from CG's version are
// intentionally omitted.
export const metadata = {
  title: "Creative Growth Public Archive",
  description:
    "A digital collection of over 2,500 images of art and artifacts from Creative Growth, made open and free for educational and scholarly use.",
};

const FEATURED_IMAGE_URL =
  "https://cdn.artcld.com/img/w_1200,h_1200,c_fit/qh5o5zssrz23vb01tmdh.jpg";

export default function HomePage() {
  return (
    <div className="container-max py-12">
      <h1 className="font-serif text-4xl md:text-5xl font-bold text-gray-900 mb-10 tracking-tight uppercase">
        Creative Growth Public Archive
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-12">
        <div className="space-y-5 text-gray-900 leading-relaxed">
          <p>
            Welcome to the Creative Growth Public Archive! This digital
            collection includes over 2,500 images of art and artifacts. This
            archive aims to preserve and share Creative Growth history.
          </p>
          <p>
            The images in this archive are{" "}
            <strong>open source and a part of the public domain</strong>.
            Anyone can use these images for educational, scholarly, or
            charitable purposes.
          </p>
          <p>
            This archive was made possible by the Council on Library and
            Information Resources, which also helped launch the Judith Scott
            Study Center. Learn more about the life and art of Judith Scott{" "}
            <a
              href="https://www.creativegrowth.org/judith-scott-study-center"
              className="link-primary"
            >
              here
            </a>
            .
          </p>
          <p>
            Browse artwork by past and current Creative Growth artists. Learn
            about our organization through vintage flyers, posters,
            photographs, and slides. Search by artist, medium, decade,
            ephemera type, and other key categories.
          </p>
        </div>

        <figure className="md:pl-4">
          {/* Plain <img> so we don't have to ship pixel dimensions for a
           * remote URL. Aspect ratio is intrinsic to the source. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={FEATURED_IMAGE_URL}
            alt="Painting by Annika Miller — colorful abstract composition with stacked geometric forms."
            className="block w-full h-auto"
          />
          <figcaption className="text-sm text-gray-600 italic mt-3">
            Artwork by Annika Miller.
          </figcaption>
        </figure>
      </div>

      <Link
        href="/collection"
        className="block bg-black text-white text-center font-serif italic text-4xl md:text-6xl py-10 md:py-14 mb-12 hover:bg-gray-800 transition-colors"
      >
        Explore the Archive Here
      </Link>

      <p className="text-gray-700 leading-relaxed mb-4">
        Thank you to our friends Farley Gwazda, Katherine Sherwood, and Tara
        Tucker for your help with this important project.
      </p>
    </div>
  );
}
