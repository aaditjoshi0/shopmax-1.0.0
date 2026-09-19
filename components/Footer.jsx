'use client';
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="site-footer custom-border-top">
      <div className="container">
        <div className="row">
          <div className="col-md-6 col-lg-3 mb-4 mb-lg-0">
            <h3 className="footer-heading mb-4"><img src="/images/logo.png" alt="ShopMax" style={{ height: 55, width: 'auto' }} /></h3>
            <p>Design it, wear it, sell it. ShopMax is a store + community marketplace where anyone can customize clothing and sell their designs.</p>
          </div>
          <div className="col-lg-5 ml-auto mb-5 mb-lg-0">
            <div className="row">
              <div className="col-md-12"><h3 className="footer-heading mb-4">Quick Links</h3></div>
              <div className="col-md-6 col-lg-4">
                <ul className="list-unstyled">
                  <li><Link href="/men">Men</Link></li>
                  <li><Link href="/women">Women</Link></li>
                  <li><Link href="/shop">All Products</Link></li>
                  <li><Link href="/contact">Contact</Link></li>
                </ul>
              </div>
              <div className="col-md-6 col-lg-4">
                <ul className="list-unstyled">
                  <li><Link href="/cart">Cart</Link></li>
                  <li><Link href="/return-policy">Return Policy</Link></li>
                  <li><Link href="/refund-policy">Refund Policy</Link></li>
                  <li><Link href="/delivery-policy">Delivery Policy</Link></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="col-md-6 col-lg-3">
            <div className="block-5 mb-5">
              <h3 className="footer-heading mb-4">Contact Info</h3>
              <ul className="list-unstyled">
                <li className="address">ShopMax Store, Alkapuri Vadodara-390019, Gujarat, India</li>
                <li className="phone"><a href="tel:+919316012532">+91 9316012532</a></li>
                <li className="email">shopmaxcustomercare@gmail.com</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="row pt-5 mt-5 text-center">
          <div className="col-md-12"><p>Copyright &copy; {new Date().getFullYear()} ShopMax. All rights reserved.</p></div>
        </div>
      </div>
    </footer>
  );
}
