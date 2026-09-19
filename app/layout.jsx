import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

// CSR-first: never statically prerender shells into .html files.
// All data loads client-side via fetch(/api) inside "use client" pages.
export const dynamic = 'force-dynamic';

// Global styles — bundled into JS-driven CSR pages (no static .html shells).
import '../css/bootstrap.min.css';
import '../css/style.css';
import '../css/custom.css';

export const metadata = {
  title: 'ShopMax',
  description: 'ShopMax — custom clothing & community marketplace',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Mukta:300,400,700" />
        <link rel="stylesheet" href="/fonts/icomoon/style.css" />
      </head>
      <body>
        <div className="site-wrap">
          <Navbar />
          {children}
          <Footer />
        </div>
      </body>
    </html>
  );
}
